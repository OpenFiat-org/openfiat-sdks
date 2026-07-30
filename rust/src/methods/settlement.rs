//! Settlement methods (OFS-2300).

use crate::client::{Client, IdParams};
use crate::error::Result;
use crate::methods::redaction::PublicSettlement;
use openfiat_crypto::Keypair;
use openfiat_settlement::events::{
    PaymentSubmitted, SettlementApproved, SettlementInitiate, SignedPaymentSubmitted,
    SignedSettlementApproved, SignedSettlementInitiate,
};
use openfiat_settlement::{Settlement, SettlementId};

/// Domain separator for `getMySettlements`, transcribed from
/// `openfiat-rpc`'s `methods::settlement::CHALLENGE_DOMAIN`. A signature
/// collected on another gated surface can never be presented here, even
/// though both draw their nonces from the same ledger.
pub const CHALLENGE_DOMAIN: &str = "openfiat-my-settlements";

impl Client {
    /// Read one settlement as a stranger sees it — no parties, no
    /// payment reference. See [`PublicSettlement`] for why this is a
    /// different type rather than the same one with holes in it, and
    /// [`Client::get_my_settlements`] for the unredacted read.
    pub async fn get_settlement(&self, id: impl Into<String>) -> Result<Option<PublicSettlement>> {
        self.call("getSettlement", IdParams { id: id.into() }).await
    }

    /// Every settlement on the network, redacted — the public volume and
    /// state view an explorer wants.
    pub async fn get_settlements(&self) -> Result<Vec<PublicSettlement>> {
        self.call("getSettlements", ()).await
    }

    /// Every settlement `keypair`'s wallet is the buyer or the seller of,
    /// in full, proved by signing a freshly issued wallet challenge.
    ///
    /// Nothing is disclosed here that the caller was not already party
    /// to: they know who they traded with, and withholding it would
    /// protect nobody while breaking the trade room.
    pub async fn get_my_settlements(&self, keypair: &Keypair) -> Result<Vec<Settlement>> {
        let proof = self.wallet_proof(keypair, CHALLENGE_DOMAIN).await?;
        self.call("getMySettlements", proof).await
    }

    pub async fn send_settlement_initiate(
        &self,
        initiate: SettlementInitiate,
        keypair: &Keypair,
    ) -> Result<SettlementId> {
        let signed = SignedSettlementInitiate::sign(initiate, keypair);
        let id: String = self.send_signed("sendSettlementInitiate", &signed).await?;
        Ok(SettlementId::new(id))
    }

    pub async fn send_payment_submitted(
        &self,
        payment: PaymentSubmitted,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedPaymentSubmitted::sign(payment, keypair);
        self.send_signed("sendPaymentSubmitted", &signed).await
    }

    pub async fn send_settlement_approved(
        &self,
        approved: SettlementApproved,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedSettlementApproved::sign(approved, keypair);
        self.send_signed("sendSettlementApproved", &signed).await
    }
}
