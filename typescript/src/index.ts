/**
 * Official TypeScript/JavaScript SDK for the OpenFiat protocol.
 *
 * Provides a typed client for interacting with an OpenFiat node's RPC
 * surface. This currently defines the public API surface only; transport
 * implementation lands alongside `openfiat-core`'s RPC layer.
 */
export { Client, type ClientConfig, defaultClientConfig } from "./client.js";
export { OpenFiatError } from "./error.js";
