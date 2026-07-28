import type { AccountMeta, PublicKey } from "@solana/web3.js";

/**
 * Minimal Borsh-subset encoder for this SDK's own on-chain instruction
 * args. Anchor's `#[program]` macro serializes every instruction's args
 * with Borsh (via `AnchorSerialize`), and every arg type the three
 * on-chain programs in `src/onchain/` actually use — little-endian
 * fixed-width integers, a single 0/1 byte for `bool`, fixed-size byte
 * arrays, 32-byte pubkeys, a UTF-8 string with a u32-LE length prefix,
 * and a single-byte tag for a C-like enum — is simple and fully
 * specified by the Borsh spec itself, so hand-encoding it directly here
 * avoids pulling in a full schema-driven Borsh library for this narrow,
 * fixed set of shapes. Every encoder here works in plain `Uint8Array`;
 * only `instructionData`'s final result is wrapped in `Buffer`, since
 * that's what `@solana/web3.js`'s own `TransactionInstruction.data`
 * field requires (matching this SDK's existing use of `Buffer` at
 * other `@solana/web3.js`/base64 boundaries, e.g. `methods/chain.ts`).
 */

export function u16LE(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, true);
  return buf;
}

export function u64LE(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, value, true);
  return buf;
}

export function i64LE(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigInt64(0, value, true);
  return buf;
}

export function boolByte(value: boolean): Uint8Array {
  return Uint8Array.of(value ? 1 : 0);
}

/** A C-like enum's Borsh wire format: always a single tag byte, regardless of variant count. */
export function enumTag(index: number): Uint8Array {
  return Uint8Array.of(index);
}

export function fixedBytes(bytes: Uint8Array, expectedLength: number): Uint8Array {
  if (bytes.length !== expectedLength) {
    throw new Error(`expected ${expectedLength} bytes, got ${bytes.length}`);
  }
  return bytes;
}

export function borshString(value: string): Uint8Array {
  const utf8 = new TextEncoder().encode(value);
  const buf = new Uint8Array(4 + utf8.length);
  new DataView(buf.buffer).setUint32(0, utf8.length, true);
  buf.set(utf8, 4);
  return buf;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Builds instruction data as `discriminator || borsh-encoded args`. */
export function instructionData(discriminator: Uint8Array, ...args: Uint8Array[]): Buffer {
  return Buffer.from(concatBytes(discriminator, ...args));
}

export function meta(pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta {
  return { pubkey, isSigner, isWritable };
}
