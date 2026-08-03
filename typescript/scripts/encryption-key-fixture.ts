/**
 * Derives a wallet's encryption key the way a browser client does, and
 * either seals to it or opens a box sealed elsewhere — so the Rust side can
 * prove the two implementations agree byte for byte.
 *
 * Exists as a script rather than a test for the reason `seal-fixture.ts`
 * gives: only an implementation that did NOT produce a value can
 * demonstrate it is right. Two implementations that are each self-consistent
 * and mutually incompatible both pass a round-trip test of their own, and
 * here that failure mode is expensive — a user would enrol under one key,
 * have grants sealed to another, and discover it as "sealed, unreadable"
 * on a trade already in progress.
 *
 * The wallet signature is produced with `@noble/curves`' Ed25519 rather than
 * taken from a real wallet, deliberately: what this checks is the
 * *derivation*, given the same signature. Whether a given wallet produces
 * that signature is a determinism question the client checks at runtime and
 * no fixture can settle.
 *
 * Usage:
 *   pnpm tsx scripts/encryption-key-fixture.ts derive <wallet-seed-hex> <plaintext>
 *   pnpm tsx scripts/encryption-key-fixture.ts open <wallet-seed-hex>  # box on stdin
 */

import { ed25519 } from "@noble/curves/ed25519.js";

import {
  derivationMessageBytes,
  deriveEncryptionKeypair,
  encodeEncryptionPublicKey,
  openWithEncryptionKey,
  sealToEncryptionKey,
} from "../src/encryption-key.js";
import type { SealedBox } from "../src/seal.js";

const [mode, seedHex, plaintext] = process.argv.slice(2);
if (!mode || !seedHex) {
  console.error("usage: encryption-key-fixture.ts <derive|open> <32-byte-seed-hex> [plaintext]");
  process.exit(2);
}

const seed = Uint8Array.from(Buffer.from(seedHex, "hex"));
if (seed.length !== 32) {
  console.error(`seed must be 32 bytes, got ${seed.length}`);
  process.exit(2);
}

const signature = ed25519.sign(derivationMessageBytes(), seed);
const keypair = deriveEncryptionKeypair(signature);

if (mode === "derive") {
  if (plaintext === undefined) {
    console.error("derive needs a plaintext to seal");
    process.exit(2);
  }
  process.stdout.write(
    JSON.stringify({
      wallet_public_key: Array.from(ed25519.getPublicKey(seed)),
      signature: Array.from(signature),
      encryption_public_key: Array.from(keypair.publicKey),
      encryption_public_key_base58: encodeEncryptionPublicKey(keypair.publicKey),
      sealed: sealToEncryptionKey(keypair.publicKey, new TextEncoder().encode(plaintext)),
    }),
  );
} else if (mode === "open") {
  const stdin = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (buffer += chunk));
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
  const sealed = JSON.parse(stdin) as SealedBox;
  process.stdout.write(
    JSON.stringify({
      opened: Array.from(openWithEncryptionKey(keypair, sealed)),
    }),
  );
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
