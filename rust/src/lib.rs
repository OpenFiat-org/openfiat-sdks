//! Official Rust SDK for the OpenFiat protocol.
//!
//! This crate provides a typed client for interacting with an OpenFiat node
//! over its RPC surface (see `openfiat-core`'s `rpc`/`api` crates), plus
//! helpers mirroring the protocol's core domain objects (identity, trade,
//! wallet). It currently defines the public API surface only; wire-level
//! implementation lands alongside `openfiat-core`'s RPC layer.

pub mod client;
pub mod error;

pub use client::{Client, ClientConfig};
pub use error::{Error, Result};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_can_be_constructed() {
        let client = Client::new(ClientConfig::default());
        assert_eq!(client.config().endpoint, "https://rpc.openfiat.network");
    }
}
