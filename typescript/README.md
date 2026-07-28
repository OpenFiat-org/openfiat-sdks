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

Typed methods currently cover `node`, `oracles`, and `providers` (the
Service Registry oracle/notification/risk/snapshot providers register
with) — see [`src/types.ts`](src/types.ts)'s own comment for how to
extend this to another domain: read that domain's `events.rs`/
`record.rs` in `openfiat-core` and transcribe the same (snake_case)
field list, since these interfaces describe the exact JSON `serde`
produces, not idiomatic TypeScript naming.

See [`examples/oracle_provider.ts`](examples/oracle_provider.ts) for a
complete, runnable example: registering as an Oracle Provider and
publishing a signed rate, verified end to end against a real
`openfiat-core` node.

## Errors

Every rejected call throws `TransportError` (the request itself failed),
`JsonRpcError` (a standard JSON-RPC transport error), or
`ApplicationError` (OFS-8000's own numeric code and symbolic name).
