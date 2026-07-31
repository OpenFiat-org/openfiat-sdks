//! Reference data: the countries, fiat currencies, payment methods and
//! token mints a node suggests an interface offer.
//!
//! # Why these shapes are declared here and not imported
//!
//! Every other module in `crate::methods` reuses `openfiat-core`'s own
//! types, so a request shape cannot drift from what a node runs. These
//! four cannot follow that rule yet: they live in `openfiat-rpc`, the
//! server crate, which drags in axum, tokio and libp2p. Making every
//! consumer of this SDK — including a WASM one — compile an HTTP server
//! to borrow four plain data structs is a far worse trade than
//! transcribing them, so they are transcribed, with the same field names
//! and the same `serde` spelling.
//!
//! The honest fix is to move them into `openfiat-types` (already a
//! dependency here) and have both sides use those, so there is one
//! declaration again; that is a change to a crate outside this change's
//! reach and is worth doing.
//!
//! Until then nothing but the test at the bottom of this file stands
//! between a renamed field on the node and a caller silently receiving
//! nothing for it, so that test parses rows taken off a real node rather
//! than a fixture written to match these structs.

use crate::client::Client;
use crate::error::Result;
use serde::{Deserialize, Serialize};

/// A fiat currency to offer, with the name and symbol to print beside
/// its code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Currency {
    /// Three letters, uppercase — normalised by the node before sending.
    pub code: String,
    pub name: String,
    /// The symbol as written locally ("KSh", "₦", "£"). Not unique —
    /// eleven of these are "$" — so it is decoration, never a key.
    pub symbol: String,
}

/// A country or territory, and the currencies it actually trades in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Country {
    /// ISO 3166-1 alpha-2 where one exists, or a stable pseudo-code
    /// (`XNC`, `XTR`) for a territory that has none. Do not assume two
    /// characters.
    pub code: String,
    pub name: String,
    /// The currency most trade here is denominated in.
    pub currency: String,
    /// Other currencies in genuine everyday circulation, most-used
    /// first, and empty for most countries. A client that offered only
    /// `currency` would hide the USD book in a dollarised economy, which
    /// is frequently the larger of the two.
    pub alt_currencies: Vec<String>,
}

/// Which kind of rail a payment method is, so a long list can be grouped
/// into something a person can read.
///
/// These are the node's enum variant names, not display strings: an
/// interface that wants "Mobile Money" on screen formats it there.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PaymentMethodCategory {
    MobileMoney,
    BankTransfer,
    Fintech,
    Cash,
}

/// A payment method a merchant can advertise accepting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaymentMethod {
    /// Shown to a user, and stored on an advertisement verbatim.
    pub name: String,
    pub category: PaymentMethodCategory,
    /// Lowercase spellings a person might type when they mean this
    /// method, for type-ahead. Never shown.
    pub aliases: Vec<String>,
}

/// A token mint the node can put a name to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mint {
    /// Base58 mint address. The only field that identifies anything.
    pub mint: String,
    /// What people call it: `wSOL`, `USDC`, `tUSDC`. Cluster-dependent
    /// and spoofable; see [`Client::get_reference_data`].
    pub symbol: String,
    /// Base-unit exponent, carried beside the symbol so a caller cannot
    /// name a mint while guessing how to scale it.
    pub decimals: u8,
}

/// A node's answer to [`Client::get_reference_data`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReferenceData {
    /// A digest of the four lists, changing when and only when they do.
    ///
    /// Two things a version number cannot do: cache across node releases
    /// that did not touch the table, and compare two nodes for agreement
    /// by one short string rather than diffing five hundred rows.
    pub revision: String,
    pub currencies: Vec<Currency>,
    pub countries: Vec<Country>,
    pub payment_methods: Vec<PaymentMethod>,
    pub mints: Vec<Mint>,
}

impl ReferenceData {
    /// What this node calls `mint`, by its base58 address.
    ///
    /// Address in, name out — never the reverse. A symbol is a nickname:
    /// `USDC` names a different address on every cluster, and this
    /// network settles wrapped SOL under `wSOL`, so a caller matching on
    /// `"SOL"` finds nothing at all. `None` means no nickname, not
    /// invalid; show the address.
    pub fn mint(&self, mint: &str) -> Option<&Mint> {
        self.mints.iter().find(|known| known.mint == mint)
    }
}

impl Client {
    /// The countries, fiat currencies, payment methods and token mints to
    /// offer a user to choose from.
    ///
    /// # Why ask a node
    ///
    /// Because the alternative is what every interface did before: keep
    /// its own table. Two honest builds could then disagree about what
    /// the network supports, and adding a payment method meant releasing
    /// every application that wanted to offer it.
    ///
    /// The node's lists are compiled in rather than derived, so they are
    /// still hand-maintained — they are one set of tables instead of
    /// many, which is the whole of the improvement.
    ///
    /// # A suggestion list, never a validation gate
    ///
    /// Do not use this to decide what is permitted. A node accepts an
    /// advertisement in a currency absent from `currencies` exactly as
    /// one that is present: a code is checked for form and deliberately
    /// not for membership, or a node built last year would reject an
    /// advertisement in a currency added since. Let a merchant name a
    /// payment rail this list does not carry.
    ///
    /// `mints` needs the sharpest version of that warning, because a real
    /// enforcement list does exist elsewhere: the settlement allowlist
    /// lives on chain in the escrow program's `FeeConfig` and governance
    /// can change it. This list is a phrasebook for turning an address
    /// into a name, and the two sets are not guaranteed equal in either
    /// direction — governance can allowlist a mint no build has a name
    /// for, and a named mint can be de-listed without this build hearing
    /// about it.
    ///
    /// # Caching
    ///
    /// Tens of kilobytes, changing about as often as a node is upgraded.
    /// Fetch once and hold it; key any longer-lived cache on `revision`.
    /// Deliberately not cached inside this SDK: a client that silently
    /// substituted a stale or built-in copy when a node was unreachable
    /// would be back to keeping its own table, and could not tell anyone
    /// that is what happened.
    pub async fn get_reference_data(&self) -> Result<ReferenceData> {
        self.call("getReferenceData", ()).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rows lifted out of a running node's `getReferenceData` response,
    /// a few from each list, spelled exactly as it sent them (the
    /// `revision` is that node's too, at the time of writing; it changes
    /// whenever the table does and nothing here depends on its value).
    ///
    /// Written this way on purpose. A fixture composed by serializing the
    /// structs above would agree with them however wrong both were, and
    /// these structs are a transcription of the node's rather than an
    /// import of them — see the module doc.
    const REAL_ANSWER: &str = r#"{
      "revision": "e94f1d13b4cc79e0",
      "currencies": [
        {"code":"KES","name":"Kenyan shilling","symbol":"KSh"},
        {"code":"USD","name":"United States dollar","symbol":"$"}
      ],
      "countries": [
        {"code":"KE","name":"Kenya","currency":"KES","alt_currencies":[]},
        {"code":"ZW","name":"Zimbabwe","currency":"ZWG","alt_currencies":["USD","ZAR"]},
        {"code":"XNC","name":"Northern Cyprus","currency":"TRY","alt_currencies":[]}
      ],
      "payment_methods": [
        {"name":"M-Pesa Kenya (Safaricom)","category":"MobileMoney","aliases":["mpesa","m-pesa"]},
        {"name":"Cash in Person","category":"Cash","aliases":["cash","f2f"]}
      ],
      "mints": [
        {"mint":"So11111111111111111111111111111111111111112","symbol":"wSOL","decimals":9},
        {"mint":"C4rSGhdxWhSFQuFcAxQti1JvBxriwHJoHtJjfhs5p24Y","symbol":"USDT","decimals":6}
      ]
    }"#;

    fn parsed() -> ReferenceData {
        serde_json::from_str(REAL_ANSWER).expect("a node's own answer must parse")
    }

    /// Every field, because a missing `Deserialize` field is not a
    /// compile error — it is a `None`, an empty `Vec`, or a failed parse
    /// in a caller's application weeks later.
    #[test]
    fn a_nodes_answer_parses_into_every_field_these_structs_declare() {
        let data = parsed();
        assert_eq!(data.revision, "e94f1d13b4cc79e0");
        assert_eq!(data.currencies[0].code, "KES");
        assert_eq!(data.currencies[0].symbol, "KSh");
        // The field that a client offering only a primary currency would
        // drop, and with it the USD book that is often the larger one.
        assert_eq!(data.countries[1].alt_currencies, ["USD", "ZAR"]);
        assert_eq!(
            data.payment_methods[0].category,
            PaymentMethodCategory::MobileMoney
        );
        assert_eq!(data.mints[0].decimals, 9);
    }

    /// A territory with no ISO code carries a three-character pseudo-code.
    /// A caller that sliced country codes to two characters would turn
    /// Northern Cyprus into "XN" and match nothing.
    #[test]
    fn a_country_code_is_not_always_two_characters() {
        assert!(parsed().countries.iter().any(|c| c.code == "XNC"));
    }

    /// The mismatch that put mints on this method. Wrapped SOL is named
    /// `wSOL` here, so a caller keying off the ticker it expected finds
    /// nothing — and "found nothing" is indistinguishable from "there is
    /// nothing", which is why lookup is by address.
    #[test]
    fn a_mint_is_found_by_address_and_not_by_the_ticker_a_caller_expected() {
        let data = parsed();
        let wsol = data
            .mint("So11111111111111111111111111111111111111112")
            .expect("the address is what identifies a mint");
        assert_eq!(wsol.symbol, "wSOL");
        assert_ne!(wsol.symbol, "SOL", "the ticker a hand-written list assumed");

        assert!(
            data.mint("SoNotAMintAddress11111111111111111111111111")
                .is_none(),
            "an unknown address has no nickname — that is an answer, not an error"
        );
    }
}
