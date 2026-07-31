/**
 * Seals a destination with a caller-supplied seed and prints the result as
 * JSON, so the Rust side can open it and prove the two implementations
 * agree byte for byte.
 *
 * Exists as a script rather than a test because the assertion belongs on
 * the Rust side: only an implementation that did NOT produce the box can
 * demonstrate it opens. Two implementations that are each self-consistent
 * and mutually incompatible both pass a round-trip test of their own.
 *
 * Usage: `pnpm tsx scripts/seal-fixture.ts <seed-hex> <plaintext>`
 */

import { ed25519 } from "@noble/curves/ed25519.js";

import { seal } from "../src/seal.js";

const [seedHex, plaintext] = process.argv.slice(2);
if (!seedHex || plaintext === undefined) {
  console.error("usage: seal-fixture.ts <32-byte-seed-hex> <plaintext>");
  process.exit(2);
}

const seed = Uint8Array.from(Buffer.from(seedHex, "hex"));
if (seed.length !== 32) {
  console.error(`seed must be 32 bytes, got ${seed.length}`);
  process.exit(2);
}

const publicKey = ed25519.getPublicKey(seed);
process.stdout.write(
  JSON.stringify({
    public_key: Array.from(publicKey),
    sealed: seal(publicKey, new TextEncoder().encode(plaintext)),
  }),
);
