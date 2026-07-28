/**
 * Node.js-only entry point (`@openfiat/sdk/node`) — split from the main
 * entry because it touches `node:fs/promises`, which breaks bundling for
 * browser/edge consumers that only need the JSON-RPC client.
 */
export { type Wallet, KeyfileError, loadWalletFile, saveWalletFile } from "./wallet.js";
