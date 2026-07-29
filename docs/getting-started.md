# Getting started — openfiat-sdks

You need something to talk to first: either a running `openfiat-node`
(local, or the public `https://rpc.openfiat.network`) for `Client`, or just
a Solana RPC endpoint for `onchain`. See
[openfiat-core](https://github.com/OpenFiat-org/openfiat-core)'s own
`docs/getting-started.md` to run a node locally — the fastest way is its
published Docker image.

## Rust

```bash
cd rust
cargo run --example oracle_provider
```

`examples/oracle_provider.rs` registers a Service Registry provider and
publishes a signed rate against `http://localhost:8080` by default
(`OPENFIAT_NODE_URL` overrides it) — the fastest way to see a real
sign-and-submit round trip against a live node.

## TypeScript

```bash
cd typescript
pnpm install
pnpm tsx examples/oracle_provider.ts
```

Same example, same default endpoint and `OPENFIAT_NODE_URL` override.

## On-chain only, no node

If you only need to build and submit instructions against
`openfiat-escrow`/`openfiat-staking`/`openfiat-governance` — no
`openfiat-node` involved — start from `examples/stake_and_vote.{rs,ts}` in
either SDK instead. It builds (but doesn't submit) a full stake → propose →
vote sequence, so you can see every account each instruction needs before
wiring in your own Solana RPC connection and keypairs.

## Next steps

- [`architecture.md`](architecture.md) for how `Client` and `onchain`
  relate to each other and to a node.
- Each SDK's own `README.md` ([rust](../rust/README.md),
  [typescript](../typescript/README.md)) for the full method/module list
  and error-handling shape.
- [openfiat-specs](https://github.com/OpenFiat-org/openfiat-specs) for the
  protocol these SDKs implement — OFS-8200 (the JSON-RPC surface) and
  OFS-4200 (the on-chain programs) are the two most relevant documents.
