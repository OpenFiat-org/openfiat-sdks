//! Service Registry methods (OFS-1500) — backs notification/oracle/
//! risk/snapshot provider discovery.

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_registry::earnings::{EarningsChallenge, ProviderEarnings};
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

    /// Ask for a single-use challenge to read a service's earnings
    /// (OFS-4100 §9.5). Prefer [`Client::get_provider_earnings`], which
    /// performs both steps; this is exposed for callers whose signing key
    /// lives somewhere the SDK cannot reach, such as a browser wallet.
    pub async fn get_provider_earnings_challenge(
        &self,
        id: impl Into<String>,
    ) -> Result<EarningsChallenge> {
        self.call("getProviderEarningsChallenge", IdParams { id: id.into() })
            .await
    }

    /// Read a service's earnings statement, proving control of it by
    /// signing a freshly issued challenge.
    ///
    /// The statement is empty for every service today: the billing
    /// trigger differs by role and is deliberately unsettled (OFS-4100
    /// §9.5), so nothing credits the ledger yet. `keypair` must be the
    /// key the service was registered with.
    pub async fn get_provider_earnings(
        &self,
        id: impl Into<String>,
        keypair: &Keypair,
    ) -> Result<ProviderEarnings> {
        let id = id.into();
        let challenge = self.get_provider_earnings_challenge(id.clone()).await?;
        let signature = keypair.sign(&challenge.signing_bytes());
        self.call(
            "getProviderEarnings",
            EarningsParams {
                id,
                nonce: challenge.nonce,
                signature: crate::client::encode_base64(
                    &signature
                        .as_bytes()
                        .expect("a freshly signed signature is always 64 bytes"),
                ),
            },
        )
        .await
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

/// Answers an earnings challenge: the service, the nonce it was issued
/// under, and a base64 signature over the challenge's own bytes.
#[derive(serde::Serialize)]
struct EarningsParams {
    id: String,
    nonce: String,
    signature: String,
}
