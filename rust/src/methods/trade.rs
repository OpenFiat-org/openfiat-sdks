//! Trade methods (OFS-2000) — a read-only join, no `sendX` method.

use crate::client::{Client, IdParams};
use crate::error::Result;
use crate::methods::redaction::PublicTrade;
use openfiat_crypto::Keypair;
use openfiat_trade::Trade;

/// Domain separator for `getMyTrades`, transcribed from `openfiat-rpc`'s
/// `methods::trade::CHALLENGE_DOMAIN`.
pub const CHALLENGE_DOMAIN: &str = "openfiat-my-trades";

impl Client {
    /// Read one trade, by its reservation id, as a stranger sees it.
    ///
    /// This read used to hand back the reservation and the settlement
    /// whole, which made it the way around the redaction of
    /// `getReservation`, `getSettlement` and `getDispute`: a trade embeds
    /// the records it joins, so closing those three and leaving this open
    /// left the same trade graph one method along. See
    /// [`Client::get_my_trades`] for the unredacted read.
    pub async fn get_trade(
        &self,
        reservation_id: impl Into<String>,
    ) -> Result<Option<PublicTrade>> {
        self.call(
            "getTrade",
            IdParams {
                id: reservation_id.into(),
            },
        )
        .await
    }

    /// Every trade on the network, redacted.
    pub async fn get_trades(&self) -> Result<Vec<PublicTrade>> {
        self.call("getTrades", ()).await
    }

    /// Every trade `keypair`'s wallet is party to, in full, proved by
    /// signing a freshly issued wallet challenge.
    ///
    /// Party means the reservation's requester or either side of the
    /// settlement. Both are checked because a trade exists before a
    /// settlement does, and until then the requester is its only party.
    ///
    /// The returned [`Trade`] carries no status field — the node derives
    /// that on the public view rather than storing it on the join — so a
    /// party calls `Trade::status()` for the value
    /// [`PublicTrade`](crate::methods::redaction::PublicTrade) hands to
    /// strangers.
    pub async fn get_my_trades(&self, keypair: &Keypair) -> Result<Vec<Trade>> {
        let proof = self.wallet_proof(keypair, CHALLENGE_DOMAIN).await?;
        self.call("getMyTrades", proof).await
    }
}
