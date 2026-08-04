//! SDK error types.

use std::fmt;

/// Result type alias used throughout the SDK.
pub type Result<T> = std::result::Result<T, Error>;

/// Errors returned by the OpenFiat SDK.
#[derive(Debug)]
pub enum Error {
    /// The HTTP request itself failed (connection refused, timed out, TLS
    /// error, ...) — the node was never reached, or never responded.
    Transport(reqwest::Error),
    /// The response body wasn't valid JSON, or didn't match the expected
    /// shape for this method's result.
    Decode(serde_json::Error),
    /// A standard JSON-RPC 2.0 transport-level error (`-32700` parse
    /// error, `-32601` method not found, `-32602` invalid params,
    /// `-32603` internal error) — see OFS-8200 §10.
    JsonRpc(i64, String),
    /// An application-level failure (OFS-8200 §10's `-32000` error),
    /// carrying OFS-8000's own numeric code and symbolic name.
    Application {
        ofs_error_code: Option<u32>,
        ofs_error_name: Option<String>,
        /// The node's report of OFS-8000 §16's judgement for this code:
        /// whether the identical request sent again can reach a different
        /// outcome.
        ///
        /// Read it, do not obey it. This SDK never retries anything on its
        /// own, and a `Some(true)` is not an instruction to loop — it is
        /// the node saying a caller who *wants* to try again is not
        /// wasting the attempt. `Some(false)` is the load-bearing
        /// direction: it means stop asking.
        ///
        /// `None` when the node predates the field. Treat that as "not
        /// stated" rather than as `false`, or an older node turns every
        /// transient failure permanent.
        ofs_retryable: Option<bool>,
        message: String,
    },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Transport(err) => write!(f, "transport error: {err}"),
            Error::Decode(err) => write!(f, "failed to decode response: {err}"),
            Error::JsonRpc(code, message) => write!(f, "JSON-RPC error {code}: {message}"),
            Error::Application {
                ofs_error_name,
                message,
                ..
            } => match ofs_error_name {
                Some(name) => write!(f, "{name}: {message}"),
                None => write!(f, "{message}"),
            },
        }
    }
}

impl std::error::Error for Error {}

impl From<reqwest::Error> for Error {
    fn from(err: reqwest::Error) -> Self {
        Error::Transport(err)
    }
}

impl From<serde_json::Error> for Error {
    fn from(err: serde_json::Error) -> Self {
        Error::Decode(err)
    }
}
