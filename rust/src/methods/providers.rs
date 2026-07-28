//! Service Registry methods (OFS-1500) — backs notification/oracle/
//! risk/snapshot provider discovery.

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_registry::{Registration, ServiceRecord, SignedRegistration};
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
}
