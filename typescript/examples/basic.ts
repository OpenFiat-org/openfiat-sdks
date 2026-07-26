/**
 * Minimal example: construct a client with default configuration.
 *
 * Run with: `pnpm tsx examples/basic.ts`
 */
import { Client } from "../src/index.js";

const client = new Client();
console.log(`configured endpoint: ${client.config.endpoint}`);
