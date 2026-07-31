//! Advertisement methods (OFS-2100).
//!
//! An advertisement names its asset by mint address rather than by ticker:
//! a ticker on a record is a label the merchant chose, and nothing tied it
//! to the token the escrow would actually move, so an ad could say "USDC"
//! and settle in something else with every layer agreeing the trade
//! completed. The name a buyer reads is resolved from the mint *by the
//! node* and arrives beside the record, never inside it.
//!
//! Every record shape below is `openfiat-advertisements`', imported rather
//! than transcribed, so this SDK and a real node cannot describe different
//! wire formats.
//!
//! # Why the filter and page types are still written out here
//!
//! An earlier revision of this module said they were hand-written only
//! because `openfiat_advertisements::query` postdated the pinned core, and
//! would become re-exports as soon as the pin moved. The pin has moved,
//! and they have not — because re-exporting turns out to lose a property
//! that matters.
//!
//! Core's `AdvertisementFilter` and `Page` mark every field
//! `#[serde(default)]` but nothing skips serializing a `None`. A default
//! query built from them goes out as a wall of explicit nulls. The node
//! reads that identically, so nothing breaks — but "every constraint the
//! caller named, and nothing they did not" stops being visible on the
//! wire, and the request stops being readable as a statement of intent.
//! The versions here skip absent constraints instead, which is what
//! `tests/advertisements_paging.rs` pins.
//!
//! What the moved pin *did* fix is the deviation that note flagged:
//! `asset_mint` and `fiat_currency` are the real newtypes now, so a filter
//! cannot carry a mint that is not 32 bytes of base58 or a currency that
//! is not a currency code.

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_advertisements::events::{
    AdvertisementCreate, AdvertisementDisable, AdvertisementPriceUpdate, SignedAdvertisementCreate,
    SignedAdvertisementDisable, SignedAdvertisementPriceUpdate,
};
use openfiat_advertisements::pricing::PriceQuote;
use openfiat_advertisements::{Advertisement, AdvertisementId, AdvertisementStatus, Direction};
use openfiat_crypto::{Keypair, MintAddress};
use openfiat_types::{Amount, FiatCurrency};

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
    /// ticker. Base58, 32 bytes, enforced by the type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_mint: Option<MintAddress>,
    /// A currency code is a code, so `kes` and `KES` find the same offers:
    /// [`FiatCurrency`] uppercases at construction, and the normalised
    /// form is what goes on the wire.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fiat_currency: Option<FiatCurrency>,
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

/// An advertisement as a reader gets it: the stored record, plus the two
/// things the node resolves at the moment it answers.
///
/// Neither addition is part of the record and neither may become part of
/// it. Both are derived at the edge by the node — the symbol from a table
/// every node compiles in identically, the quote from that node's own
/// oracle reading — so a merchant can sign neither.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct AdvertisementView {
    #[serde(flatten)]
    pub advertisement: Advertisement,
    /// What people call `asset_mint`, or `None` if this build knows no
    /// name for it. `None` is not an error and not a reason to guess: an
    /// unnamed mint is an address with no nickname, and showing the
    /// address is unhelpful and true rather than helpful and false.
    ///
    /// This SDK deliberately ships no mint-to-ticker table of its own.
    /// One here would drift from the node's answer the first time
    /// governance allowlists a mint, which is precisely the disagreement
    /// between two honest builds that resolving at the node avoids.
    pub asset_symbol: Option<String>,
    /// What this advertisement's own terms produce right now.
    ///
    /// Not the same thing as `advertisement.pricing`, and the difference
    /// is easy to miss: `pricing` is the merchant's standing instruction
    /// ("oracle mid plus 150 bps"), while this is what that instruction
    /// resolved to against the oracle reading the node had when it
    /// answered. A floating advertisement's `pricing` never changes while
    /// its quote moves all day.
    pub quote: PriceQuote,
}

/// One page of the order book.
///
/// A shape change: `getAdvertisements` answered with a bare array, and a
/// build expecting one fails to decode this outright. That array was every
/// advertisement on the network, from a call that took no parameters — a
/// response growing without bound over a book nobody could search.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct AdvertisementPage {
    pub advertisements: Vec<AdvertisementView>,
    /// Hand straight back as [`AdvertisementPageRequest::after`] to
    /// continue. `None` means this was the last page.
    pub next_cursor: Option<AdvertisementId>,
}

impl Client {
    pub async fn get_advertisement(
        &self,
        id: impl Into<String>,
    ) -> Result<Option<AdvertisementView>> {
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
