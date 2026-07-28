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
#[derive(Debug, Deserialize)]
pub(crate) struct ErrorData {
    #[serde(default)]
    #[serde(rename = "ofsErrorCode")]
    pub ofs_error_code: Option<u32>,
    #[serde(default)]
    #[serde(rename = "ofsErrorName")]
    pub ofs_error_name: Option<String>,
}

pub(crate) const APPLICATION_ERROR: i64 = -32000;
