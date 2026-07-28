//! Client for talking to an OpenFiat node.

use crate::error::Result;

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

/// Entry point for the OpenFiat SDK.
///
/// This is currently a typed stub: transport wiring will be added once
/// `openfiat-core`'s RPC surface stabilizes.
#[derive(Debug, Clone)]
pub struct Client {
    config: ClientConfig,
}

impl Client {
    /// Construct a new client with the given configuration.
    pub fn new(config: ClientConfig) -> Self {
        Self { config }
    }

    /// Returns the configuration this client was constructed with.
    pub fn config(&self) -> &ClientConfig {
        &self.config
    }

    /// Placeholder for a future `get_node_info` RPC call.
    pub fn node_info(&self) -> Result<()> {
        Err(crate::error::Error::NotImplemented("node_info"))
    }
}
