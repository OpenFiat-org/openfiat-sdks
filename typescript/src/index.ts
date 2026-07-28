/**
 * Official TypeScript/JavaScript SDK for the OpenFiat protocol: a typed
 * client for a node's JSON-RPC 2.0 surface (OFS-8200).
 *
 * Typed methods live in `src/methods/*.ts`, one module per domain —
 * node, oracles, and service providers so far (see that directory's own
 * comment for how to extend it to another domain).
 */
export { Client, type ClientConfig, defaultClientConfig } from "./client.js";
export { ApplicationError, JsonRpcError, TransportError } from "./error.js";
export { type Keypair, generateKeypair, keypairFromSeed, peerIdFromPublicKey, sign } from "./crypto.js";
export { type Wallet, KeyfileError, loadWalletFile, saveWalletFile } from "./wallet.js";
export * from "./types.js";
export * as node from "./methods/node.js";
export * as oracles from "./methods/oracles.js";
export * as providers from "./methods/providers.js";
