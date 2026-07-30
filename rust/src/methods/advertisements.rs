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
//!
//! The same pin is why [`AdvertisementFilter`] and
//! [`AdvertisementPageRequest`] below are written out here instead of
//! re-exported: at HEAD they are `openfiat_advertisements::query`'s own
//! `AdvertisementFilter` and `Page`, deriving both halves of `serde`, and
//! that module does not exist at the pinned revision. They become
//! re-exports the moment it moves, and their one deliberate deviation —
//! `asset_mint` as a `String` rather than a `MintAddress` — becomes a
//! type error at the same instant, which is the point of writing it down
//! this way rather than leaving the whole thing out.
//!
//! What that leaves unproven is only the row shape. The paging envelope
//! and the request are exercised offline against a capturing server in
//! `tests/advertisements_paging.rs`; that the rows inside it decode from
//! a *current* node cannot be shown from here, because the pinned
//! `Advertisement` is the wrong shape to decode them into.

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_advertisements::events::{
    AdvertisementCreate, AdvertisementDisable, AdvertisementPriceUpdate, SignedAdvertisementCreate,
    SignedAdvertisementDisable, SignedAdvertisementPriceUpdate,
};
use openfiat_advertisements::{Advertisement, AdvertisementId, AdvertisementStatus, Direction};
use openfiat_crypto::Keypair;
use openfiat_types::Amount;

/// What a trader actually chooses by, sent to the node rather than
/// applied to the reply.
///
/// Every field is `None` by default and `None` means "no constraint", so
/// [`AdvertisementFilter::default()`] is the whole active book. The
/// narrowing has to happen in the request: a node asked for everything
/// serializes every advertisement on the network before the caller sees
/// any of it, and discarding rows afterwards also mis-drives the cursor,
/// since the page boundary was decided over rows the caller then threw
/// away. That is why this SDK offers nothing that filters a returned
/// page.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct AdvertisementFilter {
    /// The token being traded, by mint address — an identity, not a
    /// ticker. Base58, 32 bytes; the node refuses anything else at
    /// decode.
    ///
    /// A `String` only because `MintAddress` postdates the pinned
    /// revision (see this module's own note). It is the same base58 text
    /// on the wire either way.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_mint: Option<String>,
    /// Matched case-insensitively — a currency code is a code, and `kes`
    /// finds the same offers as `KES`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fiat_currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<Direction>,
    /// Matches an advertisement listing this among possibly several,
    /// case-insensitively.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_method: Option<String>,
    /// Only advertisements that could take a trade of this size — inside
    /// `min_trade`/`max_trade` and within remaining liquidity. A buyer
    /// with 50 USDC does not want to read about offers starting at 500.
    ///
    /// **Scale-sensitive, deliberately.** The comparison is in base units
    /// at the advertisement's own scale, and an amount whose `decimals`
    /// differ from the advertisement's matches *nothing* rather than
    /// being rescaled: `Amount::new(50, 0)` against a book quoted at six
    /// decimals returns an empty page, not the offers around 50. 10.000000
    /// and 10.00 are the same value written two ways, and guessing which
    /// was meant would answer a question the caller did not put. An
    /// unexpectedly empty result here is almost always this.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<Amount>,
    /// Defaults to [`AdvertisementStatus::Active`]. Something disabled or
    /// deleted cannot be traded against, so returning it by default would
    /// be offering what is not on offer; naming a status is a merchant
    /// reviewing their own book.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<AdvertisementStatus>,
}

/// Where to resume from, and how much to take.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct AdvertisementPageRequest {
    /// The previous page's [`AdvertisementPage::next_cursor`], passed back
    /// **verbatim**.
    ///
    /// It happens to be an advertisement id, and it is still not one to
    /// build from the last row you received: doing that means
    /// reimplementing the node's ordering, and a reader whose ordering
    /// disagrees with the node's is handed some rows twice and others
    /// never, with nothing to say so. The cursor travels beside the rows
    /// precisely so neither side has to guess.
    ///
    /// `None` starts at the beginning.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<AdvertisementId>,
    /// Clamped by the node, which owns both the ceiling and the default.
    /// Ask for what you mean to display and then read the page you were
    /// actually given, rather than assuming the size you asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

/// `getAdvertisements`' parameters. Both halves default, so
/// [`AdvertisementQuery::default()`] is the first page of the whole active
/// book — the call that existed before filtering did, with only its size
/// changed.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct AdvertisementQuery {
    pub filter: AdvertisementFilter,
    pub page: AdvertisementPageRequest,
}

/// One page of the order book.
///
/// A shape change: `getAdvertisements` answered with a bare array, and a
/// build expecting one fails to decode this outright. That array was every
/// advertisement on the network, from a call that took no parameters — a
/// response growing without bound over a book nobody could search.
///
/// The rows are the stored records. A node sends each one with its
/// resolved `quote` and an `asset_symbol` beside it; both are dropped
/// here, the same as [`Client::get_advertisement`] already drops them,
/// because neither has a shape to decode into at the pinned revision.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct AdvertisementPage {
    pub advertisements: Vec<Advertisement>,
    /// Hand straight back as [`AdvertisementPageRequest::after`] to
    /// continue. `None` means this was the last page.
    pub next_cursor: Option<AdvertisementId>,
}

impl Client {
    pub async fn get_advertisement(&self, id: impl Into<String>) -> Result<Option<Advertisement>> {
        self.call("getAdvertisement", IdParams { id: id.into() })
            .await
    }

    /// Read one page of the order book, narrowed by `query.filter`.
    ///
    /// [`AdvertisementQuery::default()`] is still "the first page of the
    /// whole active book"; see [`AdvertisementFilter::amount`] for the one
    /// filter that quietly returns nothing when sent at the wrong scale.
    ///
    /// There is no iterator over every page here, and that is a judgement
    /// rather than an omission: without a streaming abstraction one would
    /// have to collect the whole book into a `Vec` to return it, which is
    /// the unbounded response the paging exists to remove. Drive it
    /// yourself, feeding each cursor back untouched:
    ///
    /// ```no_run
    /// # use openfiat_sdk::{Client, ClientConfig};
    /// # use openfiat_sdk::methods::advertisements::AdvertisementQuery;
    /// # async fn walk(client: &Client) -> openfiat_sdk::Result<()> {
    /// let mut query = AdvertisementQuery::default();
    /// loop {
    ///     let page = client.get_advertisements(&query).await?;
    ///     for advertisement in &page.advertisements {
    ///         println!("{}", advertisement.id.as_str());
    ///     }
    ///     match page.next_cursor {
    ///         // Verbatim. Deriving a resume point from the last row
    ///         // means reimplementing the node's ordering, and two
    ///         // orderings that disagree skip rows silently.
    ///         Some(cursor) => query.page.after = Some(cursor),
    ///         None => break,
    ///     }
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_advertisements(
        &self,
        query: &AdvertisementQuery,
    ) -> Result<AdvertisementPage> {
        self.call("getAdvertisements", query).await
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
