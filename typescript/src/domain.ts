/**
 * Domain-separated signing preimages (F-01).
 *
 * A node verifies client-signed events over
 * `preimage(tag, payload) = len(tag):u32be ‖ utf8(tag) ‖ json(payload)`
 * rather than bare `json(payload)`. Binding the payload's type into the
 * signed bytes is what stops a signature made for one event type being
 * replayed as a different event type that happens to share the same JSON
 * shape — see `openfiat-core`'s `crates/serialization/src/domain.rs` for
 * the full rationale, which this module mirrors exactly.
 *
 * The tag is length-prefixed rather than merely concatenated so that
 * `(tag, payload)` pairs are unambiguous: without the length prefix, a tag
 * ending in the prefix of another plus a payload whose first bytes make up
 * the difference could still collide.
 */

/** The bytes to sign for an already-encoded `body` under `tag`:
 *  `len(tag):u32be ‖ utf8(tag) ‖ body`. Byte-identical to the Rust
 *  workspace's `preimage_raw`. */
export function preimage(tag: string, body: Uint8Array): Uint8Array {
  const tagBytes = new TextEncoder().encode(tag);
  const out = new Uint8Array(4 + tagBytes.length + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, tagBytes.length, false);
  out.set(tagBytes, 4);
  out.set(body, 4 + tagBytes.length);
  return out;
}

/** Convenience form of {@link preimage}: JSON-encodes `payload` the same
 *  way every signed event on this SDK already does, then wraps it with the
 *  domain header. Do not change how `payload` is encoded here — the JSON
 *  body is unchanged by F-01, only the header wrapping it is new. */
export function preimageOf(tag: string, payload: unknown): Uint8Array {
  return preimage(tag, new TextEncoder().encode(JSON.stringify(payload)));
}
