import { describe, expect, it } from "vitest";
import { Base58Error, decodeBase58, encodeBase58 } from "../src/base58.js";

describe("base58", () => {
  it("encodes a peer id to the 12D3Koo form a node publishes", () => {
    // The exact bytes a live `getProviders` returned: an identity multihash
    // (00 24) wrapping protobuf `Type=Ed25519` (08 01), `Data=32 bytes`
    // (12 20), then the public key itself.
    const peerId = new Uint8Array([
      0, 36, 8, 1, 18, 32, 138, 172, 246, 48, 208, 101, 155, 70, 162, 159, 216, 168, 140, 93, 246,
      114, 240, 183, 215, 183, 151, 57, 79, 65, 139, 7, 250, 175, 52, 209, 191, 170,
    ]);
    expect(encodeBase58(peerId)).toBe("12D3KooWK9hQ7TwbfvFiaAxUbRFCkdhS7iEpAJDnewNL1anyREQ1");
    // And the key on its own is what the same response called payout_wallet.
    expect(encodeBase58(peerId.slice(6))).toBe("ALLENLMtV1zEAHT3xpVryqcbdPCB8c9JhM1Jdbe5XHg5");
  });

  it("round-trips every byte length that matters here", () => {
    for (const length of [32, 38, 64]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
      expect(decodeBase58(encodeBase58(bytes))).toEqual(bytes);
    }
  });

  it("preserves leading zero bytes as leading ones", () => {
    // Dropping them would silently shorten a key: base58 carries magnitude,
    // so a leading zero contributes nothing to the number and has to be
    // encoded positionally.
    // '1' is digit 0, so the value 9 is the tenth character, 'A'.
    const bytes = new Uint8Array([0, 0, 0, 9]);
    expect(encodeBase58(bytes)).toBe("111A");
    expect(decodeBase58("111A")).toEqual(bytes);
  });

  it("round-trips all-zero bytes", () => {
    const zeros = new Uint8Array(32);
    expect(encodeBase58(zeros)).toBe("1".repeat(32));
    expect(decodeBase58(encodeBase58(zeros))).toEqual(zeros);
  });

  it("agrees with the reference implementation on random input", async () => {
    const { PublicKey } = await import("@solana/web3.js");
    for (let i = 0; i < 200; i += 1) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      expect(encodeBase58(bytes)).toBe(new PublicKey(bytes).toBase58());
    }
  });

  it("refuses the four characters base58 omits", () => {
    // 0/O and I/l are the pairs the alphabet drops precisely because they
    // are misread. Accepting them would decode to bytes the writer never
    // meant, which for a key means addressing the wrong wallet.
    for (const character of ["0", "O", "I", "l"]) {
      expect(() => decodeBase58(`abc${character}def`)).toThrow(Base58Error);
    }
  });
});
