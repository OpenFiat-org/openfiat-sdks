import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { enumTag, fixedBytes, i64LE, instructionData, meta, u16LE, u64LE } from "./codec.js";
import { ESCROW_PROGRAM_ID, RENT_SYSVAR_ID, TOKEN_2022_PROGRAM_ID } from "./constants.js";
import type { DisputeOutcome } from "./constants.js";

/**
 * PDA seeds for `openfiat-escrow` (OFS-4200 §4, Phase 4b) — taken
 * directly from `openfiat-core/programs/programs/escrow/src/
 * constants.rs`. Every seed byte string below is compared 1:1 against
 * that file in this module's own test suite.
 */
const LIQUIDITY_VAULT_SEED = Buffer.from("liquidity_vault");
const LIQUIDITY_VAULT_TOKENS_SEED = Buffer.from("liquidity_vault_tokens");
const TRADE_ESCROW_SEED = Buffer.from("trade_escrow");
const TRADE_ESCROW_TOKENS_SEED = Buffer.from("trade_escrow_tokens");
const FEE_CONFIG_SEED = Buffer.from("fee_config");
const DISPUTE_CASE_SEED = Buffer.from("dispute_case");

const DISCRIMINATORS = {
  initializeFeeConfig: Uint8Array.from([62, 162, 20, 133, 121, 65, 145, 27]),
  updateFeeConfig: Uint8Array.from([104, 184, 103, 242, 88, 151, 107, 20]),
  createLiquidityVault: Uint8Array.from([204, 255, 106, 205, 72, 186, 252, 83]),
  depositLiquidity: Uint8Array.from([245, 99, 59, 25, 151, 71, 233, 249]),
  reserveLiquidity: Uint8Array.from([197, 37, 232, 60, 182, 38, 12, 84]),
  withdrawLiquidity: Uint8Array.from([149, 158, 33, 185, 47, 243, 253, 31]),
  createTradeEscrow: Uint8Array.from([149, 181, 111, 61, 122, 174, 71, 51]),
  fundTradeEscrow: Uint8Array.from([148, 177, 67, 164, 227, 76, 173, 101]),
  approveSettlement: Uint8Array.from([186, 5, 15, 163, 23, 10, 142, 12]),
  releaseEscrow: Uint8Array.from([146, 253, 129, 233, 20, 145, 181, 206]),
  cancelReservation: Uint8Array.from([72, 162, 75, 180, 116, 157, 146, 172]),
  expireReservation: Uint8Array.from([19, 147, 203, 128, 237, 194, 72, 183]),
  openDisputeCase: Uint8Array.from([28, 229, 240, 113, 124, 180, 117, 138]),
  commitDisputeVote: Uint8Array.from([210, 14, 34, 127, 75, 185, 189, 168]),
  revealDisputeVote: Uint8Array.from([211, 91, 1, 75, 154, 51, 233, 106]),
  executeDisputeOutcome: Uint8Array.from([158, 56, 238, 187, 219, 223, 212, 99]),
} as const;

function reservationIdSeed(reservationId: bigint): Uint8Array {
  return u64LE(reservationId);
}

export function liquidityVaultPda(merchant: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LIQUIDITY_VAULT_SEED, merchant.toBytes(), mint.toBytes()],
    ESCROW_PROGRAM_ID,
  );
}

export function liquidityVaultTokensPda(merchant: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LIQUIDITY_VAULT_TOKENS_SEED, merchant.toBytes(), mint.toBytes()],
    ESCROW_PROGRAM_ID,
  );
}

export function tradeEscrowPda(reservationId: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TRADE_ESCROW_SEED, reservationIdSeed(reservationId)],
    ESCROW_PROGRAM_ID,
  );
}

export function tradeEscrowTokensPda(reservationId: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TRADE_ESCROW_TOKENS_SEED, reservationIdSeed(reservationId)],
    ESCROW_PROGRAM_ID,
  );
}

export function feeConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([FEE_CONFIG_SEED], ESCROW_PROGRAM_ID);
}

export function disputeCasePda(reservationId: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DISPUTE_CASE_SEED, reservationIdSeed(reservationId)],
    ESCROW_PROGRAM_ID,
  );
}

/** Mirrors `escrow::instructions::initialize_fee_config::InitializeFeeConfigParams`'s field order exactly. */
export interface InitializeFeeConfigParams {
  adListingFee: bigint;
  disputeFilingFee: bigint;
  settlementFeeBps: number;
  devTreasury: PublicKey;
  ecosystemTreasury: PublicKey;
  infraTreasury: PublicKey;
  emergencyReserve: PublicKey;
  devTreasuryBps: number;
  ecosystemTreasuryBps: number;
  infraTreasuryBps: number;
  emergencyReserveBps: number;
  timeoutSecs: bigint;
}

export function initializeFeeConfigIx(admin: PublicKey, params: InitializeFeeConfigParams): TransactionInstruction {
  const [feeConfig] = feeConfigPda();
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(admin, true, true),
      meta(feeConfig, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: instructionData(
      DISCRIMINATORS.initializeFeeConfig,
      u64LE(params.adListingFee),
      u64LE(params.disputeFilingFee),
      u16LE(params.settlementFeeBps),
      params.devTreasury.toBytes(),
      params.ecosystemTreasury.toBytes(),
      params.infraTreasury.toBytes(),
      params.emergencyReserve.toBytes(),
      u16LE(params.devTreasuryBps),
      u16LE(params.ecosystemTreasuryBps),
      u16LE(params.infraTreasuryBps),
      u16LE(params.emergencyReserveBps),
      i64LE(params.timeoutSecs),
    ),
  });
}

/** Numeric half of `update_fee_config`; treasuries are accounts, not params. */
export interface UpdateFeeConfigParams {
  adListingFee: bigint;
  disputeFilingFee: bigint;
  settlementFeeBps: number;
  devTreasuryBps: number;
  ecosystemTreasuryBps: number;
  infraTreasuryBps: number;
  emergencyReserveBps: number;
  timeoutSecs: bigint;
}

/**
 * Corrects the singleton `FeeConfig` after initialization (admin-only).
 *
 * The treasuries are accounts here rather than params because the program
 * takes them as token accounts constrained to `mint` — a wallet address
 * cannot be stored where a token account is required. The devnet config was
 * originally initialized with owner wallets, which made `release_escrow`
 * unexecutable; this shape prevents that.
 */
export function updateFeeConfigIx(
  admin: PublicKey,
  mint: PublicKey,
  treasuries: {
    devTreasury: PublicKey;
    ecosystemTreasury: PublicKey;
    infraTreasury: PublicKey;
    emergencyReserve: PublicKey;
  },
  params: UpdateFeeConfigParams,
): TransactionInstruction {
  const [feeConfig] = feeConfigPda();
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(admin, true, false),
      meta(feeConfig, false, true),
      meta(mint, false, false),
      meta(treasuries.devTreasury, false, false),
      meta(treasuries.ecosystemTreasury, false, false),
      meta(treasuries.infraTreasury, false, false),
      meta(treasuries.emergencyReserve, false, false),
    ],
    data: instructionData(
      DISCRIMINATORS.updateFeeConfig,
      u64LE(params.adListingFee),
      u64LE(params.disputeFilingFee),
      u16LE(params.settlementFeeBps),
      u16LE(params.devTreasuryBps),
      u16LE(params.ecosystemTreasuryBps),
      u16LE(params.infraTreasuryBps),
      u16LE(params.emergencyReserveBps),
      i64LE(params.timeoutSecs),
    ),
  });
}

export function createLiquidityVaultIx(merchant: PublicKey, mint: PublicKey): TransactionInstruction {
  const [liquidityVault] = liquidityVaultPda(merchant, mint);
  const [tokenVault] = liquidityVaultTokensPda(merchant, mint);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(merchant, true, true),
      meta(mint, false, false),
      meta(liquidityVault, false, true),
      meta(tokenVault, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
      meta(RENT_SYSVAR_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.createLiquidityVault),
  });
}

export function depositLiquidityIx(
  merchant: PublicKey,
  mint: PublicKey,
  from: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const [liquidityVault] = liquidityVaultPda(merchant, mint);
  const [tokenVault] = liquidityVaultTokensPda(merchant, mint);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(merchant, true, false),
      meta(liquidityVault, false, true),
      meta(tokenVault, false, true),
      meta(from, false, true),
      meta(mint, false, false),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.depositLiquidity, u64LE(amount)),
  });
}

export function reserveLiquidityIx(merchant: PublicKey, mint: PublicKey, amount: bigint): TransactionInstruction {
  const [liquidityVault] = liquidityVaultPda(merchant, mint);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [meta(merchant, true, false), meta(liquidityVault, false, true)],
    data: instructionData(DISCRIMINATORS.reserveLiquidity, u64LE(amount)),
  });
}

export function withdrawLiquidityIx(
  merchant: PublicKey,
  mint: PublicKey,
  to: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const [liquidityVault] = liquidityVaultPda(merchant, mint);
  const [tokenVault] = liquidityVaultTokensPda(merchant, mint);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(merchant, true, false),
      meta(liquidityVault, false, true),
      meta(tokenVault, false, true),
      meta(to, false, true),
      meta(mint, false, false),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.withdrawLiquidity, u64LE(amount)),
  });
}

export function createTradeEscrowIx(
  merchant: PublicKey,
  buyer: PublicKey,
  mint: PublicKey,
  reservationId: bigint,
  amount: bigint,
  timeoutSecs: bigint,
): TransactionInstruction {
  const [liquidityVault] = liquidityVaultPda(merchant, mint);
  const [tradeEscrow] = tradeEscrowPda(reservationId);
  const [tokenVault] = tradeEscrowTokensPda(reservationId);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(merchant, true, true),
      meta(buyer, false, false),
      meta(mint, false, false),
      meta(liquidityVault, false, true),
      meta(tradeEscrow, false, true),
      meta(tokenVault, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
      meta(RENT_SYSVAR_ID, false, false),
    ],
    data: instructionData(
      DISCRIMINATORS.createTradeEscrow,
      u64LE(reservationId),
      u64LE(amount),
      i64LE(timeoutSecs),
    ),
  });
}

export function fundTradeEscrowIx(merchant: PublicKey, mint: PublicKey, reservationId: bigint): TransactionInstruction {
  const [liquidityVault] = liquidityVaultPda(merchant, mint);
  const [liquidityTokenVault] = liquidityVaultTokensPda(merchant, mint);
  const [tradeEscrow] = tradeEscrowPda(reservationId);
  const [tradeEscrowTokenVault] = tradeEscrowTokensPda(reservationId);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(merchant, true, false),
      meta(mint, false, false),
      meta(liquidityVault, false, true),
      meta(liquidityTokenVault, false, true),
      meta(tradeEscrow, false, true),
      meta(tradeEscrowTokenVault, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.fundTradeEscrow),
  });
}

export function approveSettlementIx(merchant: PublicKey, reservationId: bigint): TransactionInstruction {
  const [tradeEscrow] = tradeEscrowPda(reservationId);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [meta(merchant, true, false), meta(tradeEscrow, false, true)],
    data: instructionData(DISCRIMINATORS.approveSettlement),
  });
}

/** Shared by `releaseEscrowIx` and `executeDisputeOutcomeIx` — both move funds identically once a release is authorized. */
export interface ReleaseDestinations {
  buyerTokenAccount: PublicKey;
  devTreasury: PublicKey;
  ecosystemTreasury: PublicKey;
  infraTreasury: PublicKey;
  emergencyReserve: PublicKey;
}

export function releaseEscrowIx(
  mint: PublicKey,
  seller: PublicKey,
  reservationId: bigint,
  destinations: ReleaseDestinations,
): TransactionInstruction {
  const [liquidityVault] = liquidityVaultPda(seller, mint);
  const [tradeEscrow] = tradeEscrowPda(reservationId);
  const [tradeEscrowTokenVault] = tradeEscrowTokensPda(reservationId);
  const [feeConfig] = feeConfigPda();
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(mint, false, false),
      meta(liquidityVault, false, true),
      meta(tradeEscrow, false, true),
      meta(tradeEscrowTokenVault, false, true),
      meta(destinations.buyerTokenAccount, false, true),
      meta(feeConfig, false, false),
      meta(destinations.devTreasury, false, true),
      meta(destinations.ecosystemTreasury, false, true),
      meta(destinations.infraTreasury, false, true),
      meta(destinations.emergencyReserve, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.releaseEscrow),
  });
}

export function cancelReservationIx(
  signer: PublicKey,
  mint: PublicKey,
  seller: PublicKey,
  reservationId: bigint,
): TransactionInstruction {
  const [liquidityVault] = liquidityVaultPda(seller, mint);
  const [tradeEscrow] = tradeEscrowPda(reservationId);
  const [tradeEscrowTokenVault] = tradeEscrowTokensPda(reservationId);
  const [liquidityTokenVault] = liquidityVaultTokensPda(seller, mint);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(signer, true, false),
      meta(mint, false, false),
      meta(liquidityVault, false, true),
      meta(tradeEscrow, false, true),
      meta(tradeEscrowTokenVault, false, true),
      meta(liquidityTokenVault, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.cancelReservation),
  });
}

/** Permissionless once `trade_escrow.timeout_at` has passed — no signer required. */
export function expireReservationIx(mint: PublicKey, seller: PublicKey, reservationId: bigint): TransactionInstruction {
  const [liquidityVault] = liquidityVaultPda(seller, mint);
  const [tradeEscrow] = tradeEscrowPda(reservationId);
  const [tradeEscrowTokenVault] = tradeEscrowTokensPda(reservationId);
  const [liquidityTokenVault] = liquidityVaultTokensPda(seller, mint);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(mint, false, false),
      meta(liquidityVault, false, true),
      meta(tradeEscrow, false, true),
      meta(tradeEscrowTokenVault, false, true),
      meta(liquidityTokenVault, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.expireReservation),
  });
}

export function openDisputeCaseIx(
  signer: PublicKey,
  payer: PublicKey,
  reservationId: bigint,
  commitWindowSecs: bigint,
  revealWindowSecs: bigint,
): TransactionInstruction {
  const [tradeEscrow] = tradeEscrowPda(reservationId);
  const [disputeCase] = disputeCasePda(reservationId);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(signer, true, false),
      meta(payer, true, true),
      meta(tradeEscrow, false, true),
      meta(disputeCase, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: instructionData(DISCRIMINATORS.openDisputeCase, i64LE(commitWindowSecs), i64LE(revealWindowSecs)),
  });
}

export function commitDisputeVoteIx(
  arbitrator: PublicKey,
  reservationId: bigint,
  commitment: Uint8Array,
): TransactionInstruction {
  const [disputeCase] = disputeCasePda(reservationId);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [meta(arbitrator, true, false), meta(disputeCase, false, true)],
    data: instructionData(DISCRIMINATORS.commitDisputeVote, fixedBytes(commitment, 32)),
  });
}

export function revealDisputeVoteIx(
  arbitrator: PublicKey,
  reservationId: bigint,
  outcome: DisputeOutcome,
  salt: Uint8Array,
  arbitratorStake: PublicKey,
): TransactionInstruction {
  const [disputeCase] = disputeCasePda(reservationId);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(arbitrator, true, false),
      meta(disputeCase, false, true),
      meta(arbitratorStake, false, false),
    ],
    data: instructionData(DISCRIMINATORS.revealDisputeVote, enumTag(outcome), fixedBytes(salt, 32)),
  });
}

export function executeDisputeOutcomeIx(
  mint: PublicKey,
  seller: PublicKey,
  reservationId: bigint,
  destinations: ReleaseDestinations,
): TransactionInstruction {
  const [disputeCase] = disputeCasePda(reservationId);
  const [tradeEscrow] = tradeEscrowPda(reservationId);
  const [tradeEscrowTokenVault] = tradeEscrowTokensPda(reservationId);
  const [liquidityVault] = liquidityVaultPda(seller, mint);
  const [liquidityTokenVault] = liquidityVaultTokensPda(seller, mint);
  const [feeConfig] = feeConfigPda();
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(mint, false, false),
      meta(disputeCase, false, true),
      meta(tradeEscrow, false, true),
      meta(tradeEscrowTokenVault, false, true),
      meta(liquidityVault, false, true),
      meta(liquidityTokenVault, false, true),
      meta(destinations.buyerTokenAccount, false, true),
      meta(feeConfig, false, false),
      meta(destinations.devTreasury, false, true),
      meta(destinations.ecosystemTreasury, false, true),
      meta(destinations.infraTreasury, false, true),
      meta(destinations.emergencyReserve, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.executeDisputeOutcome),
  });
}
