//! `getAdvertisements`, which grew a filter and a cursor and changed the
//! shape of its reply from a bare array to `{ advertisements, next_cursor }`.
//!
//! Offline, against a server that only records requests and replays
//! scripted replies, because this SDK's `openfiat-core` dependencies are
//! pinned to a fixed git revision (see `rust/Cargo.toml`) and the node
//! built from that revision answers with the old array — `live_node.rs`
//! could only prove the shape this change removed. What a capturing server
//! *can* prove is the whole of the contract that lives on this side of the
//! wire: that the narrowing goes out in the request rather than being
//! applied to the reply, and that the resume point is the node's own
//! cursor handed back untouched.
//!
//! What it cannot prove is that the rows inside the envelope decode from a
//! current node. They are `openfiat_advertisements::Advertisement` at the
//! pinned revision, which still names its asset `asset` rather than
//! `asset_mint`; the fixture below is built through that type on purpose,
//! so bumping the pin turns this into a compile error at the exact field
//! that changed instead of a passing test about the wrong shape.
//!
//! The two request bodies asserted here — `{"filter":{},"page":{}}` and a
//! fully populated filter with a `page.limit` — were each replayed by hand
//! against a node built from `openfiat-core` at HEAD and answered
//! correctly, so the request half is known good and only the reply half is
//! waiting on the pin. That check is a manual one and deliberately not
//! automated here: automating it would mean this suite building a whole
//! node from an unpinned revision, which is the thing the pin exists to
//! stop.

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use openfiat_advertisements::record::PricingModel;
use openfiat_advertisements::{Advertisement, AdvertisementId, AdvertisementStatus, Direction};
use openfiat_network::identity::peer_id_from_public_key;
use openfiat_sdk::methods::advertisements::{
    AdvertisementFilter, AdvertisementPageRequest, AdvertisementQuery,
};
use openfiat_sdk::wallet::Keypair;
use openfiat_sdk::{Client, ClientConfig};
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

struct Script {
    captured: Mutex<Vec<Value>>,
    replies: Mutex<VecDeque<Value>>,
}

async fn handle(State(script): State<Arc<Script>>, Json(body): Json<Value>) -> Json<Value> {
    let id = body.get("id").cloned().unwrap_or(Value::Null);
    script.captured.lock().unwrap().push(body);
    let result = script
        .replies
        .lock()
        .unwrap()
        .pop_front()
        .unwrap_or_else(|| json!({ "advertisements": [], "next_cursor": null }));
    Json(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// Binds an ephemeral loopback port, answers each call with the next
/// scripted page, and records every request body for inspection.
async fn spawn(replies: Vec<Value>) -> (Client, Arc<Script>) {
    let script = Arc::new(Script {
        captured: Mutex::new(Vec::new()),
        replies: Mutex::new(replies.into()),
    });
    let router = Router::new()
        .route("/rpc", post(handle))
        .with_state(script.clone());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind an ephemeral port");
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    let client = Client::new(ClientConfig {
        endpoint: format!("http://{addr}"),
        timeout_ms: 5_000,
    });
    (client, script)
}

fn params(script: &Arc<Script>, index: usize) -> Value {
    script.captured.lock().unwrap()[index]["params"].clone()
}

/// One row in exactly the shape this SDK's pinned `Advertisement` decodes
/// from — serialized through the type itself rather than hand-written JSON,
/// so the two cannot describe different fields.
fn row(id: &str) -> Value {
    let keypair = Keypair::from_seed([7u8; 32]);
    serde_json::to_value(Advertisement {
        id: AdvertisementId::new(id),
        merchant: peer_id_from_public_key(&keypair.public_key()).unwrap(),
        merchant_public_key: keypair.public_key(),
        asset: "USDC".to_string(),
        direction: Direction::Sell,
        fiat_currency: "KES".to_string(),
        min_trade: openfiat_types::Amount::new(1_000, 2),
        max_trade: openfiat_types::Amount::new(50_000, 2),
        available_liquidity: openfiat_types::Amount::new(200_000, 2),
        pricing: PricingModel::Fixed {
            price: openfiat_types::Amount::new(12_950, 2),
        },
        payment_methods: vec!["M-Pesa".to_string()],
        status: AdvertisementStatus::Active,
        created_at: openfiat_types::Timestamp::from_millis(1),
        updated_at: openfiat_types::Timestamp::from_millis(1),
    })
    .unwrap()
}

#[tokio::test]
async fn a_default_query_asks_for_the_first_page_of_the_whole_active_book() {
    let (client, script) = spawn(vec![json!({
        "advertisements": [row("ad-1")],
        "next_cursor": null,
    })])
    .await;

    let page = client
        .get_advertisements(&AdvertisementQuery::default())
        .await
        .expect("a default query is a valid request");

    // Empty objects, not omitted keys and not a wall of explicit nulls:
    // the node reads both halves with `#[serde(default)]`, so this is the
    // unparameterised call that existed before filtering did.
    assert_eq!(params(&script, 0), json!({ "filter": {}, "page": {} }));
    assert_eq!(page.advertisements.len(), 1);
    assert_eq!(page.advertisements[0].id.as_str(), "ad-1");
    assert_eq!(page.next_cursor, None);
}

#[tokio::test]
async fn the_filter_travels_in_the_request_rather_than_being_applied_to_the_reply() {
    let (client, script) = spawn(vec![json!({ "advertisements": [], "next_cursor": null })]).await;

    client
        .get_advertisements(&AdvertisementQuery {
            filter: AdvertisementFilter {
                asset_mint: Some("2bHPi5hA4zrmPAfrvLmEexg3KJjpTjNkUcxWnzUPeRRU".to_string()),
                fiat_currency: Some("kes".to_string()),
                direction: Some(Direction::Sell),
                payment_method: Some("M-Pesa".to_string()),
                amount: Some(openfiat_types::Amount::new(5_000, 2)),
                status: None,
            },
            page: AdvertisementPageRequest {
                after: None,
                limit: Some(2),
            },
        })
        .await
        .unwrap();

    // Every constraint the caller named, and nothing they did not — an
    // absent `status` stays absent so the node applies its own default of
    // "active only" rather than being told something the caller never
    // said. The amount keeps its `decimals`: the node compares at the
    // advertisement's own scale and matches nothing at another one, so an
    // SDK restating it would turn a caller's mistake into an empty book
    // they could not explain.
    assert_eq!(
        params(&script, 0),
        json!({
            "filter": {
                "asset_mint": "2bHPi5hA4zrmPAfrvLmEexg3KJjpTjNkUcxWnzUPeRRU",
                "fiat_currency": "kes",
                "direction": "Sell",
                "payment_method": "M-Pesa",
                "amount": { "base_units": 5_000, "decimals": 2 },
            },
            "page": { "limit": 2 },
        })
    );
}

#[tokio::test]
async fn the_next_page_resumes_from_the_cursor_the_node_returned_verbatim() {
    // The second page's rows sort *before* the first page's cursor, which
    // no resume point derived from the rows could ever produce. The cursor
    // is opaque to this SDK and stays that way.
    let (client, script) = spawn(vec![
        json!({
            "advertisements": [row("ad-8"), row("ad-9")],
            "next_cursor": "ad-9",
        }),
        json!({ "advertisements": [row("ad-2")], "next_cursor": null }),
    ])
    .await;

    let mut query = AdvertisementQuery {
        filter: AdvertisementFilter {
            fiat_currency: Some("KES".to_string()),
            ..Default::default()
        },
        page: AdvertisementPageRequest {
            after: None,
            limit: Some(2),
        },
    };
    let first = client.get_advertisements(&query).await.unwrap();
    query.page.after = first.next_cursor.clone();
    let second = client.get_advertisements(&query).await.unwrap();

    assert_eq!(
        first.next_cursor.as_ref().map(AdvertisementId::as_str),
        Some("ad-9")
    );
    assert_eq!(second.advertisements[0].id.as_str(), "ad-2");
    assert_eq!(second.next_cursor, None);

    // The cursor goes back exactly as it arrived, and the filter goes with
    // it — one that travelled only on the first request would let the rest
    // of the book back in halfway down the scroll.
    assert_eq!(
        params(&script, 1),
        json!({
            "filter": { "fiat_currency": "KES" },
            "page": { "after": "ad-9", "limit": 2 },
        })
    );
}

#[tokio::test]
async fn a_reply_in_the_old_shape_fails_to_decode_rather_than_reading_as_an_empty_page() {
    // The bare array `getAdvertisements` used to answer with. A build
    // still speaking it is broken, and the honest failure is a decode
    // error naming the missing fields — not a page that quietly claims the
    // book is empty and stops.
    let (client, _script) = spawn(vec![json!([row("ad-1")])]).await;

    let error = client
        .get_advertisements(&AdvertisementQuery::default())
        .await
        .expect_err("an array is not a page");
    assert!(
        matches!(error, openfiat_sdk::Error::Decode(_)),
        "expected a decode failure, got {error:?}"
    );
}
