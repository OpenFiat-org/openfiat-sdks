/**
 * Node/wallet identity as a Solana CLI-format wallet.json — the same
 * 64-byte JSON array (`[...32-byte seed, ...32-byte public key]`)
 * `solana-keygen new` produces, matching `openfiat-core`'s
 * `openfiat_wallet::solana_keyfile` convention so a wallet.json is
 * interchangeable between the Rust node/SDK and this one.
 */
import { readFile, writeFile } from "node:fs/promises";
import { type Keypair, keypairFromSeed, peerIdFromPublicKey } from "./crypto.js";

export class KeyfileError extends Error {}

/** A wallet: an Ed25519 keypair plus its derived PeerId. */
export interface Wallet {
  readonly keypair: Keypair;
  readonly peerId: Uint8Array;
}

async function toWallet(keypair: Keypair): Promise<Wallet> {
  return { keypair, peerId: peerIdFromPublicKey(keypair.publicKey) };
}

/**
 * Load a Solana CLI-format wallet.json. Verifies the embedded public
 * key actually derives from the embedded seed (catching a truncated or
 * corrupted file), the same check `openfiat_wallet::solana_keyfile::load`
 * performs.
 */
export async function loadWalletFile(path: string): Promise<Wallet> {
  let bytes: number[];
  try {
    const text = await readFile(path, "utf8");
    bytes = JSON.parse(text) as number[];
  } catch (err) {
    throw new KeyfileError(`failed to read keyfile ${path}: ${String(err)}`);
  }
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new KeyfileError(
      `keyfile must contain exactly 64 bytes (seed + public key), found ${bytes.length}`,
    );
  }
  const seed = Uint8Array.from(bytes.slice(0, 32));
  const claimedPublicKey = Uint8Array.from(bytes.slice(32, 64));
  const keypair = await keypairFromSeed(seed);
  if (!buffersEqual(keypair.publicKey, claimedPublicKey)) {
    throw new KeyfileError("keyfile's embedded public key does not match its own seed");
  }
  return toWallet(keypair);
}

/** Save a wallet as a Solana CLI-format wallet.json. */
export async function saveWalletFile(wallet: Wallet, path: string): Promise<void> {
  const bytes = [...wallet.keypair.seed, ...wallet.keypair.publicKey];
  await writeFile(path, JSON.stringify(bytes));
}

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
