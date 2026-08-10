/**
 * deBridge DLN "Solana Hook" calldata for the OpenFiat presale's
 * `deliver_contribution` instruction (SP-B, cross-chain presale).
 *
 * A DLN order can carry a *hook*: an instruction the order-filling
 * executor runs automatically, on Solana, once the bridged token lands.
 * `buildDeliverContributionHook` builds that hook for presale
 * contributions bridged in from another chain — an Anchor
 * `deliver_contribution` call (see `openfiat-core/programs/programs/
 * presale`), wrapped in deBridge's own `ExternalInstruction` binary
 * layout and packaged as the `{ type: "solana_serialized_instructions",
 * data: { instructions: "0x..." } }` value the DLN `create-tx` API's
 * `dlnHook` parameter accepts.
 *
 * # Envelope shape — two conflicting primary sources
 *
 * deBridge's own docs disagree with each other on `data`'s shape for
 * this hook type. The prose guide ("Integrating Hooks", and its
 * "DlnHook encoding example") shows `data` as a **bare hex string**:
 * `{ type: "solana_serialized_instructions", data: "0x..." }`. The
 * live OpenAPI/Swagger spec the `create-tx` endpoint itself serves
 * (`https://docs.debridge.com/dln-details/swagger/create-tx.json`,
 * fetched and confirmed `200 OK` while writing this module — the prose
 * guide page 404s directly right now) describes `dlnHook`'s
 * `solana_serialized_instructions` template as a **nested object**:
 * `{ type: "solana_serialized_instructions", data: { instructions:
 * "0x..." } }`.
 *
 * This module follows the **Swagger spec** (the nested shape) as the
 * more authoritative of the two: it's machine-generated from the live
 * endpoint's own parameter schema rather than a hand-written example
 * that can silently drift, and it responded `200` from the same
 * request that found the prose guide broken. **This has not been
 * confirmed against a real `create-tx` call — Task 4 must verify the
 * envelope shape against the live API before this hook is used to
 * place a real order.** If `create-tx` actually wants the flat-string
 * shape, the only change needed is `buildSolanaHook`'s return
 * statement — the shape is produced/consumed in exactly that one
 * place (`SolanaHookData` + `buildSolanaHook`/`decodeSolanaHook`).
 *
 * # Wire format and how it was sourced
 *
 * `ExternalInstruction` is *not* Anchor/Borsh — it is deBridge's own
 * hand-rolled binary layout, and deBridge ships the real encoder only as
 * a GPL-3.0-only WebAssembly blob
 * (`@debridge-finance/debridge-external-call`, ~500KB, no source
 * alongside it). That is unsuitable as a dependency here twice over: its
 * license is incompatible with redistributing it inside this
 * Apache-2.0 SDK, and an opaque wasm binary is not something this repo's
 * own security review could ever audit. `@debridge-finance/dln-client`,
 * the higher-level order-creation SDK, pulls it in transitively and
 * drags a large EVM-oriented dependency tree (`viem`, `web3`,
 * `@coral-xyz/anchor` pinned to 0.29.0) along with it, for a single
 * struct's serialization this repo can encode directly instead.
 *
 * The layout below was instead implemented directly from deBridge's own
 * public *reference* serializer,
 * `debridge-finance/evm-sol-serializer`'s `DeBridgeSolanaSerializer.sol`
 * — Solidity, executable, and unambiguous about field order/width in a
 * way the prose docs aren't. It was then checked byte-for-byte by
 * decoding the worked `solana_serialized_instructions` example from
 * deBridge's own docs ("Integrating Hooks" ->
 * "DlnHook encoding example", canonically at
 * `https://docs.debridge.com/dln-details/integration-guidelines/
 * order-creation/hooks/integrating-hooks` — that exact page currently
 * 404s; the same content, with the same "Source:" URL, is mirrored at
 * `https://docs.debridge.com/llms-full.txt`, which was live when this
 * was written and is this module's fallback citation for that vector)
 * with this module's own `decodeSolanaHook` — that real, DLN-produced
 * example decodes cleanly to zero leftover bytes, 18 accounts, and
 * recognizable placeholder/program pubkeys (`AUTHORITY_PLACEHOLDER`,
 * `WALLET_PLACEHOLDER`, the SPL Associated Token and legacy Token
 * programs, mainnet USDC), which is strong evidence the byte layout
 * implemented here is right. `tests/debridge-hook.test.ts` checks both
 * directions: decoding that vector, and re-encoding the decode back to
 * the identical original bytes — the latter is what actually exercises
 * the encoder, not just the decoder.
 *
 * One deliberate divergence from `DeBridgeSolanaSerializer.sol`: that
 * library special-cases an *empty* `pubkey_substitutions`/
 * `data_substitutions` vector as a single `0x00` byte (Solidity has no
 * `undefined` to distinguish "empty" from "absent", so it collapses
 * them). The real, wasm-produced docs example instead encodes an empty
 * vector as present-with-zero-length (`0x01` + `u64(0)`) — this module's
 * encoder matches that observed real behavior rather than the Solidity
 * shortcut, since a decoder for the real format has to accept it
 * anyway. `decodeExternalInstruction` accepts both.
 *
 * # What still needs live-deBridge validation (flagged for Task 4)
 *
 * - **The `data` envelope shape itself** — see above. Highest-priority
 *   item to verify: getting this wrong either makes `create-tx` reject
 *   the order outright, or (worse) silently ignore the hook so the
 *   order still bridges funds but `deliver_contribution` never fires.
 * - `reward`/`expense` are caller-supplied here and default to `0n`. In
 *   practice a profitable `reward` has to come from the DLN API's own
 *   cost-estimation step (`create-tx`) before an order is placed, or no
 *   executor picks the hook up. This module does not call that API.
 * - `AUTHORITY_PLACEHOLDER`/`WALLET_PLACEHOLDER` are documented as
 *   *implicit* substitutions — the executor recognizes the constant
 *   pubkey itself, no `pubkey_substitutions` entry required — which is
 *   what this module relies on for `payer`/`source_usdc`. That has not
 *   been exercised against a live deBridge executor from this
 *   environment.
 * - Whether the DLN `create-tx` endpoint's hook-simulation step accepts
 *   a hook that both creates the `recipient_open` ATA and the
 *   `contribution` PDA and moves funds in the same non-atomic hook
 *   instruction has not been confirmed live.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";

import { instructionData, u32LE, u64LE } from "../onchain/codec.js";

/**
 * Recognized by deBridge's Solana calldata executor by *value* — any
 * account slot holding this exact pubkey is replaced with the
 * `ExtcallAuthority` account (the executor's own signer, owner of the
 * `ExtcallWallet` that received the order's take-token) at fill time.
 * No `pubkey_substitutions` entry needed. Source: deBridge docs,
 * "Solana Hook Data" — see the module doc for the exact URL structure.
 */
export const AUTHORITY_PLACEHOLDER = new PublicKey("2iBUASRfDHgEkuZ91Lvos5NxwnmiryHrNbWBfEVqHRQZ");

/**
 * Recognized the same way as {@link AUTHORITY_PLACEHOLDER}: replaced
 * with `ExtcallWallet`, the token account the DLN delivered the order's
 * take-token (USDC, for this hook) into.
 */
export const WALLET_PLACEHOLDER = new PublicKey("J4vKrc4pCdtiHpxFDfBy4iyZ22Uf7fBjJyJ817k4673y");

/**
 * Replaced with `ExtcallMeta` — order metadata (take mint, amount,
 * orderId). Not used by `deliver_contribution` (its own instruction args
 * already carry `usdc_amount`), exported for completeness/decoding.
 */
export const SUBMISSION_META_PLACEHOLDER = new PublicKey("7cu34CRu47UZKLRHjt9kFPhuoYyHCzAafGiGWz83GNFs");

/** The SPL Associated Token Account program — same address on every cluster. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/**
 * `deliver_contribution`'s Anchor discriminator — `sha256("global:
 * deliver_contribution")[..8]`, taken directly from `openfiat-core/
 * programs/target/idl/presale.json`. Re-derive that IDL and diff this
 * constant if the instruction is ever renamed.
 */
export const DELIVER_CONTRIBUTION_DISCRIMINATOR = Uint8Array.from([47, 6, 1, 114, 89, 84, 180, 242]);

/** `["contribution", sale_config, recipient]` — matches `presale`'s own PDA seeds for the `Contribution` account. */
const CONTRIBUTION_SEED = Buffer.from("contribution");

function recipientOpenAta(recipient: PublicKey, openMint: PublicKey, openTokenProgram: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [recipient.toBytes(), openTokenProgram.toBytes(), openMint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

function contributionPda(programId: PublicKey, saleConfig: PublicKey, recipient: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [CONTRIBUTION_SEED, saleConfig.toBytes(), recipient.toBytes()],
    programId,
  );
  return pda;
}

// ---------------------------------------------------------------------------
// `ExternalInstruction` — deBridge's own binary layout, encode + decode.
// ---------------------------------------------------------------------------

export type ExecutePolicy = "empty" | "mandatoryBlock";

export type SeedVariant = { kind: "arbitrary"; bytes: Uint8Array } | { kind: "submissionAuth" };

export type PubkeySubstitution =
  | { kind: "submissionAuthWallet"; accountIndex: number; tokenMint: PublicKey }
  | {
      kind: "bySeeds";
      accountIndex: number;
      programId: PublicKey;
      seeds: SeedVariant[];
      bump: number | undefined;
    };

export interface DataSubstitution {
  kind: "submissionAuthWalletAmount";
  accountIndex: number;
  offset: number;
  isBigEndian: boolean;
  subtraction: bigint;
}

export interface ExternalInstruction {
  /** Native SOL paid to the executor for running this instruction. */
  reward: bigint;
  /** Lamports this instruction needs beyond the flat per-instruction 5000 (e.g. rent for accounts it creates). `undefined` encodes as Borsh-style `None`. */
  expense: bigint | undefined;
  executePolicy: ExecutePolicy;
  pubkeySubstitutions: PubkeySubstitution[];
  dataSubstitutions: DataSubstitution[];
  instruction: TransactionInstruction;
}

/**
 * The single-instruction hook shape the DLN `create-tx` API's `dlnHook`
 * parameter accepts for Solana (`dstChainId=7565164`) — per the live
 * `create-tx` Swagger/OpenAPI spec's `dlnHook` parameter description.
 * See the module doc's "Envelope shape" section: this is the more
 * authoritative of two disagreeing deBridge sources and is flagged for
 * live confirmation in Task 4.
 */
export interface SolanaHookData {
  type: "solana_serialized_instructions";
  data: {
    /** `0x`-prefixed hex — the concatenation of each instruction's serialized `ExternalInstruction`. */
    instructions: string;
  };
}

function optionU64(value: bigint | undefined): Uint8Array {
  if (value === undefined) {
    return Uint8Array.of(0);
  }
  return concat(Uint8Array.of(1), u64LE(value));
}

function boolByte(value: boolean): Uint8Array {
  return Uint8Array.of(value ? 1 : 0);
}

function concat(...parts: Uint8Array[]): Buffer {
  return Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.length)));
}

function encodeSeedVariant(seed: SeedVariant): Buffer {
  if (seed.kind === "submissionAuth") {
    return concat(u32LE(1));
  }
  return concat(u32LE(0), u64LE(BigInt(seed.bytes.length)), seed.bytes);
}

function encodePubkeySubstitutionPayload(sub: PubkeySubstitution): Buffer {
  if (sub.kind === "submissionAuthWallet") {
    return concat(u32LE(0), sub.tokenMint.toBytes());
  }
  const seeds = concat(u64LE(BigInt(sub.seeds.length)), ...sub.seeds.map(encodeSeedVariant));
  const bump = sub.bump === undefined ? Uint8Array.of(0) : concat(Uint8Array.of(1), Uint8Array.of(sub.bump));
  return concat(u32LE(1), sub.programId.toBytes(), seeds, bump);
}

function encodeDataSubstitution(sub: DataSubstitution): Buffer {
  return concat(
    u32LE(0), // the only variant deBridge documents: SubmissionAuthWalletAmount
    u64LE(BigInt(sub.accountIndex)),
    u64LE(BigInt(sub.offset)),
    boolByte(sub.isBigEndian),
    u64LE(sub.subtraction),
  );
}

function encodeAccountMeta(meta: AccountMeta): Buffer {
  return concat(meta.pubkey.toBytes(), boolByte(meta.isSigner), boolByte(meta.isWritable));
}

/**
 * Serializes one `ExternalInstruction`. The DLN API's
 * `solana_serialized_instructions` hook is one or more of these
 * concatenated back to back with no outer length/count prefix — see
 * {@link buildSolanaHook}.
 */
export function encodeExternalInstruction(ei: ExternalInstruction): Buffer {
  const policy = u32LE(ei.executePolicy === "mandatoryBlock" ? 1 : 0);

  const pubkeySubs = concat(
    Uint8Array.of(1),
    u64LE(BigInt(ei.pubkeySubstitutions.length)),
    ...ei.pubkeySubstitutions.map((s) => concat(u64LE(BigInt(s.accountIndex)), encodePubkeySubstitutionPayload(s))),
  );

  const dataSubs = concat(
    Uint8Array.of(1),
    u64LE(BigInt(ei.dataSubstitutions.length)),
    ...ei.dataSubstitutions.map(encodeDataSubstitution),
  );

  const instruction = concat(
    ei.instruction.programId.toBytes(),
    u64LE(BigInt(ei.instruction.keys.length)),
    ...ei.instruction.keys.map(encodeAccountMeta),
    u64LE(BigInt(ei.instruction.data.length)),
    ei.instruction.data,
  );

  return concat(u64LE(ei.reward), optionU64(ei.expense), policy, pubkeySubs, dataSubs, instruction);
}

/** Concatenates one or more hook instructions into the DLN API's `dlnHook` payload for Solana. */
export function buildSolanaHook(instructions: ExternalInstruction[]): SolanaHookData {
  const bytes = concat(...instructions.map(encodeExternalInstruction));
  return { type: "solana_serialized_instructions", data: { instructions: `0x${bytes.toString("hex")}` } };
}

class Cursor {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  remaining(): number {
    return this.bytes.length - this.offset;
  }

  bytesAt(len: number): Uint8Array {
    const slice = this.bytes.subarray(this.offset, this.offset + len);
    if (slice.length !== len) {
      throw new Error(`deBridge hook decode: expected ${len} bytes, only ${slice.length} remain`);
    }
    this.offset += len;
    return slice;
  }

  u8(): number {
    return this.bytesAt(1)[0] as number;
  }

  u32(): number {
    const b = this.bytesAt(4);
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
  }

  u64(): bigint {
    const b = this.bytesAt(8);
    return new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, true);
  }

  pubkey(): PublicKey {
    return new PublicKey(this.bytesAt(32));
  }

  bool(): boolean {
    return this.u8() !== 0;
  }
}

function decodeSeedVariant(c: Cursor): SeedVariant {
  const tag = c.u32();
  if (tag === 1) {
    return { kind: "submissionAuth" };
  }
  if (tag === 0) {
    const len = Number(c.u64());
    return { kind: "arbitrary", bytes: Uint8Array.from(c.bytesAt(len)) };
  }
  throw new Error(`deBridge hook decode: unknown SeedVariant tag ${tag}`);
}

function decodePubkeySubstitution(c: Cursor): PubkeySubstitution {
  const accountIndex = Number(c.u64());
  const variant = c.u32();
  if (variant === 0) {
    return { kind: "submissionAuthWallet", accountIndex, tokenMint: c.pubkey() };
  }
  if (variant === 1) {
    const programId = c.pubkey();
    const seedCount = Number(c.u64());
    const seeds: SeedVariant[] = [];
    for (let i = 0; i < seedCount; i += 1) {
      seeds.push(decodeSeedVariant(c));
    }
    const bumpTag = c.u8();
    const bump = bumpTag === 1 ? c.u8() : undefined;
    return { kind: "bySeeds", accountIndex, programId, seeds, bump };
  }
  throw new Error(`deBridge hook decode: unknown PubkeySubstitution variant ${variant}`);
}

function decodeDataSubstitution(c: Cursor): DataSubstitution {
  const variant = c.u32();
  if (variant !== 0) {
    throw new Error(`deBridge hook decode: unknown DataSubstitution variant ${variant}`);
  }
  const accountIndex = Number(c.u64());
  const offset = Number(c.u64());
  const isBigEndian = c.bool();
  const subtraction = c.u64();
  return { kind: "submissionAuthWalletAmount", accountIndex, offset, isBigEndian, subtraction };
}

function decodeOneExternalInstruction(c: Cursor): ExternalInstruction {
  const reward = c.u64();

  const expenseTag = c.u8();
  const expense = expenseTag === 1 ? c.u64() : undefined;

  const policyTag = c.u32();
  const executePolicy: ExecutePolicy = policyTag === 1 ? "mandatoryBlock" : "empty";

  const pubkeySubs: PubkeySubstitution[] = [];
  if (c.u8() === 1) {
    const n = Number(c.u64());
    for (let i = 0; i < n; i += 1) {
      pubkeySubs.push(decodePubkeySubstitution(c));
    }
  }

  const dataSubs: DataSubstitution[] = [];
  if (c.u8() === 1) {
    const n = Number(c.u64());
    for (let i = 0; i < n; i += 1) {
      dataSubs.push(decodeDataSubstitution(c));
    }
  }

  const programId = c.pubkey();
  const accountCount = Number(c.u64());
  const keys: AccountMeta[] = [];
  for (let i = 0; i < accountCount; i += 1) {
    const pubkey = c.pubkey();
    const isSigner = c.bool();
    const isWritable = c.bool();
    keys.push({ pubkey, isSigner, isWritable });
  }
  const dataLen = Number(c.u64());
  const data = Buffer.from(c.bytesAt(dataLen));

  return {
    reward,
    expense,
    executePolicy,
    pubkeySubstitutions: pubkeySubs,
    dataSubstitutions: dataSubs,
    instruction: new TransactionInstruction({ programId, keys, data }),
  };
}

/** Decodes a hook produced by {@link buildSolanaHook} back into its instructions — the inverse of `encodeExternalInstruction`, run once per concatenated instruction. */
export function decodeSolanaHook(hook: SolanaHookData): ExternalInstruction[] {
  const raw = hook.data.instructions;
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  const c = new Cursor(Buffer.from(hex, "hex"));
  const instructions: ExternalInstruction[] = [];
  while (c.remaining() > 0) {
    instructions.push(decodeOneExternalInstruction(c));
  }
  return instructions;
}

// ---------------------------------------------------------------------------
// The `deliver_contribution` hook itself.
// ---------------------------------------------------------------------------

export interface DeliverContributionHookParams {
  saleNonce: bigint;
  recipient: PublicKey;
  usdcAmount: bigint;
  /** The presale program (`declare_id!` — see `openfiat-core/programs/programs/presale/src/lib.rs`). Not hardcoded here: unlike escrow/staking/governance, the presale deployment this hook targets varies by environment. */
  programId: PublicKey;
  saleConfig: PublicKey;
  usdcVault: PublicKey;
  presaleVault: PublicKey;
  presaleVaultAuthority: PublicKey;
  openMint: PublicKey;
  usdcMint: PublicKey;
  /** `presale::deliver_contribution`'s `ban_record` account — `[b"ban", recipient]` under `openfiat-governance`. Callers derive this with `onchain.banRecordPda(recipient)` rather than this module re-deriving it, so `debridge/` doesn't have to depend on `onchain/`'s governance wiring for one PDA. */
  banRecord: PublicKey;
  tokenPrograms: {
    /** USDC moves under its own token program (legacy SPL, most likely). */
    usdc: PublicKey;
    /** OPEN moves under its mint's token program (Token-2022). */
    open: PublicKey;
  };
  /** Reward paid to the executor, in lamports. Defaults to `0n` — see the module doc's live-validation note; this should come from the DLN API's cost-estimation step before the order is actually placed. */
  reward?: bigint;
  /** Lamports this instruction needs beyond the flat 5000/instruction baseline (rent for the `recipient_open` ATA and `contribution` PDA it creates). Defaults to `0n` for the same reason as `reward`. */
  expense?: bigint;
}

/**
 * Builds the deBridge DLN Solana hook that invokes `presale::
 * deliver_contribution` when a cross-chain contribution order is filled.
 *
 * `payer` (the deBridge executor's own wallet, Signer) and `source_usdc`
 * (the token account the DLN delivered the bridged USDC into) are
 * *never* accepted as parameters here — both are only known to the
 * executor at fill time, so both are written as
 * {@link AUTHORITY_PLACEHOLDER} / {@link WALLET_PLACEHOLDER} and left for
 * deBridge's own executor to substitute. Every other account is either a
 * caller-supplied fixed account or a PDA/ATA this function derives the
 * same way `presale` derives it on-chain (`recipient_open`,
 * `contribution`), matching `deliver_contribution`'s account order in
 * `openfiat-core/programs/target/idl/presale.json` exactly.
 */
export function buildDeliverContributionHook(params: DeliverContributionHookParams): SolanaHookData {
  const recipientOpen = recipientOpenAta(params.recipient, params.openMint, params.tokenPrograms.open);
  const contribution = contributionPda(params.programId, params.saleConfig, params.recipient);

  const keys: AccountMeta[] = [
    { pubkey: AUTHORITY_PLACEHOLDER, isSigner: true, isWritable: true }, // payer
    { pubkey: params.banRecord, isSigner: false, isWritable: false },
    { pubkey: params.saleConfig, isSigner: false, isWritable: true },
    { pubkey: params.usdcMint, isSigner: false, isWritable: false },
    { pubkey: WALLET_PLACEHOLDER, isSigner: false, isWritable: true }, // source_usdc
    { pubkey: params.usdcVault, isSigner: false, isWritable: true },
    { pubkey: params.openMint, isSigner: false, isWritable: false },
    { pubkey: params.presaleVaultAuthority, isSigner: false, isWritable: false },
    { pubkey: params.presaleVault, isSigner: false, isWritable: true },
    { pubkey: params.recipient, isSigner: false, isWritable: false }, // recipient_account
    { pubkey: recipientOpen, isSigner: false, isWritable: true },
    { pubkey: contribution, isSigner: false, isWritable: true },
    { pubkey: params.tokenPrograms.usdc, isSigner: false, isWritable: false },
    { pubkey: params.tokenPrograms.open, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = instructionData(
    DELIVER_CONTRIBUTION_DISCRIMINATOR,
    u64LE(params.saleNonce),
    params.recipient.toBytes(),
    u64LE(params.usdcAmount),
  );

  const instruction = new TransactionInstruction({ programId: params.programId, keys, data });

  const ei: ExternalInstruction = {
    reward: params.reward ?? 0n,
    expense: params.expense,
    executePolicy: "empty", // this hook type only supports non-atomic, success-optional execution (deBridge docs)
    pubkeySubstitutions: [],
    dataSubstitutions: [],
    instruction,
  };

  return buildSolanaHook([ei]);
}
