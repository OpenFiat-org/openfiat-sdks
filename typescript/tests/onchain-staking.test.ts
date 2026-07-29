import { PublicKey, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  claimRewardsIx,
  fundRewardsVaultIx,
  updateStakingConfigIx,
  distributeRewardIx,
  initializeStakeAccountIx,
  initializeStakingConfigIx,
  requestUnstakeIx,
  rewardsVaultPda,
  slashIx,
  stakeAccountPda,
  stakeIx,
  stakeVaultPda,
  stakingConfigPda,
  withdrawUnstakedIx,
} from "../src/onchain/staking.js";
import { RENT_SYSVAR_ID, Role, STAKING_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "../src/onchain/constants.js";
import { expectAccounts, expectDiscriminator, fakePubkey } from "./onchain-helpers.js";

const owner = fakePubkey(1);
const mint = fakePubkey(2);

describe("staking PDAs", () => {
  it("stakingConfigPda is a singleton", () => {
    const [pda] = stakingConfigPda();
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from("staking_config")], STAKING_PROGRAM_ID);
    expect(pda.equals(expected)).toBe(true);
  });

  it("stakeAccountPda is keyed by (owner, role)", () => {
    const [pda] = stakeAccountPda(owner, Role.Arbitrator);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), owner.toBytes(), Uint8Array.of(Role.Arbitrator)],
      STAKING_PROGRAM_ID,
    );
    expect(pda.equals(expected)).toBe(true);
  });

  it("different roles for the same owner derive different accounts", () => {
    const [merchantStake] = stakeAccountPda(owner, Role.Merchant);
    const [arbitratorStake] = stakeAccountPda(owner, Role.Arbitrator);
    expect(merchantStake.equals(arbitratorStake)).toBe(false);
  });
});

describe("staking instructions", () => {
  it("initializeStakingConfigIx", () => {
    const admin = fakePubkey(10);
    const ix = initializeStakingConfigIx(admin, mint, {
      minStakeByRole: [1_000n, 5_000n, 1_000n, 5_000n, 1_000n, 1_000n, 1_000n],
      unbondingPeriodSecs: 604_800n,
      slashBps: 500,
      slashingAuthority: fakePubkey(11),
      slashDestination: fakePubkey(12),
      rewardsAuthority: fakePubkey(13),
    });
    expectDiscriminator(ix, [78, 164, 6, 115, 206, 48, 168, 105]);
    const [stakingConfig] = stakingConfigPda();
    const [stakeVault] = stakeVaultPda();
    const [rewardsVault] = rewardsVaultPda();
    expectAccounts(ix, [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: stakingConfig, isSigner: false, isWritable: true },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: rewardsVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR_ID, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.readBigUInt64LE(8)).toBe(1_000n);
    expect(ix.data.readBigUInt64LE(16)).toBe(5_000n);
  });

  it("initializeStakeAccountIx", () => {
    const ix = initializeStakeAccountIx(owner, Role.NodeOperator);
    expectDiscriminator(ix, [184, 7, 155, 82, 149, 217, 185, 196]);
    const [stakeAccount] = stakeAccountPda(owner, Role.NodeOperator);
    expectAccounts(ix, [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: stakeAccount, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
    expect(ix.data[8]).toBe(Role.NodeOperator);
  });

  it("stakeIx", () => {
    const from = fakePubkey(20);
    const ix = stakeIx(owner, mint, Role.Merchant, from, 2_500n);
    expectDiscriminator(ix, [206, 176, 202, 18, 200, 209, 179, 108]);
    const [stakingConfig] = stakingConfigPda();
    const [stakeAccount] = stakeAccountPda(owner, Role.Merchant);
    const [stakeVault] = stakeVaultPda();
    expectAccounts(ix, [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: stakingConfig, isSigner: false, isWritable: false },
      { pubkey: stakeAccount, isSigner: false, isWritable: true },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: from, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.readBigUInt64LE(8)).toBe(2_500n);
  });

  it("requestUnstakeIx", () => {
    const ix = requestUnstakeIx(owner, Role.Merchant, 1_000n);
    expectDiscriminator(ix, [44, 154, 110, 253, 160, 202, 54, 34]);
    const [stakingConfig] = stakingConfigPda();
    const [stakeAccount] = stakeAccountPda(owner, Role.Merchant);
    expectAccounts(ix, [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: stakingConfig, isSigner: false, isWritable: false },
      { pubkey: stakeAccount, isSigner: false, isWritable: true },
    ]);
  });

  it("withdrawUnstakedIx", () => {
    const to = fakePubkey(21);
    const ix = withdrawUnstakedIx(owner, mint, Role.Merchant, to);
    expectDiscriminator(ix, [19, 202, 68, 255, 216, 40, 205, 61]);
    const [stakingConfig] = stakingConfigPda();
    const [stakeAccount] = stakeAccountPda(owner, Role.Merchant);
    const [stakeVault] = stakeVaultPda();
    expectAccounts(ix, [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: stakingConfig, isSigner: false, isWritable: false },
      { pubkey: stakeAccount, isSigner: false, isWritable: true },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("slashIx", () => {
    const slashingAuthority = fakePubkey(30);
    const destination = fakePubkey(31);
    const ix = slashIx(slashingAuthority, mint, owner, Role.Arbitrator, destination, 7);
    expectDiscriminator(ix, [204, 141, 18, 161, 8, 177, 92, 142]);
    const [stakingConfig] = stakingConfigPda();
    const [stakeAccount] = stakeAccountPda(owner, Role.Arbitrator);
    const [stakeVault] = stakeVaultPda();
    expectAccounts(ix, [
      { pubkey: slashingAuthority, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: stakingConfig, isSigner: false, isWritable: false },
      { pubkey: stakeAccount, isSigner: false, isWritable: true },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.readUInt16LE(8)).toBe(7);
  });

  it("distributeRewardIx", () => {
    const rewardsAuthority = fakePubkey(40);
    const ix = distributeRewardIx(rewardsAuthority, owner, Role.NodeOperator, 999n);
    expectDiscriminator(ix, [135, 65, 136, 143, 108, 234, 198, 46]);
    const [stakingConfig] = stakingConfigPda();
    const [stakeAccount] = stakeAccountPda(owner, Role.NodeOperator);
    expectAccounts(ix, [
      { pubkey: rewardsAuthority, isSigner: true, isWritable: false },
      { pubkey: stakingConfig, isSigner: false, isWritable: false },
      { pubkey: stakeAccount, isSigner: false, isWritable: true },
    ]);
    expect(ix.data.readBigUInt64LE(8)).toBe(999n);
  });

  it("claimRewardsIx", () => {
    const to = fakePubkey(41);
    const ix = claimRewardsIx(owner, mint, Role.NodeOperator, to);
    expectDiscriminator(ix, [4, 144, 132, 71, 116, 23, 151, 80]);
    const [stakingConfig] = stakingConfigPda();
    const [stakeAccount] = stakeAccountPda(owner, Role.NodeOperator);
    const [rewardsVault] = rewardsVaultPda();
    expectAccounts(ix, [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: stakingConfig, isSigner: false, isWritable: false },
      { pubkey: stakeAccount, isSigner: false, isWritable: true },
      { pubkey: rewardsVault, isSigner: false, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("fundRewardsVaultIx is permissionless — the funder is the only signer", () => {
    // Gating this on admin would mean re-issuing authority every time a
    // funding source changed, and the only thing it can do is increase a
    // pool that pays stakers. Draining stays gated behind claim_rewards.
    const funder = fakePubkey(60);
    const from = fakePubkey(61);
    const ix = fundRewardsVaultIx(funder, mint, from, 250_000n);
    expectDiscriminator(ix, [157, 74, 89, 172, 187, 7, 119, 161]);
    expectAccounts(ix, [
      { pubkey: funder, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: stakingConfigPda()[0], isSigner: false, isWritable: false },
      { pubkey: rewardsVaultPda()[0], isSigner: false, isWritable: true },
      { pubkey: from, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
    expect(Array.from(ix.data.subarray(8, 16))).toEqual([0x90, 0xd0, 0x03, 0, 0, 0, 0, 0]);
  });

  it("updateStakingConfigIx takes the slash destination as an account, not a key", () => {
    // The deployed config stored a *wallet* as slash_destination, which
    // made every slash unexecutable: the program requires that key to
    // deserialize as a token account. Passing the account is what lets the
    // runtime reject the mistake rather than store it, so the account list
    // is the substance of this instruction and worth pinning.
    const admin = fakePubkey(70);
    const slashDestination = fakePubkey(71);
    const slashingAuthority = fakePubkey(72);
    const rewardsAuthority = fakePubkey(73);
    const ix = updateStakingConfigIx(admin, mint, slashDestination, {
      minStakeByRole: [1n, 2n, 3n, 4n, 5n, 6n, 7n],
      unbondingPeriodSecs: 604_800n,
      slashBps: 1_000,
      slashingAuthority,
      rewardsAuthority,
    });
    expectDiscriminator(ix, [214, 238, 91, 123, 207, 114, 9, 246]);
    expectAccounts(ix, [
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: stakingConfigPda()[0], isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: slashDestination, isSigner: false, isWritable: false },
    ]);
    // Authorities are trailing keys in the payload: 7 role minimums, an
    // i64 and a u16 precede them.
    const authoritiesAt = 8 + 7 * 8 + 8 + 2;
    expect(Array.from(ix.data.subarray(authoritiesAt, authoritiesAt + 32))).toEqual(
      Array.from(slashingAuthority.toBytes()),
    );
    expect(Array.from(ix.data.subarray(authoritiesAt + 32, authoritiesAt + 64))).toEqual(
      Array.from(rewardsAuthority.toBytes()),
    );
  });
});
