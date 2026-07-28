# Examples

Run any example with `cargo run --example <name>` from `rust/`.

- `basic_client.rs` — construct a client with default configuration.
- `oracle_provider.rs` — register as an Oracle Provider and publish a
  signed exchange rate against a real running `openfiat-core` node.
- `notification_provider.rs` — register as a Notification Provider, a
  wallet subscribes, and the provider reports a delivery.
- `trading_bot.rs` — a merchant publishes a Sell advertisement and a
  separate bot identity opens a reservation against it.
- `solana_transaction.rs` — build, sign, and submit a real Solana
  transaction through a node's chain bridge (OFS-4300).

Each example's core flow is also covered by `tests/live_node.rs`, run in
CI against an in-process node — a broken example fails the build the
same way a broken test would.
