//! Oracle methods (OFS-7000) — the surface an oracle provider service
//! actually integrates against; see `examples/oracle_provider.rs`.

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_oracles::events::{OraclePublish, SignedOraclePublish};
use openfiat_oracles::{OracleId, OracleRecord};
use serde::Serialize;

#[derive(Debug, Serialize)]
struct ExchangeRateParams {
    base: String,
    quote: String,
}

impl Client {
    pub async fn get_oracle_record(&self, id: impl Into<String>) -> Result<Option<OracleRecord>> {
        self.call("getOracleRecord", IdParams { id: id.into() })
            .await
    }

    pub async fn get_oracle_records(&self) -> Result<Vec<OracleRecord>> {
        self.call("getOracleRecords", ()).await
    }

    /// The median exchange rate across every registered Oracle Provider
    /// for this currency/asset pair (OFS-7000 §11), if any provider has
    /// published one.
    pub async fn get_median_exchange_rate(
        &self,
        base: impl Into<String>,
        quote: impl Into<String>,
    ) -> Result<Option<f64>> {
        self.call(
            "getMedianExchangeRate",
            ExchangeRateParams {
                base: base.into(),
                quote: quote.into(),
            },
        )
        .await
    }

    /// Publish a new or updated oracle record under `keypair`'s identity
    /// — `keypair` must already be registered as an Oracle Provider (see
    /// [`Client::send_provider_register`]) or the node will reject it.
    pub async fn send_oracle_publish(
        &self,
        publish: OraclePublish,
        keypair: &Keypair,
    ) -> Result<OracleId> {
        let signed = SignedOraclePublish::sign(publish, keypair);
        let id: String = self.send_signed("sendOraclePublish", &signed).await?;
        Ok(OracleId::new(id))
    }
}
