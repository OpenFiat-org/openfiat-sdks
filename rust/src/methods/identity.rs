//! Identity claim methods (OFS-5000).

use crate::client::{Client, IdParams, WalletParams, encode_peer_id};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_identity::events::{ClaimPublish, SignedClaimPublish};
use openfiat_identity::{Claim, ClaimId};
use openfiat_types::PeerId;

impl Client {
    pub async fn get_identity_claim(&self, id: impl Into<String>) -> Result<Option<Claim>> {
        self.call("getIdentityClaim", IdParams { id: id.into() })
            .await
    }

    pub async fn get_identity_claims_by_wallet(&self, wallet: &PeerId) -> Result<Vec<Claim>> {
        self.call(
            "getIdentityClaimsByWallet",
            WalletParams {
                wallet: encode_peer_id(wallet),
            },
        )
        .await
    }

    pub async fn send_claim_publish(
        &self,
        publish: ClaimPublish,
        keypair: &Keypair,
    ) -> Result<ClaimId> {
        let signed = SignedClaimPublish::sign(publish, keypair);
        let id: String = self.send_signed("sendClaimPublish", &signed).await?;
        Ok(ClaimId::new(id))
    }
}
