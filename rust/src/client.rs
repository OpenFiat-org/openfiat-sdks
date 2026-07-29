//! Client for talking to an OpenFiat node — the JSON-RPC 2.0 transport
//! OFS-8200 defines. `call` is the generic primitive every typed method
//! in `crate::methods` builds on; most callers should use those typed
//! methods instead of `call` directly.

use crate::error::{Error, Result};
use crate::jsonrpc::{APPLICATION_ERROR, Request, ResponseError};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::sync::atomic::{AtomicU64, Ordering};

/// Configuration for a [`Client`].
#[derive(Debug, Clone)]
pub struct ClientConfig {
    /// Base URL of the node's RPC endpoint.
    pub endpoint: String,
    /// Request timeout, in milliseconds.
    pub timeout_ms: u64,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            endpoint: "https://rpc.openfiat.network".to_string(),
            timeout_ms: 30_000,
        }
    }
}

/// Entry point for the OpenFiat SDK. Domain-specific typed methods
/// (`get_advertisement`, `send_oracle_publish`, ...) live in
/// `crate::methods` as additional `impl Client` blocks.
pub struct Client {
    config: ClientConfig,
    http: reqwest::Client,
    next_id: AtomicU64,
}

impl Client {
    /// Construct a new client with the given configuration.
    pub fn new(config: ClientConfig) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(config.timeout_ms))
            .build()
            .expect("reqwest::Client::builder() with a timeout never fails to build");
        Self {
            config,
            http,
            next_id: AtomicU64::new(1),
        }
    }

    /// Returns the configuration this client was constructed with.
    pub fn config(&self) -> &ClientConfig {
        &self.config
    }

    /// The generic JSON-RPC call every typed method builds on — see
    /// OFS-8200 §4. `method` is a `getX`/`sendX` name; `params` is
    /// whatever shape that method expects.
    pub async fn call<P: Serialize, R: DeserializeOwned>(
        &self,
        method: &'static str,
        params: P,
    ) -> Result<R> {
        let request = Request {
            jsonrpc: "2.0",
            id: self.next_id.fetch_add(1, Ordering::Relaxed),
            method,
            params,
        };
        let url = format!("{}/rpc", self.config.endpoint.trim_end_matches('/'));
        let text = self
            .http
            .post(url)
            .json(&request)
            .send()
            .await?
            .text()
            .await?;

        // Deserialized as a generic `Value` first, deliberately not
        // straight into a `{ result: Option<R>, error: Option<...> }`
        // struct: serde's `Option<T>` deserialization treats a JSON
        // `null` the same as the key being *absent* regardless of `T`,
        // so a successful `()`-returning method (`"result": null`, a
        // real, correctly-shaped success) would be indistinguishable
        // from a malformed response with no `result` key at all. Reading
        // the raw object and checking key *presence* via `Map::get`
        // (which does distinguish "absent" from "present, null") is the
        // only reliable way to tell those two apart.
        let value: serde_json::Value = serde_json::from_str(&text)?;
        let object = value
            .as_object()
            .ok_or_else(|| Error::JsonRpc(0, "response was not a JSON object".to_string()))?;

        if let Some(error_value) = object.get("error") {
            let error: ResponseError = serde_json::from_value(error_value.clone())?;
            return Err(if error.code == APPLICATION_ERROR {
                let data = error.data.unwrap_or(crate::jsonrpc::ErrorData {
                    ofs_error_code: None,
                    ofs_error_name: None,
                });
                Error::Application {
                    ofs_error_code: data.ofs_error_code,
                    ofs_error_name: data.ofs_error_name,
                    message: error.message,
                }
            } else {
                Error::JsonRpc(error.code, error.message)
            });
        }

        match object.get("result") {
            Some(result_value) => Ok(serde_json::from_value(result_value.clone())?),
            None => Err(Error::JsonRpc(
                0,
                "response carried neither a result nor an error".to_string(),
            )),
        }
    }

    /// Base64-encode an already-signed domain event as JSON and submit
    /// it as a `sendX` call — the primitive every `send_*` typed method
    /// in `crate::methods` builds on (OFS-8200 §5's "opaque, already-
    /// signed JSON payload" write model — JSON, not the postcard format
    /// OFS-1200's gossip envelope uses internally, so a signature this
    /// SDK computes never needs to replicate Rust-specific binary
    /// encoding rules).
    pub(crate) async fn send_signed<T: Serialize, R: DeserializeOwned>(
        &self,
        method: &'static str,
        signed: &T,
    ) -> Result<R> {
        let bytes = openfiat_serialization::json::to_bytes(signed)
            .expect("SDK-constructed signed payloads always serialize");
        self.call(
            method,
            SendParams {
                data: BASE64.encode(bytes),
            },
        )
        .await
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct IdParams {
    pub id: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct WalletParams {
    pub wallet: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct SendParams {
    pub data: String,
}

/// Base64-encode raw bytes for a method that carries them as a string —
/// the same encoding `sendSigned` uses for its payloads.
pub(crate) fn encode_base64(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

/// Base64-encode a [`openfiat_types::PeerId`] the same way OFS-8200's
/// `WalletParams`/peer-id-bearing methods expect it on the wire.
pub(crate) fn encode_peer_id(peer_id: &openfiat_types::PeerId) -> String {
    BASE64.encode(peer_id.as_bytes())
}
