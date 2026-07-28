# Examples

Run any example with `pnpm tsx examples/<name>.ts`.

- `basic.ts` — construct a client with default configuration.
- `oracle_provider.ts` — register as an Oracle Provider and publish a
  signed exchange rate against a real running `openfiat-core` node.
- `solana_transaction.ts` — build, sign, and submit a real Solana
  transaction through a node's chain bridge (OFS-4300).
