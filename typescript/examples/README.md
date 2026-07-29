# Examples

Run any example with `pnpm tsx examples/<name>.ts`.

- `basic.ts` — construct a client with default configuration.
- `oracle_provider.ts` — register as an Oracle Provider and publish a
  signed exchange rate against a real running `openfiat-core` node.
- `notification_provider.ts` — register as a Notification Provider, a
  wallet subscribes, and the provider reports a delivery.
- `trading_bot.ts` — a merchant publishes a Sell advertisement and a
  separate bot identity opens a reservation against it.
- `solana_transaction.ts` — build, sign, and submit a real Solana
  transaction through a node's chain bridge (OFS-4300).
- `stake_and_vote.ts` — build (not submit) a full stake → propose → vote
  sequence against the three on-chain programs (OFS-4200), using the
  `onchain` export directly — no node involved.

Every example above `stake_and_vote.ts` has its core flow also covered by
`tests/live_node.test.ts`, run in CI against a real `openfiat-node` process
(see `.github/workflows/ci.yml`'s `typescript-sdk-live-node` job) — a
broken example fails the build the same way a broken test would.
`stake_and_vote.ts` only builds instructions and prints them; its
discriminators and account lists are unit-tested in
`tests/onchain-staking.test.ts` (and the sibling escrow/governance test
files) against the real IDL rather than against a live validator — that
live-validator proof exists only on the Rust side, in
`rust/tests/onchain_live_validator.rs`.
