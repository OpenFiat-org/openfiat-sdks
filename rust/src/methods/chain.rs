//! Chain-bridge methods (OFS-4300 §8) — `getChainStatus`,
//! `getLatestBlockhash`, `sendTransaction`. Identical from the caller's
//! side whether the node is RPC-connected or gossip-only.

use crate::client::{Client, SendParams};
use crate::error::Result;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};
use solana_transaction::versioned::VersionedTransaction;

/// Mirrors `openfiat_rpc::methods::chain::SendTransactionParams` — a
/// dedicated params shape (not the shared [`SendParams`]) since
/// `correlation` is specific to `sendTransaction`, not every `sendX`
/// method.
#[derive(Debug, Serialize)]
struct SendTransactionParams {
    data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    correlation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChainStatus {
    pub mode: String,
    pub blockhash: Option<String>,
    pub slot: Option<u64>,
    pub age_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct LatestBlockhash {
    pub blockhash: String,
    pub slot: u64,
}

#[derive(Debug, Deserialize)]
struct SendTransactionResult {
    #[allow(dead_code)]
    queued: bool,
}

impl Client {
    pub async fn get_chain_status(&self) -> Result<ChainStatus> {
        self.call("getChainStatus", ()).await
    }

    pub async fn get_latest_blockhash(&self) -> Result<LatestBlockhash> {
        self.call("getLatestBlockhash", ()).await
    }

    /// Submits an already-signed Solana transaction. `tx` must already
    /// carry a valid blockhash (see [`Client::get_latest_blockhash`]) and
    /// signature(s) — this SDK never constructs or signs a transaction on
    /// the caller's behalf, matching every other `sendX` method.
    pub async fn send_transaction(&self, tx: &VersionedTransaction) -> Result<()> {
        let bytes =
            bincode::serialize(tx).expect("a constructed VersionedTransaction always serializes");
        let _: SendTransactionResult = self
            .call(
                "sendTransaction",
                SendParams {
                    data: BASE64.encode(bytes),
                },
            )
            .await?;
        Ok(())
    }

    /// Same as [`Client::send_transaction`], but tags the relay with a
    /// `"<domain>:<id>"` correlation (e.g. `"settlement:set-1"`,
    /// `"dispute:dsp-1"`) — see `openfiat_rpc::methods::chain::
    /// SendTransactionParams`'s own doc for the convention. Once
    /// `poll_chain` observes this transaction genuinely confirmed (not
    /// merely accepted for submission), it routes the matching domain
    /// registry's local-bookkeeping update — this is how a real
    /// `release_escrow`/`execute_dispute_outcome` transaction's
    /// confirmation reaches `SettlementRegistry`/`DisputeRegistry`.
    pub async fn send_transaction_correlated(
        &self,
        tx: &VersionedTransaction,
        correlation: impl Into<String>,
    ) -> Result<()> {
        let bytes =
            bincode::serialize(tx).expect("a constructed VersionedTransaction always serializes");
        let _: SendTransactionResult = self
            .call(
                "sendTransaction",
                SendTransactionParams {
                    data: BASE64.encode(bytes),
                    correlation: Some(correlation.into()),
                },
            )
            .await?;
        Ok(())
    }
}
