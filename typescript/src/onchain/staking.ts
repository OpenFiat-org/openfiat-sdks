import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { enumTag, i64LE, instructionData, meta, u16LE, u64LE } from "./codec.js";
import { RENT_SYSVAR_ID, ROLE_COUNT, STAKING_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants.js";
import type { Role } from "./constants.js";

/**
 * PDA seeds for `openfiat-staking` (OFS-4200 §5) — taken directly from
 * `openfiat-core/programs/programs/staking/src/constants.rs`.
 */
const STAKING_CONFIG_SEED = Buffer.from("staking_config");
const STAKE_VAULT_SEED = Buffer.from("stake_vault");
const REWARDS_VAULT_SEED = Buffer.from("rewards_vault");
const STAKE_ACCOUNT_SEED = Buffer.from("stake");

const DISCRIMINATORS = {
  initializeStakingConfig: Uint8Array.from([78, 164, 6, 115, 206, 48, 168, 105]),
  initializeStakeAccount: Uint8Array.from([184, 7, 155, 82, 149, 217, 185, 196]),
  stake: Uint8Array.from([206, 176, 202, 18, 200, 209, 179, 108]),
  requestUnstake: Uint8Array.from([44, 154, 110, 253, 160, 202, 54, 34]),
  withdrawUnstaked: Uint8Array.from([19, 202, 68, 255, 216, 40, 205, 61]),
  slash: Uint8Array.from([204, 141, 18, 161, 8, 177, 92, 142]),
  distributeReward: Uint8Array.from([135, 65, 136, 143, 108, 234, 198, 46]),
  claimRewards: Uint8Array.from([4, 144, 132, 71, 116, 23, 151, 80]),
} as const;

export function stakingConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([STAKING_CONFIG_SEED], STAKING_PROGRAM_ID);
}

export function stakeVaultPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([STAKE_VAULT_SEED], STAKING_PROGRAM_ID);
}

export function rewardsVaultPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([REWARDS_VAULT_SEED], STAKING_PROGRAM_ID);
}

/** `[STAKE_ACCOUNT_SEED, owner, role_as_u8]` (OFS-4200 §5) — one wallet may hold independent stakes per role. */
export function stakeAccountPda(owner: PublicKey, role: Role): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STAKE_ACCOUNT_SEED, owner.toBytes(), enumTag(role)],
    STAKING_PROGRAM_ID,
  );
}

/** Mirrors `staking::instructions::initialize_staking_config::InitializeStakingConfigParams`'s field order exactly. */
export interface InitializeStakingConfigParams {
  /** Indexed by `Role`; must have exactly ROLE_COUNT entries. */
  minStakeByRole: bigint[];
  unbondingPeriodSecs: bigint;
  slashBps: number;
  slashingAuthority: PublicKey;
  slashDestination: PublicKey;
  rewardsAuthority: PublicKey;
}

/** Borsh encodes a fixed-size array as its elements back to back, with no
 *  length prefix — so a wrong-length array here would silently shift every
 *  field after it rather than failing. */
function minStakeByRoleBytes(minStakeByRole: bigint[]): Uint8Array[] {
  if (minStakeByRole.length !== ROLE_COUNT) {
    throw new Error(
      `minStakeByRole must have exactly ${ROLE_COUNT} entries, got ${minStakeByRole.length}`,
    );
  }
  return minStakeByRole.map(u64LE);
}

export function initializeStakingConfigIx(
  admin: PublicKey,
  mint: PublicKey,
  params: InitializeStakingConfigParams,
): TransactionInstruction {
  const [stakingConfig] = stakingConfigPda();
  const [stakeVault] = stakeVaultPda();
  const [rewardsVault] = rewardsVaultPda();
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      meta(admin, true, true),
      meta(mint, false, false),
      meta(stakingConfig, false, true),
      meta(stakeVault, false, true),
      meta(rewardsVault, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
      meta(RENT_SYSVAR_ID, false, false),
    ],
    data: instructionData(
      DISCRIMINATORS.initializeStakingConfig,
      ...minStakeByRoleBytes(params.minStakeByRole),
      i64LE(params.unbondingPeriodSecs),
      u16LE(params.slashBps),
      params.slashingAuthority.toBytes(),
      params.slashDestination.toBytes(),
      params.rewardsAuthority.toBytes(),
    ),
  });
}

export function initializeStakeAccountIx(owner: PublicKey, role: Role): TransactionInstruction {
  const [stakeAccount] = stakeAccountPda(owner, role);
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      meta(owner, true, true),
      meta(stakeAccount, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: instructionData(DISCRIMINATORS.initializeStakeAccount, enumTag(role)),
  });
}

export function stakeIx(
  owner: PublicKey,
  mint: PublicKey,
  role: Role,
  from: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const [stakingConfig] = stakingConfigPda();
  const [stakeAccount] = stakeAccountPda(owner, role);
  const [stakeVault] = stakeVaultPda();
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      meta(owner, true, false),
      meta(stakingConfig, false, false),
      meta(stakeAccount, false, true),
      meta(stakeVault, false, true),
      meta(from, false, true),
      meta(mint, false, false),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.stake, u64LE(amount)),
  });
}

export function requestUnstakeIx(owner: PublicKey, role: Role, amount: bigint): TransactionInstruction {
  const [stakingConfig] = stakingConfigPda();
  const [stakeAccount] = stakeAccountPda(owner, role);
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      meta(owner, true, false),
      meta(stakingConfig, false, false),
      meta(stakeAccount, false, true),
    ],
    data: instructionData(DISCRIMINATORS.requestUnstake, u64LE(amount)),
  });
}

export function withdrawUnstakedIx(
  owner: PublicKey,
  mint: PublicKey,
  role: Role,
  to: PublicKey,
): TransactionInstruction {
  const [stakingConfig] = stakingConfigPda();
  const [stakeAccount] = stakeAccountPda(owner, role);
  const [stakeVault] = stakeVaultPda();
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      meta(owner, true, false),
      meta(mint, false, false),
      meta(stakingConfig, false, false),
      meta(stakeAccount, false, true),
      meta(stakeVault, false, true),
      meta(to, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.withdrawUnstaked),
  });
}

export function slashIx(
  slashingAuthority: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  role: Role,
  destination: PublicKey,
  misconductCode: number,
): TransactionInstruction {
  const [stakingConfig] = stakingConfigPda();
  const [stakeAccount] = stakeAccountPda(owner, role);
  const [stakeVault] = stakeVaultPda();
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      meta(slashingAuthority, true, false),
      meta(mint, false, false),
      meta(stakingConfig, false, false),
      meta(stakeAccount, false, true),
      meta(stakeVault, false, true),
      meta(destination, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.slash, u16LE(misconductCode)),
  });
}

export function distributeRewardIx(
  rewardsAuthority: PublicKey,
  owner: PublicKey,
  role: Role,
  amount: bigint,
): TransactionInstruction {
  const [stakingConfig] = stakingConfigPda();
  const [stakeAccount] = stakeAccountPda(owner, role);
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      meta(rewardsAuthority, true, false),
      meta(stakingConfig, false, false),
      meta(stakeAccount, false, true),
    ],
    data: instructionData(DISCRIMINATORS.distributeReward, u64LE(amount)),
  });
}

export function claimRewardsIx(
  owner: PublicKey,
  mint: PublicKey,
  role: Role,
  to: PublicKey,
): TransactionInstruction {
  const [stakingConfig] = stakingConfigPda();
  const [stakeAccount] = stakeAccountPda(owner, role);
  const [rewardsVault] = rewardsVaultPda();
  return new TransactionInstruction({
    programId: STAKING_PROGRAM_ID,
    keys: [
      meta(owner, true, false),
      meta(mint, false, false),
      meta(stakingConfig, false, false),
      meta(stakeAccount, false, true),
      meta(rewardsVault, false, true),
      meta(to, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.claimRewards),
  });
}
