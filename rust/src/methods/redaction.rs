//! What a stranger sees of a trade — the shapes the *public* trade reads
//! answer with.
//!
//! # Why these exist as separate types
//!
//! A node used to answer `getSettlements`, `getReservations` and
//! `getDisputes` with every record on the network, both parties named and
//! keyed. That is the who-trades-with-whom graph, and `getCounterparties`
//! already refuses to hand it out on stated physical-safety grounds — so
//! the three enumerating reads walked around a gate rather than failing
//! it. They are now redacted: amounts, states and timing survive; party
//! identity, a settlement's `payment_reference`, a dispute's free-text
//! `reason` and the arbitrator-to-vote pairing do not.
//!
//! The obvious alternative was to keep one type per record and make the
//! party fields `Option`. That is worse, and not marginally: a caller
//! writes `settlement.buyer`, gets `None` forever, and never learns that
//! [`Client::get_my_settlements`](crate::Client::get_my_settlements)
//! would have answered. A distinct type makes the missing half a compile
//! error with an obvious fix, at the one place where the caller can
//! actually decide which read they wanted.
//!
//! # Reading your own records
//!
//! The unredacted shapes are `openfiat_settlement::Settlement`,
//! `openfiat_reservations::Reservation`, `openfiat_disputes::Dispute`
//! and `openfiat_trade::Trade`, returned by `get_my_*` behind a wallet
//! proof — see [`crate::methods::wallet_auth`].
//!
//! # Defined here rather than reused from `openfiat-rpc`
//!
//! Every other shape in this SDK is imported from `openfiat-core` so the
//! two cannot drift. These four cannot be: they live in
//! `openfiat-rpc`'s `methods::redaction`, and `openfiat-rpc` is a
//! dev-dependency of this crate (it is the node, not a wire-type crate),
//! so a public API returning its types would drag a whole node into
//! every dependent build. They are transcribed instead, field for field.

use openfiat_advertisements::AdvertisementId;
use openfiat_disputes::{DisputeId, DisputeStatus, Resolution};
use openfiat_reservations::{ReservationId, ReservationState};
use openfiat_settlement::{PaymentDiscrepancy, SettlementId, SettlementState};
use openfiat_types::{Amount, Timestamp};

/// A settlement with the parties removed.
///
/// Returned by [`Client::get_settlement`](crate::Client::get_settlement)
/// and [`Client::get_settlements`](crate::Client::get_settlements).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct PublicSettlement {
    pub id: SettlementId,
    pub reservation_id: ReservationId,
    pub amount: Amount,
    pub state: SettlementState,
    /// Kept: it names an on-chain transaction anyone can already read on
    /// Solana, and it is what makes a settlement independently checkable.
    pub escrow_release_signature: Option<String>,
    pub payment_submitted_at: Option<Timestamp>,
    pub merchant_responded_at: Option<Timestamp>,
    pub payment_discrepancy: Option<PaymentDiscrepancy>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// A reservation with the requester removed.
///
/// Returned by
/// [`Client::get_reservation`](crate::Client::get_reservation) and
/// [`Client::get_reservations`](crate::Client::get_reservations).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct PublicReservation {
    pub id: ReservationId,
    /// Kept deliberately. An advertisement is a public offer and already
    /// carries its merchant's peer id on every order-book row, so this
    /// discloses one end of an edge that was never private. What it does
    /// not disclose is the other end, which is what makes it an edge.
    pub advertisement_id: AdvertisementId,
    pub amount: Amount,
    pub state: ReservationState,
    pub requested_at: Timestamp,
    pub updated_at: Timestamp,
    pub expires_at: Timestamp,
}

/// A dispute with the parties, the arbitrators and their votes removed.
///
/// Returned by [`Client::get_dispute`](crate::Client::get_dispute) and
/// [`Client::get_disputes`](crate::Client::get_disputes).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct PublicDispute {
    pub id: DisputeId,
    pub settlement_id: SettlementId,
    pub status: DisputeStatus,
    pub required_arbitrators: u8,
    /// How many seats are filled, without saying by whom.
    pub arbitrators_seated: usize,
    /// How many have committed and how many have revealed — enough to
    /// show a case progressing, with nobody's vote attached to their
    /// name.
    pub commitments: usize,
    pub reveals: usize,
    /// The outcome, which is the point of the case and is enforced on
    /// chain where anyone can read it anyway.
    pub resolution: Option<Resolution>,
    pub onchain_execution_signature: Option<String>,
    pub opened_at: Timestamp,
    pub updated_at: Timestamp,
}

/// The aggregate status of a trade — one value instead of "check the
/// reservation state, then whether a settlement exists, then its state".
///
/// `Completed` covers the settlement's `Approved` (the merchant said yes)
/// and `Completed` (the on-chain release confirmed) alike; a caller who
/// needs that distinction reads the settlement's own
/// `escrow_release_signature`, which is where "has it actually landed"
/// lives.
///
/// Transcribed rather than re-exported from `openfiat_trade::TradeStatus`
/// only because that type gained its `Deserialize` after the revision
/// this crate is pinned to (see `rust/Cargo.toml`). It becomes a
/// re-export the moment the pin moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
pub enum TradeStatus {
    /// The reservation succeeded; no settlement has started.
    EscrowLocked,
    AwaitingPayment,
    PaymentSubmitted,
    Completed,
    Rejected,
    Cancelled,
    Disputed,
}

/// A trade with both parties removed.
///
/// Returned by [`Client::get_trade`](crate::Client::get_trade) and
/// [`Client::get_trades`](crate::Client::get_trades).
///
/// A trade is a read-time join of a reservation and the settlement it
/// became, which made this read the way around the redaction of the three
/// underlying ones: it returned both records whole, so closing them and
/// leaving this open left the same graph one method along. It is composed
/// of the two public halves rather than redacted a second time, so a field
/// added to either cannot appear here without appearing there.
///
/// `status` survives because it is what a trade view is for and says
/// nothing about who is party to it. Note that it survives *only* here —
/// [`Client::get_my_trades`](crate::Client::get_my_trades) answers with
/// `openfiat_trade::Trade`, which carries no status field; a party calls
/// its `status()` method for the same value.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct PublicTrade {
    pub reservation: PublicReservation,
    /// `None` until settlement starts — a trade exists as soon as its
    /// reservation does.
    pub settlement: Option<PublicSettlement>,
    pub status: TradeStatus,
}
