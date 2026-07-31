/**
 * Sealed boxes — anonymous public-key authenticated encryption addressed to
 * the holder of an Ed25519 public key.
 *
 * This exists because OFS-6000 §11 subscriptions are gossip-replicated to
 * **every** node on the network. A wallet's delivery destination — an email
 * address, a phone number, a chat ID — must therefore never travel as
 * plaintext inside one: doing so would broadcast every user's contact
 * details to the whole network, permanently, into a replicated store.
 * §19's rule that a provider receives "only what delivery requires" is
 * enforceable only if the destination is readable by exactly one party, the
 * gateway the wallet bound it to.
 *
 * This is a port of `openfiat-core`'s `crates/crypto/src/seal.rs` and must
 * stay **byte-compatible with it**, because a box sealed here is opened
 * there. The construction, in libsodium's `crypto_box_seal` shape:
 *
 * 1. A fresh ephemeral X25519 keypair per seal, so no two seals to the same
 *    recipient share a key stream and the *sender* stays anonymous.
 * 2. The recipient's Ed25519 verifying key is mapped to its birationally
 *    equivalent Montgomery (X25519) form, and the two are combined by ECDH.
 * 3. The AEAD key and nonce are derived from SHA-256 over domain-separated
 *    transcripts committing to *both* public keys as well as the shared
 *    secret, so a seal is cryptographically bound to its intended recipient
 *    and the (key, nonce) pair is unique per ephemeral key without a
 *    separate random nonce on the wire.
 * 4. ChaCha20-Poly1305 encrypts with the ephemeral public key as associated
 *    data, so swapping in a different ephemeral key fails authentication
 *    rather than silently decrypting to garbage.
 *
 * Reusing a long-term signing key for key exchange is a deliberate
 * trade-off: a `ServiceRecord` already carries a gateway's
 * `provider_public_key` and nothing else, so a wallet can address a gateway
 * today with no new registration field, no key-distribution step, and no
 * chance of sealing to a key nobody can prove ownership of.
 *
 * There is no `open` here, and that is not an omission. Opening is the
 * *gateway's* job, and a gateway is a server holding a long-term secret —
 * it runs the Rust implementation. Shipping an opener in a browser SDK
 * would invite putting that secret somewhere a browser can reach it.
 */

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** Changing either separator changes the wire format: old boxes stop
 *  opening. They are distinct so the two digests never collapse into one. */
const KEY_DOMAIN = new TextEncoder().encode("openfiat/sealedbox/v1/key");
const NONCE_DOMAIN = new TextEncoder().encode("openfiat/sealedbox/v1/nonce");

/**
 * A ciphertext only the recipient's private key can open, plus the
 * ephemeral public key needed to derive the opening key.
 *
 * Safe to replicate over gossip: it carries no sender identity and no
 * recipient-identifying material beyond what the addressing already
 * implies. Byte arrays rather than hex, matching how `serde` writes the
 * Rust struct — see {@link toBytes}.
 */
export interface SealedBox {
  /** The per-seal ephemeral X25519 public key, in Montgomery form. */
  ephemeral_public: number[];
  nonce: number[];
  ciphertext: number[];
}

/** Sealing failed. Deliberately one type: the recipient key is public
 *  input, so there is nothing to leak by naming the reason. */
export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealError";
  }
}

/**
 * Encrypt `plaintext` so only the holder of `recipient`'s private key can
 * read it.
 *
 * Every call uses a fresh ephemeral key, so sealing the same plaintext
 * twice produces two unrelated ciphertexts — which is what stops an
 * observer correlating two subscriptions as carrying the same address.
 *
 * @param recipient the gateway's 32-byte Ed25519 public key
 *   (`provider_public_key` from its `ServiceRecord`)
 */
export function seal(recipient: Uint8Array, plaintext: Uint8Array): SealedBox {
  let recipientMontgomery: Uint8Array;
  try {
    recipientMontgomery = ed25519.utils.toMontgomery(recipient);
  } catch {
    throw new SealError("recipient public key is unusable for sealing");
  }

  const ephemeralSecret = x25519.utils.randomSecretKey();
  const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);

  let shared: Uint8Array;
  try {
    // Throws on an all-zero result, which is the small-order recipient key
    // case: a shared "secret" an attacker already knows. The Rust side
    // rejects the identity element for the same reason.
    shared = x25519.getSharedSecret(ephemeralSecret, recipientMontgomery);
  } catch {
    throw new SealError("recipient public key is unusable for sealing");
  }

  const { key, nonce } = derive(ephemeralPublic, recipientMontgomery, shared);
  const ciphertext = chacha20poly1305(key, nonce, ephemeralPublic).encrypt(
    plaintext,
  );

  return {
    ephemeral_public: toBytes(ephemeralPublic),
    nonce: toBytes(nonce),
    ciphertext: toBytes(ciphertext),
  };
}

/**
 * The AEAD key and nonce for one seal.
 *
 * Both transcripts commit to the ephemeral public key, the recipient's
 * public key and the ECDH output, so a box sealed to one gateway derives a
 * different key under any other gateway's identity.
 */
function derive(
  ephemeralPublic: Uint8Array,
  recipient: Uint8Array,
  shared: Uint8Array,
): { key: Uint8Array; nonce: Uint8Array } {
  const transcript = (domain: Uint8Array): Uint8Array => {
    const hasher = sha256.create();
    hasher.update(domain);
    hasher.update(ephemeralPublic);
    hasher.update(recipient);
    hasher.update(shared);
    return hasher.digest();
  };
  return {
    key: transcript(KEY_DOMAIN),
    // The first 12 bytes of a distinct digest, not a truncation of the key.
    nonce: transcript(NONCE_DOMAIN).slice(0, 12),
  };
}

function toBytes(bytes: Uint8Array): number[] {
  return Array.from(bytes);
}
