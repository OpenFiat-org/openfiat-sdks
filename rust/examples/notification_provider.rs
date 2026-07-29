//! A minimal Notification Provider (OFS-6000): register with a node's
//! Service Registry, a wallet subscribes to a category, then the provider
//! reports a delivery.
//!
//! Run against a local node with `cargo run --example notification_provider`.
//! By default it targets `http://localhost:7080` — start one with
//! `CLI_HTTP_ADDR=127.0.0.1:7080 cargo run -p openfiat-cli` from
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
        timestamp: Timestamp::now(),
    };
    client.send_subscription_update(update, &wallet).await?;

    println!("reporting a delivered trade-completed notification...");
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
    client.send_delivery_report(report, &provider).await?;

    let receipts = client
        .get_delivery_receipts_by_wallet(&peer_id(&wallet))
        .await?;
    println!("delivery receipts for this wallet: {}", receipts.len());

    Ok(())
}
