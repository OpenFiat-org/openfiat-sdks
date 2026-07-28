import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { expect } from "vitest";

/** A deterministic, distinct 32-byte "pubkey" for test fixtures — doesn't need to be on-curve. */
export function fakePubkey(seed: number): PublicKey {
  return new PublicKey(new Uint8Array(32).fill(seed));
}

export function expectDiscriminator(ix: TransactionInstruction, expected: number[]): void {
  expect(Array.from(ix.data.subarray(0, 8))).toEqual(expected);
}

export interface ExpectedAccount {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}

export function expectAccounts(ix: TransactionInstruction, expected: ExpectedAccount[]): void {
  expect(ix.keys.length).toBe(expected.length);
  expected.forEach((exp, i) => {
    const actual = ix.keys[i];
    expect(actual, `account ${i}`).toBeDefined();
    expect(actual?.pubkey.equals(exp.pubkey), `account ${i} pubkey`).toBe(true);
    expect(actual?.isSigner, `account ${i} isSigner`).toBe(exp.isSigner);
    expect(actual?.isWritable, `account ${i} isWritable`).toBe(exp.isWritable);
  });
}
