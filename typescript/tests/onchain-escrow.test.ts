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
  arbitrationPoolPda,
  chargeAdListingFeeIx,
  claimArbitrationRewardIx,
  executeDisputeOutcomeIx,
  initializeArbitrationPoolIx,
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
import {
  banRecordPda,
  DisputeOutcome,
  ESCROW_PROGRAM_ID,
  RENT_SYSVAR_ID,
  Role,
  SLOT_HASHES_SYSVAR_ID,
  TOKEN_2022_PROGRAM_ID,
} from "../src/onchain/constants.js";
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
      // OFS-7100 §12: a deposit into a vault carries the depositor's own
      // ban address, which the program requires to be unoccupied.
      { pubkey: banRecordPda(merchant)[0], isSigner: false, isWritable: false },
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

  it("initializeArbitrationPoolIx", () => {
    const admin = fakePubkey(40);
    const openMint = fakePubkey(41);
    const ix = initializeArbitrationPoolIx(admin, openMint);
    expectDiscriminator(ix, [77, 223, 22, 51, 66, 236, 5, 90]);
    expectAccounts(ix, [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: feeConfigPda()[0], isSigner: false, isWritable: false },
      { pubkey: openMint, isSigner: false, isWritable: false },
      { pubkey: arbitrationPoolPda()[0], isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
  });

  it("chargeAdListingFeeIx bills the merchant's own vault and splits four ways", () => {
    const openMint = fakePubkey(42);
    const devTreasury = fakePubkey(43);
    const ecosystemTreasury = fakePubkey(44);
    const infraTreasury = fakePubkey(45);
    const emergencyReserve = fakePubkey(46);
    const advertisementId = new Uint8Array(32).fill(11);
    const ix = chargeAdListingFeeIx(
      merchant,
      openMint,
      devTreasury,
      ecosystemTreasury,
      infraTreasury,
      emergencyReserve,
      advertisementId,
    );
    expectDiscriminator(ix, [200, 39, 46, 240, 232, 173, 134, 196]);
    expectAccounts(ix, [
      { pubkey: merchant, isSigner: true, isWritable: false },
      { pubkey: feeConfigPda()[0], isSigner: false, isWritable: false },
      { pubkey: liquidityVaultPda(merchant, openMint)[0], isSigner: false, isWritable: true },
      { pubkey: liquidityVaultTokensPda(merchant, openMint)[0], isSigner: false, isWritable: true },
      { pubkey: devTreasury, isSigner: false, isWritable: true },
      { pubkey: ecosystemTreasury, isSigner: false, isWritable: true },
      { pubkey: infraTreasury, isSigner: false, isWritable: true },
      { pubkey: emergencyReserve, isSigner: false, isWritable: true },
      { pubkey: openMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
    // The advertisement id is carried for the emitted event only; it must
    // still reach the program intact or an indexer cannot join on it.
    expect(Array.from(ix.data.subarray(8, 40))).toEqual(Array.from(advertisementId));
  });

  it("claimArbitrationRewardIx", () => {
    const arbitrator = fakePubkey(44);
    const openMint = fakePubkey(45);
    const to = fakePubkey(46);
    const ix = claimArbitrationRewardIx(arbitrator, reservationId, openMint, to);
    expectDiscriminator(ix, [20, 88, 236, 69, 233, 200, 195, 238]);
    expectAccounts(ix, [
      { pubkey: arbitrator, isSigner: true, isWritable: false },
      { pubkey: disputeCasePda(reservationId)[0], isSigner: false, isWritable: true },
      { pubkey: feeConfigPda()[0], isSigner: false, isWritable: false },
      { pubkey: openMint, isSigner: false, isWritable: false },
      { pubkey: arbitrationPoolPda()[0], isSigner: false, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
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

  it("openDisputeCaseIx debits the merchant's OPEN vault, not the opener's", () => {
    // A buyer opening the case must still source the deposit from the
    // merchant's vault (OFS-4100 §9.3) — so the vault accounts are derived
    // from `merchant`, while `buyer` is only the signer. Deriving them from
    // the signer instead would make a buyer-opened dispute pay its own way,
    // which is exactly the cost barrier the design removes.
    const payer = fakePubkey(20);
    const depositMint = fakePubkey(30);
    const ix = openDisputeCaseIx(buyer, payer, reservationId, 3_600n, 3_600n, merchant, depositMint);
    expectDiscriminator(ix, [28, 229, 240, 113, 124, 180, 117, 138]);
    const [tradeEscrow] = tradeEscrowPda(reservationId);
    const [disputeCase] = disputeCasePda(reservationId);
    const [feeConfig] = feeConfigPda();
    const [merchantOpenVault] = liquidityVaultPda(merchant, depositMint);
    const [merchantOpenTokenVault] = liquidityVaultTokensPda(merchant, depositMint);
    const [arbitrationPool] = arbitrationPoolPda();
    expectAccounts(ix, [
      { pubkey: buyer, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: tradeEscrow, isSigner: false, isWritable: true },
      { pubkey: disputeCase, isSigner: false, isWritable: true },
      { pubkey: feeConfig, isSigner: false, isWritable: false },
      { pubkey: depositMint, isSigner: false, isWritable: false },
      { pubkey: merchantOpenVault, isSigner: false, isWritable: true },
      { pubkey: merchantOpenTokenVault, isSigner: false, isWritable: true },
      { pubkey: arbitrationPool, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // Seeds this case's arbitrator draw. Without it the program cannot
      // seed the draw at all, and the address must be exact — a wrong one
      // is rejected on-chain rather than silently yielding a predictable
      // seed.
      { pubkey: SLOT_HASHES_SYSVAR_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("commitDisputeVoteIx carries every account the three eligibility gates read", () => {
    // Three gates guard a commit (OFS-4100 §4, §4.1): the Arbitrator stake
    // minimum, the age of that stake, and the per-case sortition draw. The
    // program can only check them with all of these present, so omitting any
    // makes every commit fail to deserialize rather than quietly skip a
    // check. `feeConfig` is where the age threshold and the draw threshold
    // live, so governance can retune both without a redeploy.
    const arbitrator = fakePubkey(21);
    const commitment = new Uint8Array(32).fill(7);
    const ix = commitDisputeVoteIx(arbitrator, reservationId, commitment);
    expectDiscriminator(ix, [210, 14, 34, 127, 75, 185, 189, 168]);
    const [disputeCase] = disputeCasePda(reservationId);
    const [stakingConfig] = stakingConfigPda();
    const [arbitratorStake] = stakeAccountPda(arbitrator, Role.Arbitrator);
    const [commitFeeConfig] = feeConfigPda();
    expectAccounts(ix, [
      { pubkey: arbitrator, isSigner: true, isWritable: false },
      { pubkey: disputeCase, isSigner: false, isWritable: true },
      { pubkey: stakingConfig, isSigner: false, isWritable: false },
      { pubkey: arbitratorStake, isSigner: false, isWritable: false },
      { pubkey: commitFeeConfig, isSigner: false, isWritable: false },
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
    const [stakingConfig] = stakingConfigPda();
    expectAccounts(ix, [
      { pubkey: arbitrator, isSigner: true, isWritable: false },
      { pubkey: disputeCase, isSigner: false, isWritable: true },
      { pubkey: stakingConfig, isSigner: false, isWritable: false },
      { pubkey: arbitratorStake, isSigner: false, isWritable: false },
    ]);
    expect(ix.data[8]).toBe(DisputeOutcome.MerchantWins);
    expect(Array.from(ix.data.subarray(9, 41))).toEqual(Array.from(salt));
  });

  it("executeDisputeOutcomeIx (permissionless)", () => {
    const depositMint = fakePubkey(31);
    const ix = executeDisputeOutcomeIx(mint, merchant, reservationId, destinations, depositMint);
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
      { pubkey: depositMint, isSigner: false, isWritable: false },
      { pubkey: arbitrationPoolPda()[0], isSigner: false, isWritable: true },
      { pubkey: liquidityVaultPda(merchant, depositMint)[0], isSigner: false, isWritable: true },
      { pubkey: liquidityVaultTokensPda(merchant, depositMint)[0], isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      // Carried even though a round that decides never touches it: a round
      // that falls short re-draws the case seed, and Anchor's account list
      // is fixed per instruction rather than per branch.
      { pubkey: SLOT_HASHES_SYSVAR_ID, isSigner: false, isWritable: false },
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
      // Non-zero so the length assertion below would still catch these
      // being dropped from the payload.
      minArbitratorStakeAgeSecs: 2_592_000n,
      arbitratorSortitionBps: 100,
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
    expect(ix.data.length).toBe(8 + 8 + 8 + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 2);
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
