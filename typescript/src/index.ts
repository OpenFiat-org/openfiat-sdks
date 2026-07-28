/**
 * Official TypeScript/JavaScript SDK for the OpenFiat protocol: a typed
 * client for a node's JSON-RPC 2.0 surface (OFS-8200).
 *
 * Typed methods live in `src/methods/*.ts`, one module per domain —
 * node, chain bridge, oracles, service providers, advertisements,
 * reservations, and notifications so far (see that directory's own
 * comment for how to extend it to another domain).
 *
 * Browser/edge-safe by design — Node-only wallet file I/O (`node:fs`)
 * lives in the separate `@openfiat/sdk/node` entry point instead.
 */
export { Client, type ClientConfig, defaultClientConfig } from "./client.js";
export { ApplicationError, JsonRpcError, TransportError } from "./error.js";
export { type Keypair, generateKeypair, keypairFromSeed, peerIdFromPublicKey, sign } from "./crypto.js";
export * from "./types.js";
export * as advertisements from "./methods/advertisements.js";
export * as chain from "./methods/chain.js";
export * as node from "./methods/node.js";
export * as notifications from "./methods/notifications.js";
export * as oracles from "./methods/oracles.js";
export * as providers from "./methods/providers.js";
export * as reservations from "./methods/reservations.js";
export * as onchain from "./onchain/index.js";
