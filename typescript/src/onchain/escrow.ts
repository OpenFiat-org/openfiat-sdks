import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { enumTag, fixedBytes, i64LE, instructionData, meta, u16LE, u32LE, u64LE } from "./codec.js";
import {
  banRecordPda,
  ESCROW_PROGRAM_ID,
  RENT_SYSVAR_ID,
  Role,
  SLOT_HASHES_SYSVAR_ID,
  TOKEN_2022_PROGRAM_ID,
} from "./constants.js";
import type { DisputeOutcome } from "./constants.js";
import { stakeAccountPda, stakingConfigPda } from "./staking.js";

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
const ARBITRATION_POOL_SEED = Buffer.from("arbitration_pool");

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
  initializeArbitrationPool: Uint8Array.from([77, 223, 22, 51, 66, 236, 5, 90]),
  chargeAdListingFee: Uint8Array.from([200, 39, 46, 240, 232, 173, 134, 196]),
  claimArbitrationReward: Uint8Array.from([20, 88, 236, 69, 233, 200, 195, 238]),
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

/**
 * The single arbitration pool holding OPEN dispute deposits. Deposits in
 * it are owed either back to a merchant or forward to arbitrators, so its
 * authority is the `FeeConfig` PDA — only the program moves what it holds.
 */
export function arbitrationPoolPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ARBITRATION_POOL_SEED], ESCROW_PROGRAM_ID);
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
  /**
   * Arbitrator stake age in seconds; `0n` disables the gate. This
   * instruction is the only path by which OFS-4100 §4's 30 days is turned
   * on — both eligibility gates deploy disabled, because neither can be
   * satisfied by anybody on a chain younger than the requirement it
   * imposes.
   */
  minArbitratorStakeAgeSecs: bigint;
  /**
   * The complete settlement-mint allowlist, replacing whatever is stored —
   * a replacement rather than an append, so this is also the only way to
   * de-list. At most 16 entries, never empty, no duplicates and no default
   * pubkey: an empty list would refuse every trade, which is pausing the
   * protocol rather than setting a fee.
   */
  settlementMints: PublicKey[];
  /**
   * Opening sortition threshold in basis points; `0` disables the draw.
   * Must be below 10_000 — the program rejects a value that would admit
   * every wallet rather than accepting "disabled" written unclearly.
   */
  arbitratorSortitionBps: number;
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
      // Appended last, matching declaration order in the program's own
      // params struct — Borsh has no field names, so order is the format.
      i64LE(params.minArbitratorStakeAgeSecs),
      u16LE(params.arbitratorSortitionBps),
      // Borsh `Vec<Pubkey>`: a u32 little-endian length, then the raw
      // 32-byte keys.
      u32LE(params.settlementMints.length),
      ...params.settlementMints.map((m) => m.toBytes()),
    ),
  });
}

/**
 * Creates a merchant's vault for one mint.
 *
 * `feeConfig` carries the settlement-mint allowlist, and `arbitrationPool`
 * is how the program recognises the OPEN mint — OPEN is not an allowlisted
 * settlement mint, so a merchant's OPEN vault (the one that funds the
 * ad-listing fee and the arbitration deposit) is only creatable through
 * that carve-out. Both are seeds-derived singletons, so neither is a
 * parameter; both must nonetheless be in the account list, and
 * `initialize_arbitration_pool` must have run on the cluster first.
 */
export function createLiquidityVaultIx(merchant: PublicKey, mint: PublicKey): TransactionInstruction {
  const [feeConfig] = feeConfigPda();
  const [arbitrationPool] = arbitrationPoolPda();
  const [liquidityVault] = liquidityVaultPda(merchant, mint);
  const [tokenVault] = liquidityVaultTokensPda(merchant, mint);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(merchant, true, true),
      meta(mint, false, false),
      meta(feeConfig, false, false),
      meta(arbitrationPool, false, false),
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
      meta(banRecordPda(merchant)[0], false, false),
      meta(liquidityVault, false, true),
      meta(tokenVault, false, true),
      meta(from, false, true),
      meta(mint, false, false),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.depositLiquidity, u64LE(amount)),
  });
}

/**
 * Marking-only — no token movement.
 *
 * `feeConfig` is read for the settlement-mint allowlist: a reservation is
 * where new exposure to a mint starts, so a de-listed mint is refused here
 * while everything already deposited stays withdrawable.
 */
export function reserveLiquidityIx(merchant: PublicKey, mint: PublicKey, amount: bigint): TransactionInstruction {
  const [liquidityVault] = liquidityVaultPda(merchant, mint);
  const [feeConfig] = feeConfigPda();
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(merchant, true, false),
      meta(liquidityVault, false, true),
      meta(feeConfig, false, false),
    ],
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
  const [feeConfig] = feeConfigPda();
  const [tradeEscrow] = tradeEscrowPda(reservationId);
  const [tokenVault] = tradeEscrowTokensPda(reservationId);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(merchant, true, true),
      meta(buyer, false, false),
      meta(mint, false, false),
      meta(feeConfig, false, false),
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

/**
 * Opens the on-chain case. The arbitration deposit is debited from the
 * *merchant's* OPEN liquidity vault whoever opened the dispute — a buyer
 * is often a one-time participant and must face no cost barrier to being
 * heard (OFS-4100 §9.3). `merchant` is therefore the trade's seller, not
 * the caller, and `depositMint` is OPEN rather than the settlement
 * stablecoin.
 *
 * If the merchant's vault cannot cover the deposit the case still opens
 * with whatever was there; requiring the full amount would let a merchant
 * make themselves undisputable by keeping that vault empty.
 */
export function openDisputeCaseIx(
  signer: PublicKey,
  payer: PublicKey,
  reservationId: bigint,
  commitWindowSecs: bigint,
  revealWindowSecs: bigint,
  merchant: PublicKey,
  depositMint: PublicKey,
): TransactionInstruction {
  const [tradeEscrow] = tradeEscrowPda(reservationId);
  const [disputeCase] = disputeCasePda(reservationId);
  const [feeConfig] = feeConfigPda();
  const [merchantOpenVault] = liquidityVaultPda(merchant, depositMint);
  const [merchantOpenTokenVault] = liquidityVaultTokensPda(merchant, depositMint);
  const [arbitrationPool] = arbitrationPoolPda();
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(signer, true, false),
      meta(payer, true, true),
      meta(tradeEscrow, false, true),
      meta(disputeCase, false, true),
      meta(feeConfig, false, false),
      meta(depositMint, false, false),
      meta(merchantOpenVault, false, true),
      meta(merchantOpenTokenVault, false, true),
      meta(arbitrationPool, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
      meta(SLOT_HASHES_SYSVAR_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.openDisputeCase, i64LE(commitWindowSecs), i64LE(revealWindowSecs)),
  });
}

/**
 * Committing is gated on three things (OFS-4100 §4, §4.1): the Arbitrator
 * role's minimum stake, the age of that stake, and a per-case sortition
 * draw. The program reads the staking config and the caller's own stake
 * account for the first two, and the escrow `FeeConfig` — which holds both
 * eligibility parameters, so governance can retune them without a redeploy
 * — for the age threshold and the draw. All are PDAs, so they are derived
 * here rather than asked for.
 */
export function commitDisputeVoteIx(
  arbitrator: PublicKey,
  reservationId: bigint,
  commitment: Uint8Array,
): TransactionInstruction {
  const [disputeCase] = disputeCasePda(reservationId);
  const [stakingConfig] = stakingConfigPda();
  const [arbitratorStake] = stakeAccountPda(arbitrator, Role.Arbitrator);
  const [feeConfig] = feeConfigPda();
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(arbitrator, true, false),
      meta(disputeCase, false, true),
      meta(stakingConfig, false, false),
      meta(arbitratorStake, false, false),
      meta(feeConfig, false, false),
    ],
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
  const [stakingConfig] = stakingConfigPda();
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(arbitrator, true, false),
      meta(disputeCase, false, true),
      meta(stakingConfig, false, false),
      meta(arbitratorStake, false, false),
    ],
    data: instructionData(DISCRIMINATORS.revealDisputeVote, enumTag(outcome), fixedBytes(salt, 32)),
  });
}

/**
 * Tallies the case and moves the escrow. `depositMint` is OPEN — the
 * arbitration deposit's denomination — and is distinct from `mint`, the
 * settlement stablecoin.
 *
 * The program rejects a deposit vault that aliases the settlement vault,
 * which is what happens when a trade settles in OPEN: Anchor would
 * deserialize one account into two structs and write back only one,
 * silently losing a balance update.
 */
export function executeDisputeOutcomeIx(
  mint: PublicKey,
  seller: PublicKey,
  reservationId: bigint,
  destinations: ReleaseDestinations,
  depositMint: PublicKey,
): TransactionInstruction {
  const [disputeCase] = disputeCasePda(reservationId);
  const [tradeEscrow] = tradeEscrowPda(reservationId);
  const [tradeEscrowTokenVault] = tradeEscrowTokensPda(reservationId);
  const [liquidityVault] = liquidityVaultPda(seller, mint);
  const [liquidityTokenVault] = liquidityVaultTokensPda(seller, mint);
  const [feeConfig] = feeConfigPda();
  const [arbitrationPool] = arbitrationPoolPda();
  const [merchantOpenVault] = liquidityVaultPda(seller, depositMint);
  const [merchantOpenTokenVault] = liquidityVaultTokensPda(seller, depositMint);
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
      meta(depositMint, false, false),
      meta(arbitrationPool, false, true),
      meta(merchantOpenVault, false, true),
      meta(merchantOpenTokenVault, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
      // Passed even though a round that decides never touches it: a round
      // that falls short re-draws the case seed, and Anchor's account list
      // is fixed per instruction rather than per branch.
      meta(SLOT_HASHES_SYSVAR_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.executeDisputeOutcome),
  });
}

/** Creates the arbitration pool. Admin-only, once per deployment. */
export function initializeArbitrationPoolIx(admin: PublicKey, mint: PublicKey): TransactionInstruction {
  const [feeConfig] = feeConfigPda();
  const [arbitrationPool] = arbitrationPoolPda();
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(admin, true, true),
      meta(feeConfig, false, false),
      meta(mint, false, false),
      meta(arbitrationPool, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
    ],
    data: instructionData(DISCRIMINATORS.initializeArbitrationPool),
  });
}

/**
 * Bills the merchant's OPEN vault for one advertisement listing.
 *
 * Advertisements are off-chain gossip records, so there is no on-chain
 * listing to bill against — the merchant is the on-chain anchor and their
 * liquidity vault is the source. `advertisementId` is recorded in the
 * emitted event only, as a join key for indexers; the program stores no
 * per-advertisement state.
 */
export function chargeAdListingFeeIx(
  merchant: PublicKey,
  mint: PublicKey,
  devTreasury: PublicKey,
  ecosystemTreasury: PublicKey,
  infraTreasury: PublicKey,
  emergencyReserve: PublicKey,
  advertisementId: Uint8Array,
): TransactionInstruction {
  const [feeConfig] = feeConfigPda();
  const [liquidityVault] = liquidityVaultPda(merchant, mint);
  const [tokenVault] = liquidityVaultTokensPda(merchant, mint);
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(merchant, true, false),
      meta(feeConfig, false, false),
      meta(liquidityVault, false, true),
      meta(tokenVault, false, true),
      meta(devTreasury, false, true),
      meta(ecosystemTreasury, false, true),
      meta(infraTreasury, false, true),
      meta(emergencyReserve, false, true),
      meta(mint, false, false),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.chargeAdListingFee, fixedBytes(advertisementId, 32)),
  });
}

/**
 * Claims an arbitrator's pro-rata share of a resolved case's deposit.
 *
 * Pull rather than push: pushing would put up to seven unknown token
 * accounts on `execute_dispute_outcome`, where one closed account would
 * fail the whole resolution and leave an escrow frozen because a *payout*
 * failed.
 */
export function claimArbitrationRewardIx(
  arbitrator: PublicKey,
  reservationId: bigint,
  depositMint: PublicKey,
  to: PublicKey,
): TransactionInstruction {
  const [disputeCase] = disputeCasePda(reservationId);
  const [feeConfig] = feeConfigPda();
  const [arbitrationPool] = arbitrationPoolPda();
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      meta(arbitrator, true, false),
      meta(disputeCase, false, true),
      meta(feeConfig, false, false),
      meta(depositMint, false, false),
      meta(arbitrationPool, false, true),
      meta(to, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.claimArbitrationReward),
  });
}
