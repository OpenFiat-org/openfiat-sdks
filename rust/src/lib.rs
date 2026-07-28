//! Official Rust SDK for the OpenFiat protocol.
//!
//! A typed [`Client`] for an OpenFiat node's JSON-RPC 2.0 surface
//! (OFS-8200), reusing `openfiat-core`'s own domain types directly (see
//! `Cargo.toml`'s doc comment) so request/response shapes can never
//! drift from what a real node runs. `Client`'s domain-specific typed
//! methods (`get_advertisement`, `send_oracle_publish`, ...) live in
//! `crate::methods`, one module per domain, each adding to the same
//! `Client` via its own `impl` block.

pub mod client;
pub mod error;
mod jsonrpc;
pub mod methods;
pub mod wallet;

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
