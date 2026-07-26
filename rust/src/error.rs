//! SDK error types.

use std::fmt;

/// Result type alias used throughout the SDK.
pub type Result<T> = std::result::Result<T, Error>;

/// Errors returned by the OpenFiat SDK.
#[derive(Debug)]
pub enum Error {
    /// The requested operation is not implemented yet.
    NotImplemented(&'static str),
    /// The underlying transport failed.
    Transport(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::NotImplemented(what) => write!(f, "not implemented yet: {what}"),
            Error::Transport(msg) => write!(f, "transport error: {msg}"),
        }
    }
}

impl std::error::Error for Error {}
