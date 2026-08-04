//! The JSON-RPC 2.0 envelope OFS-8200 §4 defines.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub(crate) struct Request<P> {
    pub jsonrpc: &'static str,
    pub id: u64,
    pub method: &'static str,
    pub params: P,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ResponseError {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<ErrorData>,
}

/// OFS-8200 §10: an application-level failure's `-32000` error carries
/// OFS-8000's own numeric code and symbolic name in `data`.
///
/// `Default` so the "node sent no `data`" path stays a one-liner. Naming
/// every field there instead is how adding the next one silently keeps
/// compiling while dropping it on the floor.
#[derive(Debug, Default, Deserialize)]
pub(crate) struct ErrorData {
    #[serde(default)]
    #[serde(rename = "ofsErrorCode")]
    pub ofs_error_code: Option<u32>,
    #[serde(default)]
    #[serde(rename = "ofsErrorName")]
    pub ofs_error_name: Option<String>,
    /// OFS-8000 §16's retryability judgement, as the node reports it.
    /// `None` from a node that predates the field — which is "not stated",
    /// not "no".
    #[serde(default)]
    #[serde(rename = "ofsRetryable")]
    pub ofs_retryable: Option<bool>,
}

pub(crate) const APPLICATION_ERROR: i64 = -32000;

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact `error` object `openfiat-core`'s `RpcError::Application`
    /// renders, decoded field for field.
    ///
    /// Transcribed rather than produced by calling a node, because the
    /// nodes this SDK talks to are not the one its tests can spawn: the
    /// pinned `openfiat-rpc` in `dev-dependencies` is whatever revision
    /// the lockfile says, and a test that only ever saw that revision
    /// would pass while a deployed node's field went unread.
    #[test]
    fn an_application_error_decodes_all_three_ofs_fields() {
        let error: ResponseError = serde_json::from_str(
            r#"{"code":-32000,"message":"SETTLEMENT_NOT_FOUND","data":{
                 "ofsErrorCode":5008,
                 "ofsErrorName":"SETTLEMENT_NOT_FOUND",
                 "ofsRetryable":false}}"#,
        )
        .unwrap();

        let data = error.data.unwrap();
        assert_eq!(data.ofs_error_code, Some(5008));
        assert_eq!(data.ofs_error_name.as_deref(), Some("SETTLEMENT_NOT_FOUND"));
        assert_eq!(data.ofs_retryable, Some(false));
    }

    /// `true` decodes as `true`, not as "present, therefore truthy" —
    /// the one-sided version of this test would pass on a field that was
    /// hardcoded, and the whole value of the flag is that its two values
    /// mean opposite things to a caller.
    #[test]
    fn a_transient_failure_decodes_as_retryable() {
        let error: ResponseError = serde_json::from_str(
            r#"{"code":-32000,"message":"CHAIN_UNAVAILABLE","data":{
                 "ofsErrorCode":1010,
                 "ofsErrorName":"CHAIN_UNAVAILABLE",
                 "ofsRetryable":true}}"#,
        )
        .unwrap();

        assert_eq!(error.data.unwrap().ofs_retryable, Some(true));
    }

    /// A node that predates the field leaves it unstated, and unstated
    /// must not read as "do not retry" — every older node in the network
    /// would otherwise look permanently broken to a client that backs off
    /// on `false`.
    #[test]
    fn an_older_node_leaves_retryability_unstated_rather_than_false() {
        let error: ResponseError = serde_json::from_str(
            r#"{"code":-32000,"message":"CHAIN_UNAVAILABLE","data":{
                 "ofsErrorCode":1010,
                 "ofsErrorName":"CHAIN_UNAVAILABLE"}}"#,
        )
        .unwrap();

        assert_eq!(error.data.unwrap().ofs_retryable, None);
    }
}
