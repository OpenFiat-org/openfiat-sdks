//! Trade methods (OFS-2000) — a read-only join, no `sendX` method.

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_trade::Trade;

impl Client {
    pub async fn get_trade(&self, reservation_id: impl Into<String>) -> Result<Option<Trade>> {
        self.call(
            "getTrade",
            IdParams {
                id: reservation_id.into(),
            },
        )
        .await
    }

    pub async fn get_trades(&self) -> Result<Vec<Trade>> {
        self.call("getTrades", ()).await
    }
}
