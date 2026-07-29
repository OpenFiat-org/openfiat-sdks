import { PublicKey, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  authorizeTreasurySpendIx,
  castVoteIx,
  createProposalIx,
  delistWalletIx,
  depositVaultPda,
  governanceConfigPda,
  listWalletIx,
  noAction,
  updateGovernanceConfigIx,
  initializeGovernanceConfigIx,
  proposalActionPda,
  proposalPda,
  refundOrForfeitDepositIx,
  tallyAndFinalizeIx,
  updateConfigParameterIx,
  voteRecordPda,
} from "../src/onchain/governance.js";
import { stakeAccountPda, stakingConfigPda } from "../src/onchain/staking.js";
import {
  banRecordPda,
  BanReason,
  GOVERNANCE_PROGRAM_ID,
  ProposalCategory,
  RENT_SYSVAR_ID,
  Role,
  TOKEN_2022_PROGRAM_ID,
} from "../src/onchain/constants.js";
import { expectAccounts, expectDiscriminator, fakePubkey } from "./onchain-helpers.js";

const mint = fakePubkey(1);
const proposalId = 7n;

describe("governance PDAs", () => {
  it("governanceConfigPda is a singleton", () => {
    const [pda] = governanceConfigPda();
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from("governance_config")], GOVERNANCE_PROGRAM_ID);
    expect(pda.equals(expected)).toBe(true);
  });

  it("proposalPda uses the id's 8-byte little-endian encoding", () => {
    const [pda] = proposalPda(proposalId);
    const idBytes = new Uint8Array(8);
    new DataView(idBytes.buffer).setBigUint64(0, proposalId, true);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), idBytes],
      GOVERNANCE_PROGRAM_ID,
    );
    expect(pda.equals(expected)).toBe(true);
  });

  it("voteRecordPda is keyed by (proposal, voter) — the double-vote guard", () => {
    const [proposal] = proposalPda(proposalId);
    const voter = fakePubkey(2);
    const [pda] = voteRecordPda(proposal, voter);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote"), proposal.toBytes(), voter.toBytes()],
      GOVERNANCE_PROGRAM_ID,
    );
    expect(pda.equals(expected)).toBe(true);
  });
});

describe("governance instructions", () => {
  it("initializeGovernanceConfigIx", () => {
    const admin = fakePubkey(10);
    const ix = initializeGovernanceConfigIx(admin, mint, {
      totalOpenSupply: 1_000_000_000n,
      quorumBps: 1_000,
      thresholdSimpleBps: 5_000,
      thresholdTreasuryBps: 6_000,
      thresholdUpgradeBps: 7_500,
      quorumUpgradeBps: 2_000,
      depositAmount: 100n,
      forfeitDestination: fakePubkey(11),
      voteLockSecs: 86_400n,
    });
    expectDiscriminator(ix, [15, 40, 42, 141, 94, 104, 27, 201]);
    const [governanceConfig] = governanceConfigPda();
    const [depositVault] = depositVaultPda();
    expectAccounts(ix, [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: governanceConfig, isSigner: false, isWritable: true },
      { pubkey: depositVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR_ID, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.readBigUInt64LE(8)).toBe(1_000_000_000n);
    expect(ix.data.readUInt16LE(16)).toBe(1_000);
  });

  it("createProposalIx", () => {
    const proposer = fakePubkey(20);
    const from = fakePubkey(21);
    const titleHash = new Uint8Array(32).fill(1);
    const summaryHash = new Uint8Array(32).fill(2);
    const ix = createProposalIx(
      proposer,
      mint,
      from,
      proposalId,
      ProposalCategory.Treasury,
      titleHash,
      summaryHash,
      604_800n,
      noAction,
    );
    expectDiscriminator(ix, [132, 116, 68, 174, 216, 160, 198, 22]);
    const [governanceConfig] = governanceConfigPda();
    const [depositVault] = depositVaultPda();
    const [proposal] = proposalPda(proposalId);
    expectAccounts(ix, [
      { pubkey: proposer, isSigner: true, isWritable: true },
      { pubkey: banRecordPda(proposer)[0], isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: governanceConfig, isSigner: false, isWritable: false },
      { pubkey: depositVault, isSigner: false, isWritable: true },
      { pubkey: from, isSigner: false, isWritable: true },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: proposalActionPda(proposal)[0], isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR_ID, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.readBigUInt64LE(8)).toBe(proposalId);
    expect(ix.data[16]).toBe(ProposalCategory.Treasury);
    expect(Array.from(ix.data.subarray(17, 49))).toEqual(Array.from(titleHash));
    expect(Array.from(ix.data.subarray(49, 81))).toEqual(Array.from(summaryHash));
  });

  it("castVoteIx", () => {
    const voter = fakePubkey(30);
    const ix = castVoteIx(voter, proposalId, true, Role.Merchant);
    expectDiscriminator(ix, [20, 212, 15, 189, 69, 180, 69, 151]);
    const [governanceConfig] = governanceConfigPda();
    const [proposal] = proposalPda(proposalId);
    const [stakingConfig] = stakingConfigPda();
    const [voterStake] = stakeAccountPda(voter, Role.Merchant);
    const [voteRecord] = voteRecordPda(proposal, voter);
    // staking_config is required because effective_stake is now
    // config-aware: a balance below the role minimum weighs zero. Omitting
    // it does not silently skip that check — the instruction fails to
    // deserialize, so every vote would break.
    expectAccounts(ix, [
      { pubkey: voter, isSigner: true, isWritable: true },
      { pubkey: governanceConfig, isSigner: false, isWritable: false },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: stakingConfig, isSigner: false, isWritable: false },
      { pubkey: voterStake, isSigner: false, isWritable: false },
      { pubkey: voteRecord, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
    expect(ix.data[8]).toBe(1); // inFavor = true
    expect(ix.data[9]).toBe(Role.Merchant);
  });

  it("tallyAndFinalizeIx (permissionless)", () => {
    const ix = tallyAndFinalizeIx(proposalId);
    expectDiscriminator(ix, [21, 190, 147, 204, 51, 17, 163, 150]);
    const [proposal] = proposalPda(proposalId);
    expectAccounts(ix, [{ pubkey: proposal, isSigner: false, isWritable: true }]);
  });

  it("refundOrForfeitDepositIx (permissionless)", () => {
    const proposerTokenAccount = fakePubkey(40);
    const forfeitDestination = fakePubkey(41);
    const ix = refundOrForfeitDepositIx(mint, proposalId, proposerTokenAccount, forfeitDestination);
    expectDiscriminator(ix, [85, 63, 214, 158, 230, 140, 62, 248]);
    const [governanceConfig] = governanceConfigPda();
    const [depositVault] = depositVaultPda();
    const [proposal] = proposalPda(proposalId);
    expectAccounts(ix, [
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: governanceConfig, isSigner: false, isWritable: false },
      { pubkey: depositVault, isSigner: false, isWritable: true },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: proposerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: forfeitDestination, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("updateConfigParameterIx", () => {
    const targetProgram = fakePubkey(50);
    const ix = updateConfigParameterIx(proposalId, targetProgram, "settlement_fee_bps", 25n);
    expectDiscriminator(ix, [126, 60, 74, 140, 2, 137, 230, 61]);
    const [proposal] = proposalPda(proposalId);
    expectAccounts(ix, [{ pubkey: proposal, isSigner: false, isWritable: true }]);
    // target_program (32 bytes) + u32-LE string length prefix + utf8 bytes + u64-LE new_value
    const keyLen = ix.data.readUInt32LE(40);
    expect(keyLen).toBe("settlement_fee_bps".length);
    const key = ix.data.subarray(44, 44 + keyLen).toString("utf8");
    expect(key).toBe("settlement_fee_bps");
    expect(ix.data.readBigUInt64LE(44 + keyLen)).toBe(25n);
  });

  it("updateGovernanceConfigIx takes the destination as an account, not a param", () => {
    const admin = fakePubkey(70);
    const mint = fakePubkey(71);
    const forfeitDestination = fakePubkey(72);
    const ix = updateGovernanceConfigIx(admin, mint, forfeitDestination, {
      totalOpenSupply: 1_000_000_000n,
      quorumBps: 1000,
      thresholdSimpleBps: 5001,
      thresholdTreasuryBps: 6000,
      thresholdUpgradeBps: 6600,
      quorumUpgradeBps: 2000,
      depositAmount: 5_000n,
      voteLockSecs: 604_800n,
    });
    expectDiscriminator(ix, [140, 45, 181, 17, 77, 67, 157, 248]);
    const [governanceConfig] = governanceConfigPda();
    expectAccounts(ix, [
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: governanceConfig, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: forfeitDestination, isSigner: false, isWritable: false },
    ]);

    // Every field pinned at its offset. The params struct is eight numbers
    // in a row with no length prefixes, so dropping or reordering one
    // encodes cleanly and silently shifts the rest — which is exactly the
    // mistake this test caught while being written.
    let o = 8;
    expect(ix.data.readBigUInt64LE(o)).toBe(1_000_000_000n); o += 8;
    expect(ix.data.readUInt16LE(o)).toBe(1000); o += 2;
    expect(ix.data.readUInt16LE(o)).toBe(5001); o += 2;
    expect(ix.data.readUInt16LE(o)).toBe(6000); o += 2;
    expect(ix.data.readUInt16LE(o)).toBe(6600); o += 2;
    expect(ix.data.readUInt16LE(o)).toBe(2000); o += 2;
    expect(ix.data.readBigUInt64LE(o)).toBe(5_000n); o += 8;
    expect(ix.data.readBigInt64LE(o)).toBe(604_800n); o += 8;
    expect(ix.data.length).toBe(o);
  });

  it("authorizeTreasurySpendIx", () => {
    const destination = fakePubkey(60);
    const ix = authorizeTreasurySpendIx(proposalId, destination, 5_000n);
    expectDiscriminator(ix, [248, 111, 88, 252, 136, 223, 53, 172]);
    const [proposal] = proposalPda(proposalId);
    expectAccounts(ix, [{ pubkey: proposal, isSigner: false, isWritable: true }]);
    expect(Array.from(ix.data.subarray(8, 40))).toEqual(Array.from(destination.toBytes()));
    expect(ix.data.readBigUInt64LE(40)).toBe(5_000n);
  });
});

describe("ban list (OFS-7100 §12)", () => {
  // No admin key here any more, deliberately: listing and delisting are
  // executed from a passed proposal, so there is no privileged signer
  // left for these tests to construct.
  const wallet = fakePubkey(81);

  it("banRecordPda is [\"ban\", wallet] under the governance program", () => {
    // The enforcing programs in escrow/staking/presale re-derive exactly
    // this on-chain from their own signer's key, so a client that got
    // the seed or the owning program wrong would build instructions that
    // fail with ConstraintSeeds rather than silently bypass the ban.
    const [pda] = banRecordPda(wallet);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("ban"), wallet.toBytes()],
      GOVERNANCE_PROGRAM_ID,
    );
    expect(pda.equals(expected)).toBe(true);
  });

  it("listWalletIx carries no privileged signer, only a passed proposal", () => {
    // The submitter is whoever pays the transaction, not an authority:
    // the ban is authorized by `proposal` + `proposalAction`, so nothing
    // here names `GovernanceConfig.admin`. Reason and evidence are not
    // arguments — they were fixed when the proposal was created and
    // cannot be chosen at execution time.
    const submitter = fakePubkey(30);
    const ix = listWalletIx(submitter, proposalId, wallet);
    expectDiscriminator(ix, [176, 149, 148, 11, 126, 182, 162, 248]);
    const [proposal] = proposalPda(proposalId);
    expectAccounts(ix, [
      { pubkey: submitter, isSigner: true, isWritable: true },
      { pubkey: governanceConfigPda()[0], isSigner: false, isWritable: false },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: proposalActionPda(proposal)[0], isSigner: false, isWritable: false },
      { pubkey: banRecordPda(wallet)[0], isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
    expect(Array.from(ix.data.subarray(8, 40))).toEqual(Array.from(wallet.toBytes()));
  });

  it("delistWalletIx targets the same address listWalletIx created", () => {
    // §12.2 requires delisting to be possible at all; the two builders
    // agreeing on the address is what makes it possible in practice.
    const submitter = fakePubkey(31);
    const ix = delistWalletIx(submitter, proposalId, wallet);
    expectDiscriminator(ix, [40, 136, 186, 228, 254, 114, 109, 134]);
    const [proposal] = proposalPda(proposalId);
    expectAccounts(ix, [
      { pubkey: submitter, isSigner: true, isWritable: true },
      { pubkey: governanceConfigPda()[0], isSigner: false, isWritable: false },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: proposalActionPda(proposal)[0], isSigner: false, isWritable: false },
      { pubkey: banRecordPda(wallet)[0], isSigner: false, isWritable: true },
    ]);
    expect(Array.from(ix.data.subarray(8, 40))).toEqual(Array.from(wallet.toBytes()));

    const listed = listWalletIx(submitter, proposalId, wallet);
    expect(ix.keys[4]?.pubkey.equals(listed.keys[4]!.pubkey)).toBe(true);
  });

  it("a listWallet action binds the proposal to one exact wallet", () => {
    // The replay guard, at the encoding layer: the action encoded into a
    // proposal names its target, so a proposal created to ban one wallet
    // cannot be re-pointed at another when it is executed.
    const evidenceHash = new Uint8Array(32).fill(9);
    const other = fakePubkey(32);
    const ix = createProposalIx(
      fakePubkey(20),
      mint,
      fakePubkey(21),
      proposalId,
      ProposalCategory.Standards,
      new Uint8Array(32).fill(1),
      new Uint8Array(32).fill(2),
      604_800n,
      { kind: "listWallet", wallet, reason: BanReason.Sanctions, evidenceHash },
    );
    // The action trails the fixed prefix: discriminator(8) + id(8) +
    // category(1) + titleHash(32) + summaryHash(32) + votingPeriod(8).
    const encoded = Array.from(ix.data.subarray(89));
    expect(encoded[0]).toBe(1); // listWallet variant tag
    expect(encoded.slice(1, 33)).toEqual(Array.from(wallet.toBytes()));
    expect(encoded.slice(1, 33)).not.toEqual(Array.from(other.toBytes()));
    expect(encoded[33]).toBe(BanReason.Sanctions);
    expect(encoded.slice(34, 66)).toEqual(Array.from(evidenceHash));
  });
});
