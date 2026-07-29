//! Service Registry methods (OFS-1500) — backs notification/oracle/
//! risk/snapshot provider discovery.

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_registry::{
    HealthUpdate, Registration, ServiceRecord, SignedHealthUpdate, SignedRegistration,
    SignedWithdrawal, Withdrawal,
};
use openfiat_types::ServiceId;

impl Client {
    pub async fn get_provider(&self, id: impl Into<String>) -> Result<Option<ServiceRecord>> {
        self.call("getProvider", IdParams { id: id.into() }).await
    }

    pub async fn get_providers(&self) -> Result<Vec<ServiceRecord>> {
        self.call("getProviders", ()).await
    }

    pub async fn send_provider_register(
        &self,
        registration: Registration,
        keypair: &Keypair,
    ) -> Result<ServiceId> {
        let signed = SignedRegistration::sign(registration, keypair);
        let id: String = self.send_signed("sendProviderRegister", &signed).await?;
        Ok(ServiceId::new(id))
    }

    /// Publish a health update (OFS-1500 §11). A node expires services it
    /// has not seen an update for, so a long-running provider must call
    /// this on an interval to stay in the registry.
    pub async fn send_provider_health_update(
        &self,
        update: HealthUpdate,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedHealthUpdate::sign(update, keypair);
        self.send_signed("sendProviderHealthUpdate", &signed).await
    }

    /// Voluntarily withdraw a service (OFS-1500 §17). Verified against the
    /// key already on file, so only the registrant can withdraw it.
    pub async fn send_provider_withdraw(
        &self,
        withdrawal: Withdrawal,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedWithdrawal::sign(withdrawal, keypair);
        self.send_signed("sendProviderWithdraw", &signed).await
    }
}
