//! Reservation methods (OFS-2200).
//!
//! # `send_reservation_request` is refused by a current node
//!
//! A reservation now records the price it was made at: `ReservationRequest`
//! gained `agreed_price` (fiat per unit of asset, as the requester
//! understood it when they signed) and `agreed_mid` (the oracle reading a
//! floating price was derived from, `None` for a fixed advertisement). A
//! floating advertisement publishes a formula rather than a price, and
//! without those fields a taker agreed to a number the protocol recorded
//! nowhere — a merchant asserting a different rate afterwards was arguing
//! against nothing. A request arriving without a price is refused now, not
//! silently priced by the node, because substituting its own number would
//! bind the taker to a figure they never signed.
//!
//! Nothing here can supply them. [`ReservationRequest`] is
//! `openfiat-reservations`', imported so this SDK and a real node cannot
//! describe different wire formats, and `rust/Cargo.toml` pins
//! `openfiat-core` to a revision that predates the fields — so there is no
//! `agreed_price` to set, and every reservation this SDK builds is a
//! reservation the node rejects. Bumping the pin is the whole fix and is
//! its own piece of work; these methods correct themselves the moment it
//! lands, and the construction sites in `examples/trading_bot.rs`,
//! `tests/live_node.rs` and `tests/conformance_trade_lifecycle.rs` become
//! compile errors that name the missing field.
//!
//! The TypeScript SDK transcribes its shapes rather than importing them,
//! carries both fields, and is proved against a node at HEAD.

use crate::client::{Client, IdParams};
use crate::error::Result;
use crate::methods::redaction::PublicReservation;
use openfiat_crypto::Keypair;
use openfiat_reservations::events::{
    ReservationCancel, ReservationRequest, SignedReservationCancel, SignedReservationRequest,
};
use openfiat_reservations::{Reservation, ReservationId};

/// Domain separator for `getMyReservations`, transcribed from
/// `openfiat-rpc`'s `methods::reservations::CHALLENGE_DOMAIN`.
pub const CHALLENGE_DOMAIN: &str = "openfiat-my-reservations";

impl Client {
    /// Read one reservation as a stranger sees it: the advertisement it
    /// was raised against survives, the requester does not. The pairing
    /// is the whole leak — an advertisement already names its merchant
    /// publicly, so naming the requester alongside it completes an edge
    /// even for trades that never settled.
    pub async fn get_reservation(
        &self,
        id: impl Into<String>,
    ) -> Result<Option<PublicReservation>> {
        self.call("getReservation", IdParams { id: id.into() })
            .await
    }

    /// Every reservation on the network, redacted.
    pub async fn get_reservations(&self) -> Result<Vec<PublicReservation>> {
        self.call("getReservations", ()).await
    }

    /// Every reservation `keypair`'s wallet requested, in full, proved by
    /// signing a freshly issued wallet challenge.
    pub async fn get_my_reservations(&self, keypair: &Keypair) -> Result<Vec<Reservation>> {
        let proof = self.wallet_proof(keypair, CHALLENGE_DOMAIN).await?;
        self.call("getMyReservations", proof).await
    }

    pub async fn send_reservation_request(
        &self,
        request: ReservationRequest,
        keypair: &Keypair,
    ) -> Result<ReservationId> {
        let signed = SignedReservationRequest::sign(request, keypair);
        let id: String = self.send_signed("sendReservationRequest", &signed).await?;
        Ok(ReservationId::new(id))
    }

    /// Give up a reservation and return the merchant's liquidity to their
    /// advertisement now, instead of thirty minutes from now when the
    /// node's expiry sweep would have done it anyway.
    ///
    /// `keypair` must be the reservation's own requester. The node
    /// verifies against the public key the reservation already carries,
    /// never against one supplied in the payload, so naming somebody
    /// else's reservation achieves nothing. Legal only from
    /// `EscrowLocked`; an already-cancelled or expired reservation
    /// returns an application error rather than succeeding quietly.
    ///
    /// This cancels the reservation and nothing else. If a settlement has
    /// already been raised against it, cancel that separately with
    /// [`Client::send_settlement_cancelled`] — the two records are not
    /// linked, so cancelling one leaves the other running.
    pub async fn send_reservation_cancel(
        &self,
        cancel: ReservationCancel,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedReservationCancel::sign(cancel, keypair);
        self.send_signed("sendReservationCancel", &signed).await
    }
}
