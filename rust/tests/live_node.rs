//! Proves the SDK's transport, typed methods, and wallet signing against
//! a real running node — the same `rpc`+`api` axum router `openfiat-cli`
//! serves, bound to a real ephemeral TCP port in-process (rather than
//! shelling out to the `openfiat-node` binary, which isn't reachable
//! as a git dependency the way the library crates are).

use openfiat_governance::events::ProposalCreate;
use openfiat_governance::record::ProposalCategory;
use openfiat_network::identity::peer_id_from_public_key;
use openfiat_sdk::wallet::Keypair;
use openfiat_sdk::{Client, ClientConfig};
use openfiat_storage::mem::MemoryStore;
use openfiat_types::Timestamp;
use std::sync::Arc;

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
