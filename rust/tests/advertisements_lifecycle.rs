//! Unit tests for `send_advertisement_disable` and
//! `send_advertisement_price_update` — the two methods that, until they
//! were wired into `openfiat-rpc`'s method table, left a merchant with no
//! way to ever change or take down a published advertisement.
//!
//! This SDK's `openfiat-core` dependencies are pinned to a fixed git
//! revision (see `rust/Cargo.toml`), so `live_node.rs`'s real
//! `openfiat_rpc::router` — built from that same pinned revision — does not
//! yet expose these two methods and can't be used to exercise them here.
//! Instead this spins up a minimal axum server that only captures the
//! JSON-RPC request and answers success, which is enough to drive the SDK's
//! real HTTP transport end to end and check the one thing that actually
//! matters for these builders: the right method name is called, and the
//! signature verifies over the exact JSON bytes of the inner struct — the
//! same bytes `AdvertisementRegistry::apply_status_set`/
//! `apply_terms_update`/`apply_pricing_update` re-derive and check
//! server-side.

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use openfiat_advertisements::AdvertisementId;
use openfiat_advertisements::events::{
    AdvertisementPriceUpdate, AdvertisementStatusSet, AdvertisementTermsUpdate,
    SignedAdvertisementPriceUpdate, SignedAdvertisementStatusSet, SignedAdvertisementTermsUpdate,
};
use openfiat_advertisements::record::{AdvertisementStatus, PricingModel};
use openfiat_network::identity::peer_id_from_public_key;
use openfiat_sdk::wallet::Keypair;
use openfiat_sdk::{Client, ClientConfig};
use openfiat_taxonomy::PaymentMethodRef;
use openfiat_types::{Amount, Timestamp};
use serde_json::Value;
use std::sync::{Arc, Mutex};

async fn handle(
    State(captured): State<Arc<Mutex<Vec<Value>>>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let id = body.get("id").cloned().unwrap_or(Value::Null);
    captured.lock().unwrap().push(body);
    Json(serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": null }))
}

/// Binds an ephemeral loopback port and answers every request with a
/// `"result": null` success, recording each raw request body for the test
/// to inspect afterward.
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

/// Decodes the single captured call's base64 `data` param back into JSON
/// bytes, the same shape `openfiat-rpc`'s `decode_bytes` reads server-side.
fn only_call_data(captured: &Arc<Mutex<Vec<Value>>>) -> Vec<u8> {
    let calls = captured.lock().unwrap();
    assert_eq!(calls.len(), 1, "expected exactly one captured RPC call");
    let data = calls[0]["params"]["data"]
        .as_str()
        .expect("sendX params always carry a base64 `data` string");
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .unwrap()
}

#[tokio::test]
async fn a_status_set_is_submitted_with_a_signature_that_verifies_over_its_json() {
    let (endpoint, captured) = spawn_capturing_server().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });
    let owner = Keypair::generate();

    let set = AdvertisementStatusSet {
        id: AdvertisementId::new("ad-1"),
        merchant: peer_id_from_public_key(&owner.public_key()).unwrap(),
        status: AdvertisementStatus::Vacation,
        timestamp: Timestamp::from_millis(1_000),
    };

    client
        .send_advertisement_status_set(set.clone(), &owner)
        .await
        .expect("the capturing server always answers success");

    {
        let calls = captured.lock().unwrap();
        assert_eq!(calls[0]["method"], "sendAdvertisementStatusSet");
    }

    let bytes = only_call_data(&captured);
    let signed: SignedAdvertisementStatusSet = openfiat_serialization::json::from_bytes(&bytes)
        .expect("the wire payload must decode back into a SignedAdvertisementStatusSet");
    assert_eq!(signed.set, set, "the status set must round-trip unchanged");

    // The node verifies over the JSON of the inner struct, not the envelope
    // — see `AdvertisementRegistry::apply_status_set`.
    let expected_bytes = openfiat_serialization::json::to_bytes(&set).unwrap();
    openfiat_crypto::verify(&owner.public_key(), &expected_bytes, &signed.signature)
        .expect("the builder's own signature must verify against the JSON it signed");
}

#[tokio::test]
async fn a_status_set_signed_by_an_impostor_does_not_verify_against_the_named_merchants_key() {
    let (endpoint, captured) = spawn_capturing_server().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });
    let owner = Keypair::generate();
    let impostor = Keypair::generate();

    // The impostor names the real merchant but can only sign with its own key
    // — this is exactly what `send_advertisement_status_set` does not stop;
    // the node-side signature check is what has to catch it.
    let set = AdvertisementStatusSet {
        id: AdvertisementId::new("ad-1"),
        merchant: peer_id_from_public_key(&owner.public_key()).unwrap(),
        status: AdvertisementStatus::Deleted,
        timestamp: Timestamp::from_millis(1_000),
    };

    client
        .send_advertisement_status_set(set.clone(), &impostor)
        .await
        .expect("the capturing server always answers success regardless of who signed");

    let bytes = only_call_data(&captured);
    let signed: SignedAdvertisementStatusSet =
        openfiat_serialization::json::from_bytes(&bytes).unwrap();
    let expected_bytes = openfiat_serialization::json::to_bytes(&set).unwrap();
    assert!(
        openfiat_crypto::verify(&owner.public_key(), &expected_bytes, &signed.signature).is_err(),
        "a signature from the impostor's key must not verify against the owner's public key"
    );
}

#[tokio::test]
async fn a_price_update_is_submitted_with_a_signature_that_verifies_over_the_update_json() {
    let (endpoint, captured) = spawn_capturing_server().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });
    let owner = Keypair::generate();

    let update = AdvertisementPriceUpdate {
        id: AdvertisementId::new("ad-1"),
        merchant: peer_id_from_public_key(&owner.public_key()).unwrap(),
        pricing: PricingModel::Fixed {
            price: Amount::new(200, 2),
        },
        timestamp: Timestamp::from_millis(2_000),
    };

    client
        .send_advertisement_price_update(update.clone(), &owner)
        .await
        .expect("the capturing server always answers success");

    {
        let calls = captured.lock().unwrap();
        assert_eq!(calls[0]["method"], "sendAdvertisementPriceUpdate");
    }

    let bytes = only_call_data(&captured);
    let signed: SignedAdvertisementPriceUpdate = openfiat_serialization::json::from_bytes(&bytes)
        .expect("the wire payload must decode back into a SignedAdvertisementPriceUpdate");
    assert_eq!(
        signed.update, update,
        "the price update must round-trip unchanged"
    );

    let expected_bytes = openfiat_serialization::json::to_bytes(&update).unwrap();
    openfiat_crypto::verify(&owner.public_key(), &expected_bytes, &signed.signature)
        .expect("the builder's own signature must verify against the JSON it signed");
}

#[tokio::test]
async fn a_price_update_signed_by_an_impostor_does_not_verify_against_the_named_merchants_key() {
    let (endpoint, captured) = spawn_capturing_server().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });
    let owner = Keypair::generate();
    let impostor = Keypair::generate();

    let update = AdvertisementPriceUpdate {
        id: AdvertisementId::new("ad-1"),
        merchant: peer_id_from_public_key(&owner.public_key()).unwrap(),
        pricing: PricingModel::Fixed {
            price: Amount::new(99_900, 2),
        },
        timestamp: Timestamp::from_millis(2_000),
    };

    client
        .send_advertisement_price_update(update.clone(), &impostor)
        .await
        .expect("the capturing server always answers success regardless of who signed");

    let bytes = only_call_data(&captured);
    let signed: SignedAdvertisementPriceUpdate =
        openfiat_serialization::json::from_bytes(&bytes).unwrap();
    let expected_bytes = openfiat_serialization::json::to_bytes(&update).unwrap();
    assert!(
        openfiat_crypto::verify(&owner.public_key(), &expected_bytes, &signed.signature).is_err(),
        "a signature from the impostor's key must not verify against the owner's public key"
    );
}

#[tokio::test]
async fn a_terms_update_is_submitted_with_a_signature_that_verifies_over_its_json() {
    let (endpoint, captured) = spawn_capturing_server().await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });
    let owner = Keypair::generate();

    let update = AdvertisementTermsUpdate {
        id: AdvertisementId::new("ad-1"),
        merchant: peer_id_from_public_key(&owner.public_key()).unwrap(),
        min_trade: Amount::new(5_000_000, 6),
        max_trade: Amount::new(500_000_000, 6),
        payment_methods: vec![
            PaymentMethodRef::builtin("bank-transfer").unwrap(),
            PaymentMethodRef::builtin("mpesa-kenya").unwrap(),
        ],
        timestamp: Timestamp::from_millis(1_000),
    };

    client
        .send_advertisement_terms_update(update.clone(), &owner)
        .await
        .expect("the capturing server always answers success");

    {
        let calls = captured.lock().unwrap();
        assert_eq!(calls[0]["method"], "sendAdvertisementTermsUpdate");
    }

    let bytes = only_call_data(&captured);
    let signed: SignedAdvertisementTermsUpdate = openfiat_serialization::json::from_bytes(&bytes)
        .expect("the wire payload must decode back into a SignedAdvertisementTermsUpdate");
    // The payment methods in particular: they are a Vec on the wire, and a
    // builder that reordered or deduplicated them would change what the
    // merchant signed.
    assert_eq!(signed.update, update);

    let expected_bytes = openfiat_serialization::json::to_bytes(&update).unwrap();
    openfiat_crypto::verify(&owner.public_key(), &expected_bytes, &signed.signature)
        .expect("the builder's own signature must verify against the JSON it signed");
}
