//! Advertisement methods (OFS-2100).

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_advertisements::events::{AdvertisementCreate, SignedAdvertisementCreate};
use openfiat_advertisements::{Advertisement, AdvertisementId};
use openfiat_crypto::Keypair;

impl Client {
    pub async fn get_advertisement(&self, id: impl Into<String>) -> Result<Option<Advertisement>> {
        self.call("getAdvertisement", IdParams { id: id.into() })
            .await
    }

    pub async fn get_advertisements(&self) -> Result<Vec<Advertisement>> {
        self.call("getAdvertisements", ()).await
    }

    /// Signs `create` with `keypair` and submits it. Returns the new
    /// advertisement's ID.
    pub async fn send_advertisement_create(
        &self,
        create: AdvertisementCreate,
        keypair: &Keypair,
    ) -> Result<AdvertisementId> {
        let signed = SignedAdvertisementCreate::sign(create, keypair);
        let id: String = self.send_signed("sendAdvertisementCreate", &signed).await?;
        Ok(AdvertisementId::new(id))
    }
}
