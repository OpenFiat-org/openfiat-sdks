//! Advertisement methods (OFS-2100).
//!
//! # These are broken against a current node, and cannot be fixed here
//!
//! An advertisement now names its asset by mint address —
//! `asset_mint: MintAddress` replaced `asset: String`, because a ticker
//! on a record is a label the merchant chose and nothing tied it to the
//! token the escrow would actually move; an ad could say "USDC" and
//! settle in something else, with every layer agreeing the trade
//! completed. A reader also gets `asset_symbol` alongside the record,
//! resolved from the mint *by the node* rather than supplied by the
//! merchant.
//!
//! Every shape below is `openfiat-advertisements`', imported so this SDK
//! and a real node cannot describe different wire formats. That is
//! working as intended and is exactly why nothing here can be patched:
//! `rust/Cargo.toml` pins `openfiat-core` to a revision that predates the
//! change, so `Advertisement` here still has `asset`, and neither
//! `MintAddress` nor `asset_symbol` exists to write down. A build against
//! that pin fails to decode a current node's reply with ``missing field
//! `asset` ``, and a `sendAdvertisementCreate` it builds is refused for
//! the same reason in the other direction.
//!
//! Bumping the pin is the whole fix, and it is its own piece of work —
//! these methods correct themselves the moment it lands, since the types
//! come from there. The TypeScript SDK, which transcribes its shapes
//! rather than importing them, is already on the new field and is proved
//! against a node at HEAD.

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_advertisements::events::{
    AdvertisementCreate, AdvertisementDisable, AdvertisementPriceUpdate, SignedAdvertisementCreate,
    SignedAdvertisementDisable, SignedAdvertisementPriceUpdate,
};
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

    /// Signs `disable` with `keypair` and submits it. Only a signature from
    /// the ad's original merchant key will be accepted — see
    /// `AdvertisementDisable`.
    pub async fn send_advertisement_disable(
        &self,
        disable: AdvertisementDisable,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedAdvertisementDisable::sign(disable, keypair);
        self.send_signed("sendAdvertisementDisable", &signed).await
    }

    /// Signs `update` with `keypair` and submits it — repricing an existing
    /// ad in place rather than disabling and recreating it (§17).
    pub async fn send_advertisement_price_update(
        &self,
        update: AdvertisementPriceUpdate,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedAdvertisementPriceUpdate::sign(update, keypair);
        self.send_signed("sendAdvertisementPriceUpdate", &signed)
            .await
    }
}
