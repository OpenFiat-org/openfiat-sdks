/**
 * Ed25519 keypairs and OpenFiat's PeerId derivation.
 *
 * Uses `@noble/ed25519` — audited, dependency-free, and interoperable
 * with Rust's `ed25519-dalek` (both implement RFC 8032, so the same
 * 32-byte seed produces the same public key and the same signature for
 * the same message in either language). That interoperability is the
 * whole point: a wallet.json produced by `openfiat-core`'s Rust wallet
 * works here unchanged.
 */
import * as ed from "@noble/ed25519";

/** An Ed25519 keypair: a 32-byte seed and its derived 32-byte public key. */
export interface Keypair {
  readonly seed: Uint8Array;
  readonly publicKey: Uint8Array;
}

/** Generate a fresh random keypair. */
export async function generateKeypair(): Promise<Keypair> {
  const seed = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(seed);
  return { seed, publicKey };
}

/** Rebuild a keypair from an existing 32-byte seed. */
export async function keypairFromSeed(seed: Uint8Array): Promise<Keypair> {
  if (seed.length !== 32) {
    throw new Error(`Ed25519 seed must be 32 bytes, got ${seed.length}`);
  }
  const publicKey = await ed.getPublicKeyAsync(seed);
  return { seed, publicKey };
}

/** Sign `message` with `keypair`, returning the 64-byte signature. */
export async function sign(keypair: Keypair, message: Uint8Array): Promise<Uint8Array> {
  return ed.signAsync(message, keypair.seed);
}

/**
 * Derive the libp2p `PeerId` bytes a public key claims — the identity
 * multihash wrapping a protobuf-encoded Ed25519 public key
 * (`openfiat-network`'s `peer_id_from_public_key`, in bytes any libp2p
 * implementation produces identically): for a 32-byte Ed25519 key the
 * protobuf encoding (`0x08 0x01` key-type field, `0x12 0x20` length-
 * delimited key-bytes field, then the 32 key bytes) is always 36 bytes,
 * which is short enough that libp2p's "identity" multihash (code
 * `0x00`) wraps it directly rather than hashing it — so the whole
 * derivation is a fixed 6-byte prefix plus the public key itself.
 */
export function peerIdFromPublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, got ${publicKey.length}`);
  }
  const prefix = new Uint8Array([0x00, 0x24, 0x08, 0x01, 0x12, 0x20]);
  const out = new Uint8Array(prefix.length + publicKey.length);
  out.set(prefix, 0);
  out.set(publicKey, prefix.length);
  return out;
}
