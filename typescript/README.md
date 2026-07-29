# @openfiat/sdk (TypeScript)

Official TypeScript/JavaScript SDK for the OpenFiat protocol: a typed
`Client` for a node's JSON-RPC 2.0 surface (OFS-8200), signing events
with `@noble/ed25519` — interoperable with `openfiat-core`'s Rust wallet
since both implement the same RFC 8032 Ed25519. Part of the
[openfiat-sdks](https://github.com/OpenFiat-org/openfiat-sdks) monorepo —
see the repository root [README](../README.md) for the full layout.

```bash
pnpm add @openfiat/sdk
```

```ts
import { Client, generateKeypair, oracles } from "@openfiat/sdk";

const client = new Client({ endpoint: "http://localhost:8080", timeoutMs: 30_000 });
const version = await client.call("getVersion", {});

// send* methods take the domain's own unsigned event shape and a
// keypair — the SDK signs and base64-encodes it, then submits it.
const keypair = await generateKeypair();
// await oracles.sendOraclePublish(client, publish, keypair);
```

The main entry is browser/edge-safe. A persistent Node.js identity
(reading/writing a `wallet.json`) lives in the separate `@openfiat/sdk/node`
entry point, so it doesn't pull `node:fs` into a browser bundle:

```ts
import { loadWalletFile, saveWalletFile } from "@openfiat/sdk/node";
```

Typed methods currently cover `node`, `chain`, `advertisements`,
`notifications`, `oracles`, `providers` (the Service Registry
oracle/notification/risk/snapshot providers register with), and
`reservations` — see [`src/types.ts`](src/types.ts)'s own comment for how
to extend this to another domain: read that domain's `events.rs`/
`record.rs` in `openfiat-core` and transcribe the same (snake_case)
field list, since these interfaces describe the exact JSON `serde`
produces, not idiomatic TypeScript naming. Disputes and governance don't
have a typed methods module yet — call `client.call`/`client.sendSigned`
directly with the same method names the Rust SDK's `methods/disputes.rs`
and `methods/governance.rs` use, or use `onchain` below for the on-chain
half of either.

See [`examples/oracle_provider.ts`](examples/oracle_provider.ts) for a
complete, runnable example: registering as an Oracle Provider and
publishing a signed rate, verified end to end against a real
`openfiat-core` node.

## Chain bridge (OFS-4300)

`chain.getChainStatus`, `chain.getLatestBlockhash`, and
`chain.sendTransaction` reach a node's bridge to the Solana execution
layer — identical behavior whether the node itself has a live Solana
RPC connection or only gossip. This SDK never constructs or signs a
Solana transaction on your behalf: build and sign one with
`@solana/web3.js` (a real runtime dependency of the published package —
`onchain` below uses it for `PublicKey`/`TransactionInstruction`), then
submit its serialized bytes:

```ts
import { chain } from "@openfiat/sdk";

const { blockhash } = await chain.getLatestBlockhash(client);
// ...build and sign a @solana/web3.js Transaction with `blockhash`...
await chain.sendTransaction(client, transaction.serialize());
```

See [`examples/solana_transaction.ts`](examples/solana_transaction.ts)
for a complete, runnable example.

## On-chain programs (OFS-4200)

`onchain.escrow`, `onchain.staking`, and `onchain.governance` build
instructions for the three deployed Anchor programs directly — PDA
derivation, account lists, and Anchor-wire-format instruction data (an
8-byte discriminator sourced from the real `anchor build` IDL, plus a
hand-rolled Borsh-subset encoder in `onchain/codec.ts` — deliberately not
the `borsh` npm package, since every instruction here is simple enough to
encode directly). No `anchor-lang`/`anchor-client` dependency:

```ts
import { onchain } from "@openfiat/sdk";

const ix = onchain.staking.stakeIx(owner, mint, onchain.Role.Arbitrator, from, amount);
// sign and submit with @solana/web3.js, same as the chain bridge above —
// this module only builds instructions, it never submits one.
```

See [`examples/stake_and_vote.ts`](examples/stake_and_vote.ts) for a full
stake → propose → vote sequence across all three programs.

## Errors

Every rejected call throws `TransportError` (the request itself failed),
`JsonRpcError` (a standard JSON-RPC transport error), or
`ApplicationError` (OFS-8000's own numeric code and symbolic name).
