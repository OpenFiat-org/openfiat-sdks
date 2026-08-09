import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { preimage } from "../src/domain.js";

/**
 * Byte-for-byte proof that this SDK's domain header
 * (`len(tag):u32be ‖ utf8(tag) ‖ body`) matches `openfiat-core`'s
 * `crates/serialization/src/domain.rs::preimage_raw`.
 *
 * The vectors are vendored from that crate rather than generated here —
 * generating them locally would only prove this file agrees with itself.
 * Each row's `payload_json` is taken as opaque bytes (exactly as the Rust
 * side's `preimage_raw` does with `body`), so this test never touches JSON
 * body serialization; it only exercises the header framing.
 */

interface Vector {
  tag: string;
  payload_json: string;
  preimage_hex: string;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const vectorsPath = fileURLToPath(new URL("./vectors/client_signed_v1.json", import.meta.url));
const vectors: Vector[] = JSON.parse(readFileSync(vectorsPath, "utf8"));

describe("client-signed domain preimage conformance (F-01)", () => {
  it("loaded a non-empty vector set", () => {
    // A vectors file that failed to load or was accidentally emptied would
    // otherwise make every case below vacuously pass.
    expect(vectors.length).toBeGreaterThan(0);
  });

  it.each(vectors.map((v) => [v.tag, v] as const))("%s", (_tag, vector) => {
    const body = new TextEncoder().encode(vector.payload_json);
    expect(toHex(preimage(vector.tag, body))).toBe(vector.preimage_hex);
  });
});
