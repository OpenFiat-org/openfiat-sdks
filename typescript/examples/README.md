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

Each example's core flow is also covered by `tests/live_node.test.ts`,
run in CI against a real `openfiat-node` process (see
`.github/workflows/ci.yml`'s `typescript-sdk-live-node` job) — a broken
example fails the build the same way a broken test would.
