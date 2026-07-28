//! Reputation methods (OFS-3000) — a pure read-side view, no `sendX`.

use crate::client::{Client, WalletParams, encode_peer_id};
use crate::error::Result;
use openfiat_reputation::ReputationProfile;
use openfiat_types::PeerId;

impl Client {
    pub async fn get_reputation(&self, wallet: &PeerId) -> Result<ReputationProfile> {
        self.call(
            "getReputation",
            WalletParams {
                wallet: encode_peer_id(wallet),
            },
        )
        .await
    }
}
