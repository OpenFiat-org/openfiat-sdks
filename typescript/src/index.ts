/**
 * Official TypeScript/JavaScript SDK for the OpenFiat protocol: a typed
 * client for a node's JSON-RPC 2.0 surface (OFS-8200).
 *
 * Typed methods live in `src/methods/*.ts`, one module per domain —
 * node, chain bridge, oracles, service providers, advertisements,
 * reservations, settlements, disputes, trades, and notifications so far
 * (see that directory's own comment for how to extend it to another
 * domain).
 *
 * Browser/edge-safe by design — Node-only wallet file I/O (`node:fs`)
 * lives in the separate `@openfiat/sdk/node` entry point instead.
 */
export { Client, type ClientConfig, defaultClientConfig } from "./client.js";
export { ApplicationError, JsonRpcError, TransportError } from "./error.js";
export {
  type Keypair,
  generateKeypair,
  keypairFromSeed,
  peerIdFromPublicKey,
  sign,
} from "./crypto.js";
// `SealedBox` is deliberately not re-exported here: `./types.js` already
// exports the identical shape as part of the notification surface, and two
// exports of one name is an error rather than a convenience.
export { SealError, openSealed, seal, sealTo } from "./seal.js";
export {
  DERIVATION_MESSAGE,
  type EncryptionKeypair,
  derivationMessageBytes,
  deriveEncryptionKeypair,
  encodeEncryptionPublicKey,
  openWithEncryptionKey,
  parseEncryptionPublicKey,
  sealToEncryptionKey,
} from "./encryption-key.js";
export * from "./types.js";
export * as advertisements from "./methods/advertisements.js";
export * as chain from "./methods/chain.js";
export * as disputes from "./methods/disputes.js";
export * as node from "./methods/node.js";
export * as notifications from "./methods/notifications.js";
export * as oracles from "./methods/oracles.js";
export * as providers from "./methods/providers.js";
export * as reference from "./methods/reference.js";
export * as reservations from "./methods/reservations.js";
export * as settlement from "./methods/settlement.js";
export * as trade from "./methods/trade.js";
export * as wallet from "./methods/wallet.js";
export * as onchain from "./onchain/index.js";
