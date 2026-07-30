//! The wallet-proof trade reads, asserted at the wire.
//!
//! `getMySettlements`, `getMyReservations`, `getMyDisputes` and
//! `getMyTrades` are gated by a signature over
//! `"<domain>:<subject>:<nonce>"`, and the domain is a bare string
//! constant transcribed from `openfiat-rpc`. Get one
//! character of it wrong and the node answers with a signature failure
//! that never mentions domains, on a surface whose whole purpose is that
//! it refuses rather than explains. Nothing but an assertion on the exact
//! bytes catches that.
//!
//! These run against a capturing server rather than a real node, and not
//! by choice: this SDK's `openfiat-core` dependencies are pinned to a
//! revision (see `rust/Cargo.toml`) that predates the redaction change,
//! so the node `live_node.rs` spawns has no `getMy*` methods and no
//! `getWalletChallenge` to answer. Bumping that pin is its own piece of
//! work. Until then the live round trip is unprovable here, and the
//! TypeScript suite is where it is proved against a real node at HEAD.

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use base64::Engine;
use openfiat_network::identity::peer_id_from_public_key;
use openfiat_sdk::methods::redaction::{PublicSettlement, PublicTrade, TradeStatus};
use openfiat_sdk::wallet::Keypair;
use openfiat_sdk::{Client, ClientConfig};
use serde_json::Value;
use std::sync::{Arc, Mutex};

/// The nonce the stub issues. Fixed, so the bytes the SDK signs are
/// fully determined and the test can rebuild them independently rather
/// than reading them back out of the request it is checking.
const NONCE: &str = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

async fn handle(
    State(captured): State<Arc<Mutex<Vec<Value>>>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let id = body.get("id").cloned().unwrap_or(Value::Null);
    let result = if body["method"] == "getWalletChallenge" {
        // Echoing the wallet back as `subject` is what a node does: the
        // subject is the canonical spelling of whatever peer id was
        // asked about, and it is signed verbatim.
        serde_json::json!({
            "subject": body["params"]["wallet"],
            "nonce": NONCE,
            "expires_at": 1_785_326_339_513u64,
        })
    } else {
        Value::Array(Vec::new())
    };
    captured.lock().unwrap().push(body);
    Json(serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

async fn spawn_capturing_server() -> (String, Arc<Mutex<Vec<Value>>>) {
    let captured: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let router = Router::new()
        .route("/rpc", post(handle))
        .with_state(captured.clone());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind an ephemeral port");
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (format!("http://{addr}"), captured)
}

fn client_for(endpoint: String) -> Client {
    Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    })
}

fn base64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Checks the two-call exchange a `get_my_*` method makes: a challenge
/// request for the caller's own wallet, then a proof signed under
/// `domain`.
fn assert_proof_exchange(
    captured: &Arc<Mutex<Vec<Value>>>,
    keypair: &Keypair,
    method: &str,
    domain: &str,
) {
    let calls = captured.lock().unwrap();
    assert_eq!(calls.len(), 2, "a gated read is a challenge then a proof");

    let wallet = base64(
        peer_id_from_public_key(&keypair.public_key())
            .unwrap()
            .as_bytes(),
    );
    assert_eq!(calls[0]["method"], "getWalletChallenge");
    assert_eq!(
        calls[0]["params"],
        serde_json::json!({ "wallet": wallet }),
        "the challenge is asked for by wallet and nothing else"
    );

    assert_eq!(calls[1]["method"], method);
    let params = &calls[1]["params"];
    assert_eq!(
        params["wallet"], wallet,
        "the proof echoes the subject the node issued the challenge for"
    );
    assert_eq!(
        params["public_key"],
        base64(keypair.public_key().as_bytes()),
        "the key is stated by the caller, not inferred by the node from the wallet"
    );
    assert_eq!(params["nonce"], NONCE);

    // The bytes are rebuilt here from the domain literal rather than
    // from the SDK's own constant: a test that asked the SDK what it
    // signed would agree with any typo it made.
    let signed_bytes = format!("{domain}:{wallet}:{NONCE}").into_bytes();
    let raw: [u8; 64] = base64::engine::general_purpose::STANDARD
        .decode(params["signature"].as_str().expect("a base64 signature"))
        .expect("the signature must be base64")
        .try_into()
        .expect("an Ed25519 signature is 64 bytes");
    openfiat_crypto::verify(
        &keypair.public_key(),
        &signed_bytes,
        &openfiat_types::Signature::from_bytes(raw),
    )
    .expect("the proof must verify over exactly the bytes the node rebuilds");
}

#[tokio::test]
async fn my_settlements_is_signed_under_the_settlements_domain() {
    let (endpoint, captured) = spawn_capturing_server().await;
    let keypair = Keypair::generate();

    let settlements = client_for(endpoint)
        .get_my_settlements(&keypair)
        .await
        .expect("the capturing server answers an empty list");
    assert!(settlements.is_empty());

    assert_proof_exchange(
        &captured,
        &keypair,
        "getMySettlements",
        "openfiat-my-settlements",
    );
}

#[tokio::test]
async fn my_reservations_is_signed_under_the_reservations_domain() {
    let (endpoint, captured) = spawn_capturing_server().await;
    let keypair = Keypair::generate();

    client_for(endpoint)
        .get_my_reservations(&keypair)
        .await
        .expect("the capturing server answers an empty list");

    assert_proof_exchange(
        &captured,
        &keypair,
        "getMyReservations",
        "openfiat-my-reservations",
    );
}

#[tokio::test]
async fn my_disputes_is_signed_under_the_disputes_domain() {
    let (endpoint, captured) = spawn_capturing_server().await;
    let keypair = Keypair::generate();

    client_for(endpoint)
        .get_my_disputes(&keypair)
        .await
        .expect("the capturing server answers an empty list");

    assert_proof_exchange(&captured, &keypair, "getMyDisputes", "openfiat-my-disputes");
}

#[tokio::test]
async fn my_trades_is_signed_under_the_trades_domain() {
    let (endpoint, captured) = spawn_capturing_server().await;
    let keypair = Keypair::generate();

    client_for(endpoint)
        .get_my_trades(&keypair)
        .await
        .expect("the capturing server answers an empty list");

    assert_proof_exchange(&captured, &keypair, "getMyTrades", "openfiat-my-trades");
}

/// The property the four domains exist for. If they were ever collapsed
/// into one constant, every test above would still pass.
#[tokio::test]
async fn a_proof_for_one_surface_does_not_verify_on_another() {
    let (endpoint, captured) = spawn_capturing_server().await;
    let keypair = Keypair::generate();

    client_for(endpoint)
        .get_my_settlements(&keypair)
        .await
        .unwrap();

    let calls = captured.lock().unwrap();
    let wallet = base64(
        peer_id_from_public_key(&keypair.public_key())
            .unwrap()
            .as_bytes(),
    );
    let raw: [u8; 64] = base64::engine::general_purpose::STANDARD
        .decode(calls[1]["params"]["signature"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap();

    for other in [
        "openfiat-my-reservations",
        "openfiat-my-disputes",
        "openfiat-my-trades",
    ] {
        let elsewhere = format!("{other}:{wallet}:{NONCE}").into_bytes();
        assert!(
            openfiat_crypto::verify(
                &keypair.public_key(),
                &elsewhere,
                &openfiat_types::Signature::from_bytes(raw),
            )
            .is_err(),
            "a settlements proof must not open {other}"
        );
    }
}

/// The redacted shape decodes from what a node actually sends — no party
/// field is quietly required, which would turn the public read into a
/// decode error the first time it was called.
#[test]
fn a_public_settlement_decodes_without_any_party_field() {
    let redacted = serde_json::json!({
        "id": "s-1",
        "reservation_id": "r-1",
        "amount": { "base_units": 2_500_000u64, "decimals": 6 },
        "state": "Completed",
        "escrow_release_signature": "sig",
        "payment_submitted_at": null,
        "merchant_responded_at": null,
        "payment_discrepancy": null,
        "created_at": 1_000u64,
        "updated_at": 2_000u64,
    });

    let settlement: PublicSettlement =
        serde_json::from_value(redacted).expect("the public read's own payload must decode");
    assert_eq!(settlement.escrow_release_signature.as_deref(), Some("sig"));
}

/// The trade join decodes from what a node actually sends, with no party
/// anywhere in it.
///
/// A trade exists as soon as its reservation does, so `settlement` is
/// null far more often than not — a shape that required it would turn
/// every pre-settlement read into a decode error. Asserted with the
/// payload written out by hand rather than round-tripped through the
/// SDK's own type, which would agree with any field this transcription
/// got wrong.
#[test]
fn a_public_trade_decodes_before_any_settlement_exists() {
    let redacted = serde_json::json!({
        "reservation": {
            "id": "r-1",
            "advertisement_id": "ad-1",
            "amount": { "base_units": 5_000u64, "decimals": 2 },
            "state": "EscrowLocked",
            "requested_at": 1_000u64,
            "updated_at": 1_000u64,
            "expires_at": 2_000u64,
        },
        "settlement": null,
        "status": "EscrowLocked",
    });

    let trade: PublicTrade =
        serde_json::from_value(redacted).expect("the public read's own payload must decode");
    assert_eq!(trade.status, TradeStatus::EscrowLocked);
    assert!(trade.settlement.is_none());
}

/// Once a settlement exists the join carries both halves, and both are
/// still redacted — the whole point of composing the public shapes rather
/// than redacting a second time.
#[test]
fn a_settled_public_trade_carries_two_redacted_halves() {
    let redacted = serde_json::json!({
        "reservation": {
            "id": "r-1",
            "advertisement_id": "ad-1",
            "amount": { "base_units": 5_000u64, "decimals": 2 },
            "state": "EscrowLocked",
            "requested_at": 1_000u64,
            "updated_at": 1_000u64,
            "expires_at": 2_000u64,
        },
        "settlement": {
            "id": "s-1",
            "reservation_id": "r-1",
            "amount": { "base_units": 5_000u64, "decimals": 2 },
            "state": "Completed",
            "escrow_release_signature": "sig",
            "payment_submitted_at": null,
            "merchant_responded_at": null,
            "payment_discrepancy": null,
            "created_at": 1_000u64,
            "updated_at": 2_000u64,
        },
        "status": "Completed",
    });

    let trade: PublicTrade = serde_json::from_value(redacted).expect("a settled trade must decode");
    assert_eq!(trade.status, TradeStatus::Completed);
    assert_eq!(
        trade
            .settlement
            .expect("the settlement half is present")
            .escrow_release_signature
            .as_deref(),
        Some("sig")
    );
}
