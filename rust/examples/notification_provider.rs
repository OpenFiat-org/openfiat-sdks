//! A minimal Notification Provider (OFS-6000): register with a node's
//! Service Registry, a wallet subscribes to a category, and the provider
//! learns the rule that governs delivery reports.
//!
//! **A report is not self-attested.** A node accepts one only if it holds a
//! matching dispatch record of its own, so this example ends by watching a
//! well-formed, correctly-signed report be refused — because the node never
//! routed the notification it names. That is the interesting part, and the
//! reason this example is worth reading: a provider's compensation and
//! reputation follow the volume it reports, so a report nobody can check is
//! not evidence of work.
//!
//! Earning a receipt needs a real dispatch, which needs a subscription
//! carrying a destination sealed to this gateway. Sealing is not exposed by
//! this SDK yet, so that path is described here rather than performed.
//!
//! Run against a local node with `cargo run --example notification_provider`.
//! By default it targets `http://localhost:7080` — start one with
//! `cargo run -p openfiat-cli -- --rpc-bind-address 127.0.0.1:7080` from
//! `openfiat-core`.

use openfiat_network::identity::peer_id_from_public_key;
use openfiat_notifications::events::{DeliveryReport, SubscriptionUpdate};
use openfiat_notifications::{
    DeliveryStatus, NotificationCategory, NotificationId, NotificationTrigger,
};
use openfiat_registry::Registration;
use openfiat_sdk::wallet::Keypair;
use openfiat_sdk::{Client, ClientConfig};
use openfiat_types::{NotificationChannel, PeerId, ServiceId, ServiceType, Timestamp};

fn peer_id(keypair: &Keypair) -> PeerId {
    peer_id_from_public_key(&keypair.public_key())
        .expect("a freshly generated keypair's public key always derives a peer id")
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let endpoint =
        std::env::var("OPENFIAT_NODE_URL").unwrap_or_else(|_| "http://localhost:7080".to_string());
    let client = Client::new(ClientConfig {
        endpoint,
        ..ClientConfig::default()
    });

    // In production, load a persistent identity instead — see
    // openfiat_sdk::wallet::solana_keyfile::load.
    let provider = Keypair::generate();
    let wallet = Keypair::generate();
    let provider_id = peer_id(&provider);
    let service_id = ServiceId::new("example-notification-provider-1");

    println!("registering as a Notification Provider ({provider_id:?})...");
    let registration = Registration {
        service_id: service_id.clone(),
        service_type: ServiceType::Notifications(NotificationChannel::Webhook),
        provider: provider_id.clone(),
        provider_public_key: provider.public_key(),
        endpoints: vec!["https://example.invalid/webhook".to_string()],
        supported_ofs: vec![1500, 6000],
        region: None,
        capabilities: vec!["Webhook".to_string()],
        pricing: None,
        payout_wallet: None,
        timestamp: Timestamp::now(),
    };
    client
        .send_provider_register(registration, &provider)
        .await?;
    println!("registered as service {}", service_id.as_str());

    println!("subscribing a wallet to Trading notifications...");
    let update = SubscriptionUpdate {
        wallet: peer_id(&wallet),
        wallet_public_key: wallet.public_key(),
        enabled_categories: vec![NotificationCategory::Trading],
        // Empty here, but the field must be present: the node verifies the
        // signature against a re-serialization of this struct, so omitting
        // it changes the bytes being hashed and the update comes back as
        // INVALID_SIGNATURE. A real subscription carries a destination
        // sealed to a chosen gateway, which is what makes dispatch — and
        // therefore an acceptable delivery report — possible at all.
        destinations: Vec::new(),
        timestamp: Timestamp::now(),
    };
    client.send_subscription_update(update, &wallet).await?;

    println!("reporting a delivery for a notification this node never sent...");
    let report = DeliveryReport {
        notification_id: NotificationId::new("example-notification-1"),
        service_id,
        provider: provider_id,
        provider_public_key: provider.public_key(),
        recipient_wallet: peer_id(&wallet),
        trigger: NotificationTrigger::TradeCompleted,
        status: DeliveryStatus::Delivered,
        timestamp: Timestamp::now(),
    };
    match client.send_delivery_report(report, &provider).await {
        Err(refusal) => println!("refused, as it should be: {refusal}"),
        Ok(_) => {
            return Err(
                "the node accepted a report for a notification it never dispatched — \
                 that check is the only thing stopping a gateway inventing its own volume"
                    .into(),
            );
        }
    }

    let receipts = client
        .get_delivery_receipts_by_wallet(&peer_id(&wallet))
        .await?;
    println!(
        "delivery receipts for this wallet: {} (a refused report leaves none)",
        receipts.len()
    );

    Ok(())
}
