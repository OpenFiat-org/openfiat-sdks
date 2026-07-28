//! Risk intelligence methods (OFS-7100).

use crate::client::{Client, WalletParams, encode_peer_id};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_risk::events::{RiskPublish, SignedRiskPublish};
use openfiat_risk::{RiskRecord, ScreeningResult};
use openfiat_types::PeerId;

impl Client {
    pub async fn get_risk_records_by_wallet(&self, wallet: &PeerId) -> Result<Vec<RiskRecord>> {
        self.call(
            "getRiskRecordsByWallet",
            WalletParams {
                wallet: encode_peer_id(wallet),
            },
        )
        .await
    }

    /// OFS-7100 §11's wallet-screening workflow: the aggregated outcome
    /// across every Risk Intelligence Provider that has flagged (or
    /// cleared) this wallet.
    pub async fn get_wallet_screening(&self, wallet: &PeerId) -> Result<ScreeningResult> {
        self.call(
            "getWalletScreening",
            WalletParams {
                wallet: encode_peer_id(wallet),
            },
        )
        .await
    }

    pub async fn send_risk_publish(&self, publish: RiskPublish, keypair: &Keypair) -> Result<()> {
        let signed = SignedRiskPublish::sign(publish, keypair);
        self.send_signed("sendRiskPublish", &signed).await
    }
}
