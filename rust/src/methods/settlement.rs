//! Settlement methods (OFS-2300).

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_settlement::events::{
    PaymentSubmitted, SettlementApproved, SettlementInitiate, SignedPaymentSubmitted,
    SignedSettlementApproved, SignedSettlementInitiate,
};
use openfiat_settlement::{Settlement, SettlementId};

impl Client {
    pub async fn get_settlement(&self, id: impl Into<String>) -> Result<Option<Settlement>> {
        self.call("getSettlement", IdParams { id: id.into() }).await
    }

    pub async fn get_settlements(&self) -> Result<Vec<Settlement>> {
        self.call("getSettlements", ()).await
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
