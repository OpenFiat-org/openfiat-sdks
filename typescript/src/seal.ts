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
 * # Two ways to name a recipient, one construction
 *
 * {@link seal} addresses an Ed25519 key and converts it. That works for a
 * gateway, which is a server holding its own signing key and can complete
 * the ECDH. It does not work for a person: a browser wallet exposes
 * `signMessage` and `signTransaction` and no key material at all, so a box
 * sealed to a wallet's Ed25519 key is one that wallet can never open.
 *
 * {@link sealTo} and {@link openSealed} therefore address an X25519 public
 * key directly — the same construction with the conversion step removed,
 * not a second scheme. The `SealedBox` on the wire is identical either way.
 * See `./encryption-key.js` for where a wallet's X25519 key comes from.
 *
 * `openSealed` takes a raw secret, and the module doc used to argue that
 * shipping an opener in a browser SDK invites putting a *gateway's*
 * long-term secret somewhere a browser can reach it. That argument still
 * holds and is unchanged: a gateway opens destinations with the Rust
 * implementation on a server. What `openSealed` is for is the other case
 * the old text did not anticipate — a key the browser derived itself, holds
 * for the length of one call, and is the only party that ever could hold.
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
  return sealTo(recipientMontgomery, plaintext);
}

/**
 * Encrypt `plaintext` so only the holder of `recipient`'s X25519 secret can
 * read it — `openfiat_crypto::seal_to_x25519`.
 *
 * Use this whenever the recipient is a *person*: a wallet's published
 * encryption key (`ClaimType::EncryptionKey`) is an X25519 point already,
 * and it is the only key a browser wallet's owner can prove they hold the
 * secret to.
 *
 * Every 32-byte string is a legal X25519 public key, so there is no invalid
 * encoding to reject here — only a small-order one, whose shared secret is
 * public knowledge. That is refused.
 *
 * @param recipient the recipient's 32-byte X25519 public key
 */
export function sealTo(recipientMontgomery: Uint8Array, plaintext: Uint8Array): SealedBox {
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
 * Decrypt a box sealed by {@link sealTo} to the X25519 public key `secret`
 * derives to — `openfiat_crypto::open_x25519`.
 *
 * Throws — never partial or unauthenticated output — if the box was
 * addressed to somebody else, or if any part of it was altered in transit.
 * The reason is deliberately not distinguished: telling "wrong recipient"
 * apart from "tampered ciphertext" is an oracle, and the Rust side collapses
 * them into one variant for the same reason.
 *
 * `secret` is clamped here exactly as it is when the public key is computed,
 * so a caller stores 32 bytes and never has to know which form they are in.
 *
 * @param secret the recipient's 32-byte X25519 secret
 */
export function openSealed(secret: Uint8Array, sealed: SealedBox): Uint8Array {
  const recipientMontgomery = x25519.getPublicKey(secret);
  const ephemeralPublic = Uint8Array.from(sealed.ephemeral_public);

  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(secret, ephemeralPublic);
  } catch {
    throw new SealError("sealed box did not open");
  }

  const { key } = derive(ephemeralPublic, recipientMontgomery, shared);
  try {
    return chacha20poly1305(
      key,
      Uint8Array.from(sealed.nonce),
      ephemeralPublic,
    ).decrypt(Uint8Array.from(sealed.ciphertext));
  } catch {
    throw new SealError("sealed box did not open");
  }
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
