/**
 * The encryption key derivation, checked against `openfiat-core` rather
 * than against itself.
 *
 * A round-trip test in this file would prove nothing that matters. Two
 * implementations that are each internally consistent and mutually
 * incompatible both pass one, and here that failure is expensive and
 * silent: a user would enrol under one key, have `KeyGrant`s sealed to
 * another, and find out on a trade already in progress that their payment
 * details are "sealed" and unreadable — which is exactly the bug this
 * mechanism was built to fix, wearing the fix's clothes.
 *
 * So the vectors below were produced by the Rust implementation
 * (`openfiat_crypto::encryption_key`, wallet seed `07` repeated 32 times)
 * and are asserted here byte for byte, in both directions:
 *
 *   - the same wallet signature must derive the same X25519 key, and the
 *     same base58 spelling, since that string is what a claim carries;
 *   - a box Rust sealed to that key must open here, which is the direction
 *     a browser needs — the counterparty may be running anything.
 *
 * `scripts/encryption-key-fixture.ts` regenerates the other direction for
 * `openfiat-core`'s matching test. If these ever disagree, one of the two
 * constants moved and neither side should be "fixed" to match the other
 * without deciding which is right: changing `DERIVATION_MESSAGE` orphans
 * every key already published to the network.
 */

import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";

import {
  DERIVATION_MESSAGE,
  derivationMessageBytes,
  deriveEncryptionKeypair,
  encodeEncryptionPublicKey,
  openWithEncryptionKey,
  parseEncryptionPublicKey,
  sealToEncryptionKey,
} from "../src/encryption-key.js";
import { SealError } from "../src/seal.js";

const WALLET_SEED = new Uint8Array(32).fill(7);

/** `openfiat_crypto`'s output for that seed. */
const RUST = {
  signature: [
    39, 48, 222, 29, 73, 105, 58, 218, 239, 151, 215, 236, 222, 153, 7, 24, 210, 93, 217, 47, 241,
    108, 51, 87, 25, 20, 129, 6, 241, 203, 45, 253, 60, 123, 161, 182, 98, 106, 23, 238, 81, 79,
    254, 199, 8, 168, 186, 253, 190, 167, 57, 139, 180, 183, 207, 119, 2, 250, 162, 107, 250, 222,
    147, 1,
  ],
  encryptionPublicKeyBase58: "AZ18KopCSZw3YpzhrFf3zxvNo6FejeCAnHj3FgJSCNGw",
  /** A channel key Rust sealed to that published encryption key. */
  sealedChannelKey: {
    ephemeral_public: [
      152, 173, 126, 208, 16, 42, 211, 51, 168, 113, 186, 108, 251, 112, 132, 203, 174, 103, 96,
      179, 248, 205, 147, 129, 216, 85, 172, 25, 201, 69, 19, 82,
    ],
    nonce: [144, 71, 173, 47, 96, 194, 239, 68, 147, 168, 53, 90],
    ciphertext: [
      14, 116, 244, 140, 118, 42, 218, 79, 0, 148, 10, 161, 227, 201, 140, 42, 20, 184, 70, 173,
      129, 168, 93, 30, 34, 124, 19, 87, 178, 32, 94, 121, 37, 39, 14, 177, 255, 118, 152, 91, 70,
      230, 182, 241, 207, 131, 47, 0,
    ],
  },
  channelKey: "32 bytes of channel key, roughly",
};

describe("the derivation message", () => {
  it("is the byte-for-byte string openfiat-core signs", () => {
    // Spelled out rather than compared to itself: this constant is a wire
    // format, and a stray space here silently orphans every key already
    // published to the network.
    expect(DERIVATION_MESSAGE.startsWith("OpenFiat encryption key (v1)\n\n")).toBe(true);
    expect(derivationMessageBytes().length).toBe(377);
  });

  it("cannot be mistaken for anything else a wallet is asked to sign", () => {
    // Domain events are signed over JSON; gated reads sign
    // `<domain>:<subject>:<nonce>`. Neither can begin this way.
    expect(DERIVATION_MESSAGE.startsWith("{")).toBe(false);
    expect(DERIVATION_MESSAGE.startsWith("openfiat-")).toBe(false);
  });

  it("cannot be read as a serialized Solana transaction", () => {
    // A message begins with its count of required signatures, and each of
    // those needs a 32-byte account key. Ours starts with `O` (79), which
    // demands 2528 bytes of keys that are not there.
    const bytes = derivationMessageBytes();
    expect(bytes.length).toBeLessThan(bytes[0]! * 32);
  });
});

describe("deriving a wallet's encryption key", () => {
  const signature = ed25519.sign(derivationMessageBytes(), WALLET_SEED);

  it("signs the same bytes openfiat-core signs", () => {
    expect(Array.from(signature)).toEqual(RUST.signature);
  });

  it("derives the key openfiat-core derives from that signature", () => {
    const keypair = deriveEncryptionKeypair(signature);
    expect(encodeEncryptionPublicKey(keypair.publicKey)).toBe(RUST.encryptionPublicKeyBase58);
  });

  it("is deterministic, which is what makes it recoverable at all", () => {
    expect(Array.from(deriveEncryptionKeypair(signature).secret)).toEqual(
      Array.from(deriveEncryptionKeypair(signature).secret),
    );
  });

  it("refuses a signature that is not 64 bytes", () => {
    // Reachable: a wallet that returned a short or wrapped signature would
    // otherwise be hashed into a key nobody else will ever compute.
    expect(() => deriveEncryptionKeypair(new Uint8Array(63))).toThrow(SealError);
  });

  it("derives a different key from a signature over anything else", () => {
    const other = ed25519.sign(new TextEncoder().encode("OpenFiat encryption key (v1)"), WALLET_SEED);
    expect(Array.from(deriveEncryptionKeypair(other).publicKey)).not.toEqual(
      Array.from(deriveEncryptionKeypair(signature).publicKey),
    );
  });
});

describe("grants", () => {
  const keypair = deriveEncryptionKeypair(ed25519.sign(derivationMessageBytes(), WALLET_SEED));

  it("opens one that openfiat-core sealed", () => {
    const opened = openWithEncryptionKey(keypair, RUST.sealedChannelKey);
    expect(new TextDecoder().decode(opened)).toBe(RUST.channelKey);
  });

  it("refuses one addressed to another wallet", () => {
    const other = deriveEncryptionKeypair(
      ed25519.sign(derivationMessageBytes(), new Uint8Array(32).fill(8)),
    );
    // Guards against the way the test above could pass while proving
    // nothing: if opening ignored the key, it would still succeed.
    expect(() => openWithEncryptionKey(other, RUST.sealedChannelKey)).toThrow(SealError);
  });

  it.each([
    ["ciphertext", (box: typeof RUST.sealedChannelKey) => ({ ...box, ciphertext: flip(box.ciphertext) })],
    [
      "ephemeral key",
      (box: typeof RUST.sealedChannelKey) => ({ ...box, ephemeral_public: flip(box.ephemeral_public) }),
    ],
    ["nonce", (box: typeof RUST.sealedChannelKey) => ({ ...box, nonce: flip(box.nonce) })],
  ])("fails rather than returning garbage when the %s is tampered with", (_name, mutate) => {
    expect(() => openWithEncryptionKey(keypair, mutate(RUST.sealedChannelKey))).toThrow(SealError);
  });

  it("round-trips one it sealed itself", () => {
    const sealed = sealToEncryptionKey(keypair.publicKey, new TextEncoder().encode("secret"));
    expect(new TextDecoder().decode(openWithEncryptionKey(keypair, sealed))).toBe("secret");
  });
});

describe("parsing a published key", () => {
  it("accepts the spelling a claim carries", () => {
    expect(parseEncryptionPublicKey(RUST.encryptionPublicKeyBase58)).not.toBeNull();
  });

  it("rejects a value that is not a key", () => {
    expect(parseEncryptionPublicKey("user@example.com")).toBeNull();
    expect(parseEncryptionPublicKey(encodeEncryptionPublicKey(new Uint8Array(31)))).toBeNull();
  });

  it("rejects a small-order point, whose shared secret is public knowledge", () => {
    // A node refuses this at publication, but a client must not depend on
    // every node in the network having done so: a grant sealed to one of
    // these is readable by anybody holding a replica.
    expect(parseEncryptionPublicKey("1".repeat(32))).toBeNull();
  });
});

function flip(bytes: number[]): number[] {
  return [(bytes[0]! ^ 0x01) & 0xff, ...bytes.slice(1)];
}
