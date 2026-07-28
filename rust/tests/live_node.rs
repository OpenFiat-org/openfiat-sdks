//! Proves the SDK's transport, typed methods, and wallet signing against
//! a real running node — the same `rpc`+`api` axum router `openfiat-cli`
//! serves, bound to a real ephemeral TCP port in-process (rather than
//! shelling out to the `openfiat-node` binary, which isn't reachable
//! as a git dependency the way the library crates are).

use openfiat_advertisements::AdvertisementId;
use openfiat_advertisements::events::AdvertisementCreate;
use openfiat_advertisements::record::{Direction, PricingModel};
use openfiat_governance::events::ProposalCreate;
use openfiat_governance::record::ProposalCategory;
use openfiat_network::identity::peer_id_from_public_key;
use openfiat_notifications::events::{DeliveryReport, SubscriptionUpdate};
use openfiat_notifications::{
    DeliveryStatus, NotificationCategory, NotificationId, NotificationTrigger,
};
use openfiat_registry::Registration;
use openfiat_reservations::ReservationId;
use openfiat_reservations::events::ReservationRequest;
use openfiat_sdk::wallet::Keypair;
use openfiat_sdk::{Client, ClientConfig};
use openfiat_sessions::SessionId;
use openfiat_sessions::events::{SessionCreate, SessionRevoke};
use openfiat_storage::mem::MemoryStore;
use openfiat_types::{Amount, NotificationChannel, PeerId, ServiceId, ServiceType, Timestamp};
use std::sync::Arc;

fn peer_id(keypair: &Keypair) -> PeerId {
    peer_id_from_public_key(&keypair.public_key())
        .expect("a freshly generated keypair's public key always derives a peer id")
}

async fn spawn_node() -> String {
    let rpc_handle = openfiat_rpc::spawn_actor(MemoryStore::new);
    let metrics = Arc::new(openfiat_metrics::MetricsRegistry::new());
    let router = openfiat_rpc::router(rpc_handle, metrics).merge(openfiat_api::router());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind an ephemeral port");
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn get_version_round_trips_against_a_real_node() {
    let endpoint = spawn_node().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });

    let version = client.get_version().await.unwrap();
    assert!(!version.is_empty());

    let health = client.get_health().await.unwrap();
    assert_eq!(health, "ok");
}

/// A `sendX` method whose success value is `()` serializes as
/// `"result": null` on the wire — `Client::call` must treat that as a
/// real success, not confuse it with a response carrying neither a
/// result nor an error (a bug this exact scenario caught: `serde`'s
/// `Option<T>` deserialization treats JSON `null` as "absent" regardless
/// of `T`, so naively deserializing straight into `Option<R>` collapses
/// a genuine `null` success the same way it would a malformed response).
#[tokio::test]
async fn a_unit_returning_send_method_is_not_mistaken_for_a_malformed_response() {
    let endpoint = spawn_node().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });

    let wallet = Keypair::generate();
    let wallet_peer_id = peer_id_from_public_key(&wallet.public_key()).unwrap();
    let session_id = client
        .send_session_establish(
            SessionCreate {
                id: SessionId::new("live-node-unit-return-test"),
                wallet: wallet_peer_id.clone(),
                wallet_public_key: wallet.public_key(),
                client: "web".to_string(),
                host_node: wallet_peer_id.clone(),
                permissions: vec!["trade".to_string()],
                timestamp: Timestamp::now(),
                expires_at: Timestamp::from_millis(Timestamp::now().as_millis() + 3_600_000),
            },
            &wallet,
        )
        .await
        .unwrap();

    // sendSessionRevoke's RPC handler returns `Result<(), RpcError>` —
    // this must come back `Ok(())`, not `Err(JsonRpc(0, "... neither a
    // result nor an error"))`.
    client
        .send_session_revoke(
            SessionRevoke {
                session_id,
                wallet: wallet_peer_id,
                timestamp: Timestamp::now(),
            },
            &wallet,
        )
        .await
        .expect("a `()`-returning sendX method must be recognized as a real success");
}

#[tokio::test]
async fn a_signed_proposal_is_submitted_and_readable_back() {
    let endpoint = spawn_node().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });

    let keypair = Keypair::generate();
    let author = peer_id_from_public_key(&keypair.public_key()).unwrap();

    let create = ProposalCreate {
        id: openfiat_governance::ProposalId::new("ofp-sdk-1"),
        title: "SDK integration test proposal".to_string(),
        summary: "Proves the Rust SDK signs and submits real events.".to_string(),
        category: ProposalCategory::Protocol,
        author,
        author_public_key: keypair.public_key(),
        timestamp: Timestamp::now(),
    };

    let id = client.send_proposal_create(create, &keypair).await.unwrap();
    assert_eq!(id.as_str(), "ofp-sdk-1");

    let proposal = client.get_proposal(id.as_str()).await.unwrap();
    assert!(proposal.is_some());
    assert_eq!(proposal.unwrap().title, "SDK integration test proposal");
}

#[tokio::test]
async fn an_unknown_method_surfaces_as_a_json_rpc_error() {
    let endpoint = spawn_node().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });

    let result: Result<serde_json::Value, _> = client.call("doesNotExist", ()).await;
    assert!(matches!(
        result,
        Err(openfiat_sdk::Error::JsonRpc(-32601, _))
    ));
}

#[tokio::test]
async fn a_fresh_node_reports_gossip_only_with_no_blockhash() {
    let endpoint = spawn_node().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });

    let status = client.get_chain_status().await.unwrap();
    assert_eq!(status.mode, "GossipOnly");
    assert!(status.blockhash.is_none());

    let err = client.get_latest_blockhash().await.unwrap_err();
    assert!(matches!(err, openfiat_sdk::Error::Application { .. }));
}

#[tokio::test]
async fn a_real_signed_solana_transaction_is_submitted_through_send_transaction() {
    use solana_keypair::Keypair as SolanaKeypair;
    use solana_message::Message;
    use solana_pubkey::Pubkey;
    use solana_signer::Signer;
    use solana_transaction::Transaction;
    use solana_transaction::versioned::VersionedTransaction;

    let endpoint = spawn_node().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });

    let payer = SolanaKeypair::new();
    let recipient = Pubkey::new_unique();
    let blockhash = solana_hash::Hash::new_unique();
    let instruction =
        solana_system_interface::instruction::transfer(&payer.pubkey(), &recipient, 1_000);
    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let transaction = Transaction::new(&[&payer], message, blockhash);
    let versioned: VersionedTransaction = transaction.into();

    client.send_transaction(&versioned).await.unwrap();
}

/// The same flow `examples/trading_bot.rs` walks through — this is what
/// keeps that quickstart's code from silently drifting out of date: a
/// merchant publishes a Sell ad, a separate bot identity reserves against
/// it, and the reservation is readable back in its post-request state.
#[tokio::test]
async fn a_trading_bots_reservation_locks_escrow_against_a_published_advertisement() {
    let endpoint = spawn_node().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });

    let merchant = Keypair::generate();
    let bot = Keypair::generate();

    let create = AdvertisementCreate {
        id: AdvertisementId::new("live-node-trading-bot-ad"),
        merchant: peer_id(&merchant),
        merchant_public_key: merchant.public_key(),
        asset: "USDT".to_string(),
        direction: Direction::Sell,
        fiat_currency: "KES".to_string(),
        min_trade: Amount::new(1_000, 2),
        max_trade: Amount::new(50_000, 2),
        initial_liquidity: Amount::new(200_000, 2),
        pricing: PricingModel::Fixed {
            price: Amount::new(12_950, 2),
        },
        payment_methods: vec!["M-Pesa".to_string()],
        timestamp: Timestamp::now(),
    };
    let ad_id = client
        .send_advertisement_create(create, &merchant)
        .await
        .unwrap();

    let request = ReservationRequest {
        id: ReservationId::new("live-node-trading-bot-reservation"),
        advertisement_id: ad_id,
        requester: peer_id(&bot),
        requester_public_key: bot.public_key(),
        amount: Amount::new(5_000, 2),
        timestamp: Timestamp::now(),
    };
    let reservation_id = client
        .send_reservation_request(request, &bot)
        .await
        .unwrap();

    let reservation = client
        .get_reservation(reservation_id.as_str())
        .await
        .unwrap()
        .expect("just opened this reservation");
    assert_eq!(reservation.requester, peer_id(&bot));
}

/// The same flow `examples/notification_provider.rs` walks through: a
/// provider registers, a wallet subscribes, the provider reports a
/// delivery, and that receipt is readable back for the wallet.
#[tokio::test]
async fn a_notification_providers_delivery_report_is_readable_back_for_the_wallet() {
    let endpoint = spawn_node().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });

    let provider = Keypair::generate();
    let wallet = Keypair::generate();
    let service_id = ServiceId::new("live-node-notification-provider-1");

    client
        .send_provider_register(
            Registration {
                service_id: service_id.clone(),
                service_type: ServiceType::Notifications(NotificationChannel::Webhook),
                provider: peer_id(&provider),
                provider_public_key: provider.public_key(),
                endpoints: vec!["https://example.invalid/webhook".to_string()],
                supported_ofs: vec![1500, 6000],
                region: None,
                capabilities: vec!["Webhook".to_string()],
                pricing: None,
                timestamp: Timestamp::now(),
            },
            &provider,
        )
        .await
        .unwrap();

    client
        .send_subscription_update(
            SubscriptionUpdate {
                wallet: peer_id(&wallet),
                wallet_public_key: wallet.public_key(),
                enabled_categories: vec![NotificationCategory::Trading],
                timestamp: Timestamp::now(),
            },
            &wallet,
        )
        .await
        .unwrap();

    client
        .send_delivery_report(
            DeliveryReport {
                notification_id: NotificationId::new("live-node-notification-1"),
                service_id,
                provider: peer_id(&provider),
                provider_public_key: provider.public_key(),
                recipient_wallet: peer_id(&wallet),
                trigger: NotificationTrigger::TradeCompleted,
                status: DeliveryStatus::Delivered,
                timestamp: Timestamp::now(),
            },
            &provider,
        )
        .await
        .unwrap();

    let receipts = client
        .get_delivery_receipts_by_wallet(&peer_id(&wallet))
        .await
        .unwrap();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].status, DeliveryStatus::Delivered);
}
