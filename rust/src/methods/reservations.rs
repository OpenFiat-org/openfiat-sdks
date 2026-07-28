//! Reservation methods (OFS-2200).

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_reservations::events::{ReservationRequest, SignedReservationRequest};
use openfiat_reservations::{Reservation, ReservationId};

impl Client {
    pub async fn get_reservation(&self, id: impl Into<String>) -> Result<Option<Reservation>> {
        self.call("getReservation", IdParams { id: id.into() })
            .await
    }

    pub async fn get_reservations(&self) -> Result<Vec<Reservation>> {
        self.call("getReservations", ()).await
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
