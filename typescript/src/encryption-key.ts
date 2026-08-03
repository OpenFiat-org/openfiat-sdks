/**
 * The encryption key a wallet publishes so other people can seal things to
 * it — a port of `openfiat-core`'s `crates/crypto/src/encryption_key.rs`,
 * and it must stay **byte-compatible with it**.
 *
 * # The problem
 *
 * {@link seal} addresses a recipient's Ed25519 key and converts it to its
 * Montgomery form. Opening such a box needs the recipient's secret scalar.
 * A gateway has one. A node has one. **A person using a browser wallet does
 * not**: Solana wallets expose `signMessage` and `signTransaction` and no
 * key material at all, by design and rightly.
 *
 * So a `KeyGrant` — the sealed copy of a confidential trade channel's
 * content key — was addressed to a key its recipient could never use. Two
 * ordinary users could not exchange payment details. The feature existed
 * and was unusable.
 *
 * # The shape
 *
 * A wallet signs {@link DERIVATION_MESSAGE}, one fixed domain-separated
 * string. The signature is hashed into an X25519 secret, and the public
 * half is published as an OFS-5000 `ClaimType::EncryptionKey` claim.
 * Grants are sealed to that. The secret never leaves the client and is
 * never stored: re-deriving it costs one wallet signature, on any device.
 *
 * # What it costs, said plainly
 *
 * **The signature is the private key.** Anything that obtains a wallet's
 * signature over this message can derive the secret and read every channel
 * that wallet is party to, past and future — there is no forward secrecy in
 * a trade channel and deliberately cannot be, because an arbitrator nobody
 * can name yet has to be able to read the history later. A phishing site
 * that persuades a user to sign this exact string has taken their trade
 * history, permanently. It has *not* taken their funds: this is an
 * off-chain message, it authorises no transfer, and it cannot be read as a
 * serialized Solana transaction.
 *
 * The defences are what a message can offer and no more: the text names
 * OpenFiat in its first line, says what signing it does, and is worded so a
 * wallet's approval dialog reads as a warning rather than a formality.
 *
 * **Determinism is load-bearing.** Ed25519 signing is deterministic by
 * construction (RFC 8032 §5.1.6 derives the per-signature nonce by hashing
 * the private prefix with the message, using no randomness), so the same
 * wallet over the same bytes yields the same signature and the same key. A
 * wallet that randomised its signatures anyway — or one that wraps the
 * bytes in an envelope before signing rather than signing them raw — would
 * derive a different key and its user would lose access to their own
 * channels. Never assume it: {@link deriveEncryptionKeypair} is pure, so a
 * caller must sign twice at enrolment and compare, and afterwards compare
 * the derived public key against the published claim. `openfiat-app`'s
 * `lib/channel-identity.ts` does both, and is the reference for how.
 */

import { x25519 } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2.js";

import { decodeBase58, encodeBase58 } from "./base58.js";
import { SealError, openSealed, sealTo, type SealedBox } from "./seal.js";

/**
 * The exact bytes a wallet signs to derive its encryption key.
 *
 * **This string is a wire format.** Changing so much as a space changes
 * every key derived from it, which would orphan every channel on the
 * network. A new version gets a new constant and a new claim, not an edit
 * here. It must stay byte-identical to `openfiat_crypto::DERIVATION_MESSAGE`.
 *
 * It is domain-separated by its first line, which no other signed payload in
 * this protocol can produce: domain events are signed over JSON (they begin
 * `{`), and the gated-read handshake signs `<domain>:<subject>:<nonce>` for
 * a fixed set of domains, none of which is this.
 */
export const DERIVATION_MESSAGE =
  "OpenFiat encryption key (v1)\n" +
  "\n" +
  "Signing this message derives the private key that decrypts your OpenFiat trade " +
  "messages and payment details. It is not a transaction: it cannot move funds and " +
  "it sends nothing anywhere.\n" +
  "\n" +
  "Only sign it on a site you trust. Anyone who obtains this signature can read " +
  "every trade conversation and every payment detail this wallet is party to, " +
  "forever.";

/** The bytes to hand a wallet's `signMessage`. */
export function derivationMessageBytes(): Uint8Array {
  return new TextEncoder().encode(DERIVATION_MESSAGE);
}

/** `openfiat_crypto::encryption_key::SEED_DOMAIN`. Distinct from the
 *  sealed-box separators so the two derivations can never collide. */
const SEED_DOMAIN = new TextEncoder().encode("openfiat/encryptionkey/v1/x25519");

/** A wallet's encryption keypair: derived, never generated. */
export interface EncryptionKeypair {
  /** The 32-byte X25519 secret. Hold it for as long as a call takes and no
   *  longer — re-deriving is one signature, and persisting it turns a key
   *  nobody else can hold into a key an XSS can steal. */
  secret: Uint8Array;
  /** The 32-byte X25519 public key that goes in the claim. */
  publicKey: Uint8Array;
}

/**
 * Derive a wallet's encryption keypair from its signature over
 * {@link DERIVATION_MESSAGE}.
 *
 * Pure: the same signature always gives the same keypair, which is what
 * makes a caller's determinism check meaningful. This function cannot tell
 * what a signature is over, so deriving from a signature over anything else
 * silently produces a key nobody can address — the caller is responsible for
 * having signed the right bytes.
 */
export function deriveEncryptionKeypair(signature: Uint8Array): EncryptionKeypair {
  if (signature.length !== 64) {
    throw new SealError(`a wallet signature is 64 bytes, got ${signature.length}`);
  }
  const transcript = new Uint8Array(SEED_DOMAIN.length + signature.length);
  transcript.set(SEED_DOMAIN, 0);
  transcript.set(signature, SEED_DOMAIN.length);
  const secret = sha512(transcript).slice(0, 32);
  return { secret, publicKey: x25519.getPublicKey(secret) };
}

/** The base58 spelling a `ClaimType::EncryptionKey` claim carries. */
export function encodeEncryptionPublicKey(publicKey: Uint8Array): string {
  return encodeBase58(publicKey);
}

/**
 * Parse a claim's value, or `null` if it is not a usable key.
 *
 * `null` for a small-order point as well as for a malformed string, and the
 * first is the one that matters: every ECDH against a small-order point
 * yields a shared secret that is public knowledge, so a grant sealed to one
 * would be readable by every node holding a replica. A node refuses such a
 * claim at publication, but a client must not depend on every node in the
 * network having done so.
 */
export function parseEncryptionPublicKey(value: string): Uint8Array | null {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase58(value);
  } catch {
    return null;
  }
  if (bytes.length !== 32) return null;
  try {
    // Throws on an all-zero result, which is exactly the small-order case.
    // The scalar is arbitrary; clamping makes it a multiple of the cofactor,
    // so it annihilates the small-order subgroup and nothing else.
    x25519.getSharedSecret(new Uint8Array(32).fill(1), bytes);
  } catch {
    return null;
  }
  return bytes;
}

/** Seal `plaintext` to a wallet's published encryption key. */
export function sealToEncryptionKey(
  recipient: Uint8Array,
  plaintext: Uint8Array,
): SealedBox {
  return sealTo(recipient, plaintext);
}

/** Open a box sealed to the public half of `keypair`. Throws if it was
 *  addressed to somebody else or altered in transit. */
export function openWithEncryptionKey(
  keypair: EncryptionKeypair,
  sealed: SealedBox,
): Uint8Array {
  return openSealed(keypair.secret, sealed);
}
