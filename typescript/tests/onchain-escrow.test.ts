import { PublicKey, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  approveSettlementIx,
  cancelReservationIx,
  commitDisputeVoteIx,
  createLiquidityVaultIx,
  createTradeEscrowIx,
  depositLiquidityIx,
  disputeCasePda,
  executeDisputeOutcomeIx,
  expireReservationIx,
  feeConfigPda,
  fundTradeEscrowIx,
  initializeFeeConfigIx,
  updateFeeConfigIx,
  liquidityVaultPda,
  liquidityVaultTokensPda,
  openDisputeCaseIx,
  releaseEscrowIx,
  reserveLiquidityIx,
  revealDisputeVoteIx,
  tradeEscrowPda,
  tradeEscrowTokensPda,
  withdrawLiquidityIx,
} from "../src/onchain/escrow.js";
import { DisputeOutcome, ESCROW_PROGRAM_ID, RENT_SYSVAR_ID, Role, TOKEN_2022_PROGRAM_ID } from "../src/onchain/constants.js";
import { stakeAccountPda, stakingConfigPda } from "../src/onchain/staking.js";
import { expectAccounts, expectDiscriminator, fakePubkey } from "./onchain-helpers.js";

const merchant = fakePubkey(1);
const mint = fakePubkey(2);
const buyer = fakePubkey(3);
const reservationId = 42n;

describe("escrow PDAs", () => {
  it("liquidityVaultPda matches the seed formula", () => {
    const [pda] = liquidityVaultPda(merchant, mint);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("liquidity_vault"), merchant.toBytes(), mint.toBytes()],
      ESCROW_PROGRAM_ID,
    );
    expect(pda.equals(expected)).toBe(true);
  });

  it("tradeEscrowPda uses the reservation id's 8-byte little-endian encoding", () => {
    const [pda] = tradeEscrowPda(reservationId);
    const idBytes = new Uint8Array(8);
    new DataView(idBytes.buffer).setBigUint64(0, reservationId, true);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("trade_escrow"), idBytes],
      ESCROW_PROGRAM_ID,
    );
    expect(pda.equals(expected)).toBe(true);
  });

  it("feeConfigPda is a singleton with no extra seed", () => {
    const [pda] = feeConfigPda();
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config")],
      ESCROW_PROGRAM_ID,
    );
    expect(pda.equals(expected)).toBe(true);
  });

  it("disputeCasePda matches the seed formula", () => {
    const [pda] = disputeCasePda(reservationId);
    const idBytes = new Uint8Array(8);
    new DataView(idBytes.buffer).setBigUint64(0, reservationId, true);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("dispute_case"), idBytes],
      ESCROW_PROGRAM_ID,
    );
    expect(pda.equals(expected)).toBe(true);
  });
});

describe("escrow instructions", () => {
  it("createLiquidityVaultIx", () => {
    const ix = createLiquidityVaultIx(merchant, mint);
    expect(ix.programId.equals(ESCROW_PROGRAM_ID)).toBe(true);
    expectDiscriminator(ix, [204, 255, 106, 205, 72, 186, 252, 83]);
    const [liquidityVault] = liquidityVaultPda(merchant, mint);
    const [tokenVault] = liquidityVaultTokensPda(merchant, mint);
    expectAccounts(ix, [
      { pubkey: merchant, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: liquidityVault, isSigner: false, isWritable: true },
      { pubkey: tokenVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("depositLiquidityIx", () => {
    const from = fakePubkey(4);
    const ix = depositLiquidityIx(merchant, mint, from, 1_000n);
    expectDiscriminator(ix, [245, 99, 59, 25, 151, 71, 233, 249]);
    const [liquidityVault] = liquidityVaultPda(merchant, mint);
    const [tokenVault] = liquidityVaultTokensPda(merchant, mint);
    expectAccounts(ix, [
      { pubkey: merchant, isSigner: true, isWritable: false },
      { pubkey: liquidityVault, isSigner: false, isWritable: true },
      { pubkey: tokenVault, isSigner: false, isWritable: true },
      { pubkey: from, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.readBigUInt64LE(8)).toBe(1_000n);
  });

  it("reserveLiquidityIx", () => {
    const ix = reserveLiquidityIx(merchant, mint, 500n);
    expectDiscriminator(ix, [197, 37, 232, 60, 182, 38, 12, 84]);
    const [liquidityVault] = liquidityVaultPda(merchant, mint);
    expectAccounts(ix, [
      { pubkey: merchant, isSigner: true, isWritable: false },
      { pubkey: liquidityVault, isSigner: false, isWritable: true },
    ]);
  });

  it("withdrawLiquidityIx", () => {
    const to = fakePubkey(5);
    const ix = withdrawLiquidityIx(merchant, mint, to, 250n);
    expectDiscriminator(ix, [149, 158, 33, 185, 47, 243, 253, 31]);
    const [liquidityVault] = liquidityVaultPda(merchant, mint);
    const [tokenVault] = liquidityVaultTokensPda(merchant, mint);
    expectAccounts(ix, [
      { pubkey: merchant, isSigner: true, isWritable: false },
      { pubkey: liquidityVault, isSigner: false, isWritable: true },
      { pubkey: tokenVault, isSigner: false, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("createTradeEscrowIx", () => {
    const ix = createTradeEscrowIx(merchant, buyer, mint, reservationId, 10_000n, 1_800n);
    expectDiscriminator(ix, [149, 181, 111, 61, 122, 174, 71, 51]);
    const [liquidityVault] = liquidityVaultPda(merchant, mint);
    const [tradeEscrow] = tradeEscrowPda(reservationId);
    const [tokenVault] = tradeEscrowTokensPda(reservationId);
    expectAccounts(ix, [
      { pubkey: merchant, isSigner: true, isWritable: true },
      { pubkey: buyer, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: liquidityVault, isSigner: false, isWritable: true },
      { pubkey: tradeEscrow, isSigner: false, isWritable: true },
      { pubkey: tokenVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR_ID, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.readBigUInt64LE(8)).toBe(reservationId);
    expect(ix.data.readBigUInt64LE(16)).toBe(10_000n);
    expect(ix.data.readBigInt64LE(24)).toBe(1_800n);
  });

  it("fundTradeEscrowIx", () => {
    const ix = fundTradeEscrowIx(merchant, mint, reservationId);
    expectDiscriminator(ix, [148, 177, 67, 164, 227, 76, 173, 101]);
    const [liquidityVault] = liquidityVaultPda(merchant, mint);
    const [liquidityTokenVault] = liquidityVaultTokensPda(merchant, mint);
    const [tradeEscrow] = tradeEscrowPda(reservationId);
    const [tradeEscrowTokenVault] = tradeEscrowTokensPda(reservationId);
    expectAccounts(ix, [
      { pubkey: merchant, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: liquidityVault, isSigner: false, isWritable: true },
      { pubkey: liquidityTokenVault, isSigner: false, isWritable: true },
      { pubkey: tradeEscrow, isSigner: false, isWritable: true },
      { pubkey: tradeEscrowTokenVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("approveSettlementIx", () => {
    const ix = approveSettlementIx(merchant, reservationId);
    expectDiscriminator(ix, [186, 5, 15, 163, 23, 10, 142, 12]);
    const [tradeEscrow] = tradeEscrowPda(reservationId);
    expectAccounts(ix, [
      { pubkey: merchant, isSigner: true, isWritable: false },
      { pubkey: tradeEscrow, isSigner: false, isWritable: true },
    ]);
  });

  const destinations = {
    buyerTokenAccount: fakePubkey(10),
    devTreasury: fakePubkey(11),
    ecosystemTreasury: fakePubkey(12),
    infraTreasury: fakePubkey(13),
    emergencyReserve: fakePubkey(14),
  };

  it("releaseEscrowIx (permissionless — no signer)", () => {
    const ix = releaseEscrowIx(mint, merchant, reservationId, destinations);
    expectDiscriminator(ix, [146, 253, 129, 233, 20, 145, 181, 206]);
    const [liquidityVault] = liquidityVaultPda(merchant, mint);
    const [tradeEscrow] = tradeEscrowPda(reservationId);
    const [tradeEscrowTokenVault] = tradeEscrowTokensPda(reservationId);
    const [feeConfig] = feeConfigPda();
    expectAccounts(ix, [
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: liquidityVault, isSigner: false, isWritable: true },
      { pubkey: tradeEscrow, isSigner: false, isWritable: true },
      { pubkey: tradeEscrowTokenVault, isSigner: false, isWritable: true },
      { pubkey: destinations.buyerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: feeConfig, isSigner: false, isWritable: false },
      { pubkey: destinations.devTreasury, isSigner: false, isWritable: true },
      { pubkey: destinations.ecosystemTreasury, isSigner: false, isWritable: true },
      { pubkey: destinations.infraTreasury, isSigner: false, isWritable: true },
      { pubkey: destinations.emergencyReserve, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("cancelReservationIx", () => {
    const ix = cancelReservationIx(buyer, mint, merchant, reservationId);
    expectDiscriminator(ix, [72, 162, 75, 180, 116, 157, 146, 172]);
    const [liquidityVault] = liquidityVaultPda(merchant, mint);
    const [tradeEscrow] = tradeEscrowPda(reservationId);
    const [tradeEscrowTokenVault] = tradeEscrowTokensPda(reservationId);
    const [liquidityTokenVault] = liquidityVaultTokensPda(merchant, mint);
    expectAccounts(ix, [
      { pubkey: buyer, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: liquidityVault, isSigner: false, isWritable: true },
      { pubkey: tradeEscrow, isSigner: false, isWritable: true },
      { pubkey: tradeEscrowTokenVault, isSigner: false, isWritable: true },
      { pubkey: liquidityTokenVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("expireReservationIx (permissionless)", () => {
    const ix = expireReservationIx(mint, merchant, reservationId);
    expectDiscriminator(ix, [19, 147, 203, 128, 237, 194, 72, 183]);
    const [liquidityVault] = liquidityVaultPda(merchant, mint);
    const [tradeEscrow] = tradeEscrowPda(reservationId);
    const [tradeEscrowTokenVault] = tradeEscrowTokensPda(reservationId);
    const [liquidityTokenVault] = liquidityVaultTokensPda(merchant, mint);
    expectAccounts(ix, [
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: liquidityVault, isSigner: false, isWritable: true },
      { pubkey: tradeEscrow, isSigner: false, isWritable: true },
      { pubkey: tradeEscrowTokenVault, isSigner: false, isWritable: true },
      { pubkey: liquidityTokenVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("openDisputeCaseIx", () => {
    const payer = fakePubkey(20);
    const ix = openDisputeCaseIx(buyer, payer, reservationId, 3_600n, 3_600n);
    expectDiscriminator(ix, [28, 229, 240, 113, 124, 180, 117, 138]);
    const [tradeEscrow] = tradeEscrowPda(reservationId);
    const [disputeCase] = disputeCasePda(reservationId);
    expectAccounts(ix, [
      { pubkey: buyer, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: tradeEscrow, isSigner: false, isWritable: true },
      { pubkey: disputeCase, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
  });

  it("commitDisputeVoteIx carries the stake accounts the eligibility gate reads", () => {
    // The program rejects a commit from a wallet below the Arbitrator
    // minimum. It can only check that with both accounts present, so
    // omitting either makes every commit fail to deserialize rather than
    // quietly skip the check.
    const arbitrator = fakePubkey(21);
    const commitment = new Uint8Array(32).fill(7);
    const ix = commitDisputeVoteIx(arbitrator, reservationId, commitment);
    expectDiscriminator(ix, [210, 14, 34, 127, 75, 185, 189, 168]);
    const [disputeCase] = disputeCasePda(reservationId);
    const [stakingConfig] = stakingConfigPda();
    const [arbitratorStake] = stakeAccountPda(arbitrator, Role.Arbitrator);
    expectAccounts(ix, [
      { pubkey: arbitrator, isSigner: true, isWritable: false },
      { pubkey: disputeCase, isSigner: false, isWritable: true },
      { pubkey: stakingConfig, isSigner: false, isWritable: false },
      { pubkey: arbitratorStake, isSigner: false, isWritable: false },
    ]);
    expect(Array.from(ix.data.subarray(8, 40))).toEqual(Array.from(commitment));
  });

  it("revealDisputeVoteIx", () => {
    const arbitrator = fakePubkey(22);
    const arbitratorStake = fakePubkey(23);
    const salt = new Uint8Array(32).fill(9);
    const ix = revealDisputeVoteIx(arbitrator, reservationId, DisputeOutcome.MerchantWins, salt, arbitratorStake);
    expectDiscriminator(ix, [211, 91, 1, 75, 154, 51, 233, 106]);
    const [disputeCase] = disputeCasePda(reservationId);
    expectAccounts(ix, [
      { pubkey: arbitrator, isSigner: true, isWritable: false },
      { pubkey: disputeCase, isSigner: false, isWritable: true },
      { pubkey: arbitratorStake, isSigner: false, isWritable: false },
    ]);
    expect(ix.data[8]).toBe(DisputeOutcome.MerchantWins);
    expect(Array.from(ix.data.subarray(9, 41))).toEqual(Array.from(salt));
  });

  it("executeDisputeOutcomeIx (permissionless)", () => {
    const ix = executeDisputeOutcomeIx(mint, merchant, reservationId, destinations);
    expectDiscriminator(ix, [158, 56, 238, 187, 219, 223, 212, 99]);
    const [disputeCase] = disputeCasePda(reservationId);
    const [tradeEscrow] = tradeEscrowPda(reservationId);
    const [tradeEscrowTokenVault] = tradeEscrowTokensPda(reservationId);
    const [liquidityVault] = liquidityVaultPda(merchant, mint);
    const [liquidityTokenVault] = liquidityVaultTokensPda(merchant, mint);
    const [feeConfig] = feeConfigPda();
    expectAccounts(ix, [
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: disputeCase, isSigner: false, isWritable: true },
      { pubkey: tradeEscrow, isSigner: false, isWritable: true },
      { pubkey: tradeEscrowTokenVault, isSigner: false, isWritable: true },
      { pubkey: liquidityVault, isSigner: false, isWritable: true },
      { pubkey: liquidityTokenVault, isSigner: false, isWritable: true },
      { pubkey: destinations.buyerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: feeConfig, isSigner: false, isWritable: false },
      { pubkey: destinations.devTreasury, isSigner: false, isWritable: true },
      { pubkey: destinations.ecosystemTreasury, isSigner: false, isWritable: true },
      { pubkey: destinations.infraTreasury, isSigner: false, isWritable: true },
      { pubkey: destinations.emergencyReserve, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("updateFeeConfigIx takes treasuries as accounts, not params", () => {
    const admin = fakePubkey(40);
    const mint = fakePubkey(41);
    const treasuries = {
      devTreasury: fakePubkey(42),
      ecosystemTreasury: fakePubkey(43),
      infraTreasury: fakePubkey(44),
      emergencyReserve: fakePubkey(45),
    };
    const ix = updateFeeConfigIx(admin, mint, treasuries, {
      adListingFee: 7n,
      disputeFilingFee: 9n,
      settlementFeeBps: 15,
      devTreasuryBps: 4_000,
      ecosystemTreasuryBps: 3_000,
      infraTreasuryBps: 2_000,
      emergencyReserveBps: 1_000,
      timeoutSecs: 1_800n,
    });
    expectDiscriminator(ix, [104, 184, 103, 242, 88, 151, 107, 20]);
    const [feeConfig] = feeConfigPda();
    expectAccounts(ix, [
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: feeConfig, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: treasuries.devTreasury, isSigner: false, isWritable: false },
      { pubkey: treasuries.ecosystemTreasury, isSigner: false, isWritable: false },
      { pubkey: treasuries.infraTreasury, isSigner: false, isWritable: false },
      { pubkey: treasuries.emergencyReserve, isSigner: false, isWritable: false },
    ]);
    // Treasury pubkeys must NOT appear in the data — they come from accounts.
    expect(ix.data.length).toBe(8 + 8 + 8 + 2 + 2 + 2 + 2 + 2 + 8);
    expect(ix.data.readBigUInt64LE(8)).toBe(7n);
    expect(ix.data.readBigUInt64LE(16)).toBe(9n);
    expect(ix.data.readUInt16LE(24)).toBe(15);
    expect(ix.data.readUInt16LE(26)).toBe(4_000);
    expect(ix.data.readBigInt64LE(34)).toBe(1_800n);
  });

  it("initializeFeeConfigIx", () => {
    const admin = fakePubkey(30);
    const ix = initializeFeeConfigIx(admin, {
      adListingFee: 1n,
      disputeFilingFee: 2n,
      settlementFeeBps: 15,
      devTreasury: fakePubkey(31),
      ecosystemTreasury: fakePubkey(32),
      infraTreasury: fakePubkey(33),
      emergencyReserve: fakePubkey(34),
      devTreasuryBps: 2_500,
      ecosystemTreasuryBps: 2_500,
      infraTreasuryBps: 2_500,
      emergencyReserveBps: 2_500,
      timeoutSecs: 1_800n,
    });
    expectDiscriminator(ix, [62, 162, 20, 133, 121, 65, 145, 27]);
    const [feeConfig] = feeConfigPda();
    expectAccounts(ix, [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: feeConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.readBigUInt64LE(8)).toBe(1n);
    expect(ix.data.readBigUInt64LE(16)).toBe(2n);
    expect(ix.data.readUInt16LE(24)).toBe(15);
  });
});
