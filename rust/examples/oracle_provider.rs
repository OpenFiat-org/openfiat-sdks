//! A complete Oracle Provider (OFS-7000): register with a node's
//! Service Registry, then publish a signed exchange-rate record.
//!
//! Run against a local node with `cargo run --example oracle_provider`.
//! By default it targets `http://localhost:7080` — start one with
//! `CLI_HTTP_ADDR=127.0.0.1:7080 cargo run -p openfiat-cli` from
//! `openfiat-core`.

use openfiat_oracles::OracleId;
use openfiat_oracles::events::OraclePublish;
use openfiat_oracles::record::OracleData;
use openfiat_registry::Registration;
use openfiat_sdk::wallet::Keypair;
use openfiat_sdk::{Client, ClientConfig};
use openfiat_types::{MarketDataService, PeerId, ServiceId, ServiceType, Timestamp};

fn peer_id(keypair: &Keypair) -> PeerId {
    openfiat_network::identity::peer_id_from_public_key(&keypair.public_key())
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
    let keypair = Keypair::generate();
    let provider = peer_id(&keypair);

    println!("registering as an Oracle Provider ({provider:?})...");
    let registration = Registration {
        service_id: ServiceId::new("example-oracle-1"),
        service_type: ServiceType::MarketData(MarketDataService::FxOracle),
        provider: provider.clone(),
        provider_public_key: keypair.public_key(),
        endpoints: vec!["/ip4/127.0.0.1/udp/4001/quic-v1".to_string()],
        supported_ofs: vec![1500, 7000],
        region: Some("Kenya".to_string()),
        capabilities: vec!["USDC/KES".to_string()],
        branding: None,
        pricing: None,
        payout_wallet: None,
        timestamp: Timestamp::now(),
    };
    let service_id = client
        .send_provider_register(registration, &keypair)
        .await?;
    println!("registered as service {}", service_id.as_str());

    println!("publishing USDC/KES exchange rate...");
    let now = Timestamp::now();
    let publish = OraclePublish {
        id: OracleId::new("usdc-kes"),
        provider,
        provider_public_key: keypair.public_key(),
        data: OracleData::ExchangeRate {
            base: "USDC".to_string(),
            quote: "KES".to_string(),
            rate: 129.52,
        },
        version: 1,
        timestamp: now,
        expires_at: Timestamp::from_millis(now.as_millis() + 60_000),
    };
    let oracle_id = client.send_oracle_publish(publish, &keypair).await?;
    println!("published oracle record {}", oracle_id.as_str());

    let median = client
        .get_median_exchange_rate("USDC", "KES")
        .await?
        .expect("just published a rate for this pair");
    println!("median USDC/KES rate across all providers: {median}");

    Ok(())
}
