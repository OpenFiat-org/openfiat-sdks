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
- `stake_and_vote.rs` — build (not submit) a full stake → propose → vote
  sequence against the three on-chain programs (OFS-4200), using
  `onchain::{escrow,staking,governance}` directly — no node involved.

Every example above `stake_and_vote.rs` has its core flow also covered by
`tests/live_node.rs`, run in CI against an in-process node — a broken
example fails the build the same way a broken test would. `stake_and_vote.rs`
only builds instructions and prints them (it needs the three on-chain
programs actually deployed, and a funded OPEN account for every signer,
neither of which CI provides) — see `rust/tests/onchain_live_validator.rs`
for the equivalent proof against a real deployed program instead.
