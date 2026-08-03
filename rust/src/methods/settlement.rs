//! Settlement methods (OFS-2300).

use crate::client::{Client, IdParams};
use crate::error::Result;
use crate::methods::redaction::PublicSettlement;
use openfiat_crypto::Keypair;
use openfiat_settlement::events::{
    PaymentReversed, PaymentSubmitted, SettlementApproved, SettlementCancelled, SettlementInitiate,
    SettlementRejected, SignedPaymentReversed, SignedPaymentSubmitted, SignedSettlementApproved,
    SignedSettlementCancelled, SignedSettlementInitiate, SignedSettlementRejected,
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

    /// The buyer taking "I paid" back, for a declaration made in error.
    ///
    /// `keypair` must be the settlement's buyer, and the settlement must
    /// still be in `PaymentSubmitted` — once the merchant has approved or
    /// rejected it this is refused, so it can never undo a decision
    /// already taken. It returns the settlement to `AwaitingPayment` and
    /// clears both `payment_reference` and `payment_submitted_at`, so the
    /// buyer is not credited with a payment they withdrew and the
    /// merchant is not faulted for failing to answer one.
    ///
    /// Confirm with the user before calling this. Returning to
    /// `AwaitingPayment` re-arms [`Client::send_settlement_cancelled`]
    /// for either party, so a buyer whose fiat has genuinely left their
    /// account and who reverses anyway has handed the merchant a window
    /// to cancel the trade out from under the money. Reverse a mis-click;
    /// for a real payment, open a dispute.
    pub async fn send_payment_reversed(
        &self,
        reversed: PaymentReversed,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedPaymentReversed::sign(reversed, keypair);
        self.send_signed("sendPaymentReversed", &signed).await
    }

    pub async fn send_settlement_approved(
        &self,
        approved: SettlementApproved,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedSettlementApproved::sign(approved, keypair);
        self.send_signed("sendSettlementApproved", &signed).await
    }

    /// The merchant refusing a payment they cannot find, without opening
    /// a dispute over it.
    ///
    /// `keypair` must be the settlement's seller, and the settlement must
    /// be in `PaymentSubmitted` — there is nothing to reject before the
    /// buyer has declared payment, and a buyer cannot reject their own.
    ///
    /// A rejection is the merchant's recorded claim, not a ruling: a
    /// buyer who really did pay can still open a dispute afterwards. What
    /// it changes is who pays to escalate, instead of charging the
    /// merchant a filing fee to say no.
    ///
    /// Set [`SettlementRejected::discrepancy`] to the kind that actually
    /// applies rather than `Other`. That field is what reputation counts;
    /// `reason` is prose nothing parses.
    pub async fn send_settlement_rejected(
        &self,
        rejected: SettlementRejected,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedSettlementRejected::sign(rejected, keypair);
        self.send_signed("sendSettlementRejected", &signed).await
    }

    /// Either party walking away from a settlement, before any payment is
    /// declared.
    ///
    /// [`SettlementCancelled::canceller`] must be the settlement's own
    /// buyer or seller and must be the wallet `keypair` belongs to: the
    /// node picks the verifying key by matching that field against the
    /// stored settlement, so naming someone else fails either the party
    /// check or the signature check that follows it.
    ///
    /// Legal only from `AwaitingPayment`, and that restriction is the
    /// security property rather than a formality — it is what stops a
    /// merchant cancelling a settlement out from under a payment already
    /// made. The one window it cannot close is between a buyer wiring
    /// fiat and that buyer declaring it, so call
    /// [`Client::send_payment_submitted`] before the money leaves, not
    /// after it lands.
    pub async fn send_settlement_cancelled(
        &self,
        cancelled: SettlementCancelled,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedSettlementCancelled::sign(cancelled, keypair);
        self.send_signed("sendSettlementCancelled", &signed).await
    }
}
