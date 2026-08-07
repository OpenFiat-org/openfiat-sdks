//! Proves the SDK's transport, typed methods, and wallet signing against
//! a real running node — the same `rpc`+`api` axum router `openfiat-cli`
//! serves, bound to a real ephemeral TCP port in-process (rather than
//! shelling out to the `openfiat-node` binary, which isn't reachable
//! as a git dependency the way the library crates are).

use openfiat_advertisements::AdvertisementId;
use openfiat_advertisements::events::AdvertisementCreate;
use openfiat_advertisements::record::{Direction, PricingModel};
use openfiat_crypto::MintAddress;
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
use openfiat_taxonomy::PaymentMethodRef;
use openfiat_types::{
    Amount, FiatCurrency, NotificationChannel, PeerId, ServiceId, ServiceType, Timestamp,
};
use std::sync::Arc;

fn peer_id(keypair: &Keypair) -> PeerId {
    peer_id_from_public_key(&keypair.public_key())
        .expect("a freshly generated keypair's public key always derives a peer id")
}

async fn spawn_node() -> String {
    let rpc_handle =
        openfiat_rpc::spawn_actor(MemoryStore::new, openfiat_rpc::NetworkConfig::for_test());
    let metrics = Arc::new(openfiat_metrics::MetricsRegistry::new());
    // A directory that does not exist: this node produces no snapshots, so
    // the merged `GET /snapshot/{id}` route correctly answers 404 for
    // everything rather than pretending to a capability it lacks.
    let snapshots = std::path::PathBuf::from("/nonexistent/live-node-produces-no-snapshots");
    let router = openfiat_rpc::router(rpc_handle, metrics, snapshots).merge(openfiat_api::router());

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
        onchain_proposal_id: None,
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

    // Bound once, because the reservation below must agree with it and a
    // second literal is how the two drift into a PRICE_DISAGREEMENT that
    // looks like a protocol bug.
    let advertised_price = Amount::new(12_950, 2);
    let create = AdvertisementCreate {
        id: AdvertisementId::new("live-node-trading-bot-ad"),
        merchant: peer_id(&merchant),
        merchant_public_key: merchant.public_key(),
        asset_mint: MintAddress::parse("C4rSGhdxWhSFQuFcAxQti1JvBxriwHJoHtJjfhs5p24Y")
            .expect("devnet USDT mint"),
        direction: Direction::Sell,
        fiat_currency: FiatCurrency::parse("KES").expect("KES is a currency code"),
        min_trade: Amount::new(1_000, 2),
        max_trade: Amount::new(50_000, 2),
        initial_liquidity: Amount::new(200_000, 2),
        pricing: PricingModel::Fixed {
            price: advertised_price,
        },
        payment_methods: vec![PaymentMethodRef::builtin("mpesa-kenya").unwrap()],
        timestamp: Timestamp::now(),
    };
    let ad_id = client
        .send_advertisement_create(create, &merchant)
        .await
        .unwrap();

    let request = ReservationRequest {
        id: ReservationId::new("live-node-trading-bot-reservation"),
        advertisement_id: ad_id.clone(),
        requester: peer_id(&bot),
        requester_public_key: bot.public_key(),
        amount: Amount::new(5_000, 2),
        // Signed into the request, and checked by the node against the
        // advertisement's own terms rather than against the node's oracle
        // view — see `PricingModel::agrees_with`. A Fixed ad's agreed price
        // is just what it advertises, and it has no mid to record.
        agreed_price: advertised_price,
        agreed_mid: None,
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
    // The requester is deliberately absent: `getReservation` is a public
    // read and naming the requester beside an advertisement that already
    // names its merchant completes one edge of the trade graph. What
    // survives is what an order book needs — which offer, how much, and
    // that escrow locked.
    //
    // `get_my_reservations` is the read that would name the bot, and it
    // is not exercised here: this test spawns a node built from the
    // `openfiat-core` revision `Cargo.toml` pins, which predates the
    // `getMy*` methods entirely. See `tests/trade_reads.rs`.
    assert_eq!(reservation.advertisement_id, ad_id);
    assert_eq!(reservation.amount, Amount::new(5_000, 2));
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
                // Loopback, not `example.invalid`. A node now refuses to
                // register an endpoint in an RFC 2606/6761 reserved domain
                // at all: a signed registration replicates to every node
                // and is offered to users as live infrastructure, so an
                // address that can never resolve is not a harmless
                // placeholder — it is a fabricated service nobody can
                // delete. `.localhost` stays allowed, because it resolves
                // and means exactly what it says.
                endpoints: vec!["http://localhost:7080/webhook".to_string()],
                supported_ofs: vec![1500, 6000],
                region: None,
                capabilities: vec!["Webhook".to_string()],
                branding: None,
                pricing: None,
                payout_wallet: None,
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
                // Empty, but present. The node verifies the signature
                // against a re-serialization of this struct, so a missing
                // field would make the bytes it hashes differ from the
                // bytes signed here and the update would be refused as
                // INVALID_SIGNATURE rather than as anything to do with
                // destinations.
                destinations: Vec::new(),
                timestamp: Timestamp::now(),
            },
            &wallet,
        )
        .await
        .unwrap();

    // A registered provider, signing correctly, reporting a delivery for a
    // notification this node never dispatched. It is refused, and no
    // receipt is written.
    //
    // This used to succeed, and that was the bug. A provider's report is
    // self-attested, and its reputation and compensation depend on the
    // volume it claims, so accepting an arbitrary notification id let any
    // registered gateway manufacture evidence of work nobody asked it to
    // do. `NotificationRegistry::apply_delivery_report` now requires a
    // matching `DispatchRecord` this node made itself, and cross-checks the
    // service, recipient and trigger against it.
    //
    // Note what that costs: a node that never routed a given notification
    // drops a report it cannot check. That is deliberate and recoverable —
    // the nodes that did route it still accept and gossip the report, and
    // dispatch is deterministic — whereas accepting an uncheckable claim
    // would write it into replicated state permanently.
    let refused = client
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
        .await;
    // Asserted on the specific refusal, not merely on `is_err()`. A bare
    // error check would pass just as happily if the report had been thrown
    // out for a malformed signature or an unregistered service — failing
    // for the wrong reason looks identical from here, and would leave the
    // property this test exists for completely unguarded.
    let message = match refused {
        Err(error) => error.to_string(),
        Ok(_) => panic!(
            "the node accepted a report for a notification it never dispatched — \
             that check is the only thing stopping a gateway inventing its own volume"
        ),
    };
    assert!(
        message.contains("RESOURCE_NOT_FOUND"),
        "expected the report to be refused as an unknown notification, got: {message}"
    );

    let receipts = client
        .get_delivery_receipts_by_wallet(&peer_id(&wallet))
        .await
        .unwrap();
    assert!(
        receipts.is_empty(),
        "a refused report must not leave a receipt behind"
    );

    // The accepted path is deliberately not exercised here, matching the
    // TypeScript suite. It needs a real dispatch, which needs a
    // subscription carrying a destination sealed to this gateway — and
    // sealing is not exposed by either SDK yet. Faking it by relaxing the
    // node's check would delete the property this test now protects.
}
