//! Minimal example: construct a client with default configuration.
//!
//! Run with: `cargo run --example basic_client`

use openfiat_sdk::{Client, ClientConfig};

fn main() {
    let client = Client::new(ClientConfig::default());
    println!("configured endpoint: {}", client.config().endpoint);
}
