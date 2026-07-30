//! Reservation methods (OFS-2200).

use crate::client::{Client, IdParams};
use crate::error::Result;
use crate::methods::redaction::PublicReservation;
use openfiat_crypto::Keypair;
use openfiat_reservations::events::{ReservationRequest, SignedReservationRequest};
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
}
