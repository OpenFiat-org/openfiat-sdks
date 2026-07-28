# Examples

Run any example with `cargo run --example <name>` from `rust/`.

- `basic_client.rs` — construct a client with default configuration.
- `oracle_provider.rs` — register as an Oracle Provider and publish a
  signed exchange rate against a real running `openfiat-core` node.
- `solana_transaction.rs` — build, sign, and submit a real Solana
  transaction through a node's chain bridge (OFS-4300).
