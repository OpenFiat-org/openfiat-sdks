import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { boolByte, borshString, enumTag, fixedBytes, i64LE, instructionData, meta, u16LE, u64LE } from "./codec.js";
import { banRecordPda, GOVERNANCE_PROGRAM_ID, RENT_SYSVAR_ID, TOKEN_2022_PROGRAM_ID } from "./constants.js";
import type { BanReason, ProposalCategory, Role } from "./constants.js";
import { stakeAccountPda, stakingConfigPda } from "./staking.js";

/**
 * PDA seeds for `openfiat-governance` (OFS-4200 §6) — taken directly
 * from `openfiat-core/programs/programs/governance/src/constants.rs`.
 */
const GOVERNANCE_CONFIG_SEED = Buffer.from("governance_config");
const DEPOSIT_VAULT_SEED = Buffer.from("deposit_vault");
const PROPOSAL_SEED = Buffer.from("proposal");
const VOTE_RECORD_SEED = Buffer.from("vote");

const DISCRIMINATORS = {
  initializeGovernanceConfig: Uint8Array.from([15, 40, 42, 141, 94, 104, 27, 201]),
  updateGovernanceConfig: Uint8Array.from([140, 45, 181, 17, 77, 67, 157, 248]),
  createProposal: Uint8Array.from([132, 116, 68, 174, 216, 160, 198, 22]),
  castVote: Uint8Array.from([20, 212, 15, 189, 69, 180, 69, 151]),
  tallyAndFinalize: Uint8Array.from([21, 190, 147, 204, 51, 17, 163, 150]),
  refundOrForfeitDeposit: Uint8Array.from([85, 63, 214, 158, 230, 140, 62, 248]),
  updateConfigParameter: Uint8Array.from([126, 60, 74, 140, 2, 137, 230, 61]),
  authorizeTreasurySpend: Uint8Array.from([248, 111, 88, 252, 136, 223, 53, 172]),
  listWallet: Uint8Array.from([176, 149, 148, 11, 126, 182, 162, 248]),
  delistWallet: Uint8Array.from([40, 136, 186, 228, 254, 114, 109, 134]),
} as const;

function proposalIdSeed(id: bigint): Uint8Array {
  return u64LE(id);
}

export function governanceConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([GOVERNANCE_CONFIG_SEED], GOVERNANCE_PROGRAM_ID);
}

export function depositVaultPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([DEPOSIT_VAULT_SEED], GOVERNANCE_PROGRAM_ID);
}

export function proposalPda(id: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROPOSAL_SEED, proposalIdSeed(id)], GOVERNANCE_PROGRAM_ID);
}

/** `[VOTE_RECORD_SEED, proposal, voter]` — its existence is itself the double-vote guard (OFS-4200 §6). */
export function voteRecordPda(proposal: PublicKey, voter: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VOTE_RECORD_SEED, proposal.toBytes(), voter.toBytes()],
    GOVERNANCE_PROGRAM_ID,
  );
}

/** Mirrors `governance::instructions::initialize_governance_config::InitializeGovernanceConfigParams`'s field order exactly. */
export interface InitializeGovernanceConfigParams {
  totalOpenSupply: bigint;
  quorumBps: number;
  thresholdSimpleBps: number;
  thresholdTreasuryBps: number;
  thresholdUpgradeBps: number;
  quorumUpgradeBps: number;
  depositAmount: bigint;
  forfeitDestination: PublicKey;
  voteLockSecs: bigint;
}

export function initializeGovernanceConfigIx(
  admin: PublicKey,
  mint: PublicKey,
  params: InitializeGovernanceConfigParams,
): TransactionInstruction {
  const [governanceConfig] = governanceConfigPda();
  const [depositVault] = depositVaultPda();
  return new TransactionInstruction({
    programId: GOVERNANCE_PROGRAM_ID,
    keys: [
      meta(admin, true, true),
      meta(mint, false, false),
      meta(governanceConfig, false, true),
      meta(depositVault, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
      meta(RENT_SYSVAR_ID, false, false),
    ],
    data: instructionData(
      DISCRIMINATORS.initializeGovernanceConfig,
      u64LE(params.totalOpenSupply),
      u16LE(params.quorumBps),
      u16LE(params.thresholdSimpleBps),
      u16LE(params.thresholdTreasuryBps),
      u16LE(params.thresholdUpgradeBps),
      u16LE(params.quorumUpgradeBps),
      u64LE(params.depositAmount),
      params.forfeitDestination.toBytes(),
      i64LE(params.voteLockSecs),
    ),
  });
}

/** The numeric half of the config. `forfeitDestination` is absent: the
 *  program takes it as an account so a wallet cannot be stored where a
 *  token account is required. */
export interface UpdateGovernanceConfigParams {
  totalOpenSupply: bigint;
  quorumBps: number;
  thresholdSimpleBps: number;
  thresholdTreasuryBps: number;
  thresholdUpgradeBps: number;
  quorumUpgradeBps: number;
  depositAmount: bigint;
  voteLockSecs: bigint;
}

/**
 * Corrects the singleton config (admin-only).
 *
 * `forfeitDestination` is an account rather than a param, unlike
 * `initializeGovernanceConfigIx`. The deployed config was initialized
 * with a treasury owner wallet there, which left
 * `refund_or_forfeit_deposit` unable to load its accounts at all —
 * refunds included, not just forfeits. `mint` must equal the one
 * recorded on the config.
 */
export function updateGovernanceConfigIx(
  admin: PublicKey,
  mint: PublicKey,
  forfeitDestination: PublicKey,
  params: UpdateGovernanceConfigParams,
): TransactionInstruction {
  const [governanceConfig] = governanceConfigPda();
  return new TransactionInstruction({
    programId: GOVERNANCE_PROGRAM_ID,
    keys: [
      meta(admin, true, false),
      meta(governanceConfig, false, true),
      meta(mint, false, false),
      meta(forfeitDestination, false, false),
    ],
    data: instructionData(
      DISCRIMINATORS.updateGovernanceConfig,
      u64LE(params.totalOpenSupply),
      u16LE(params.quorumBps),
      u16LE(params.thresholdSimpleBps),
      u16LE(params.thresholdTreasuryBps),
      u16LE(params.thresholdUpgradeBps),
      u16LE(params.quorumUpgradeBps),
      u64LE(params.depositAmount),
      i64LE(params.voteLockSecs),
    ),
  });
}

export function createProposalIx(
  proposer: PublicKey,
  mint: PublicKey,
  from: PublicKey,
  id: bigint,
  category: ProposalCategory,
  titleHash: Uint8Array,
  summaryHash: Uint8Array,
  votingPeriodSecs: bigint,
): TransactionInstruction {
  const [governanceConfig] = governanceConfigPda();
  const [depositVault] = depositVaultPda();
  const [proposal] = proposalPda(id);
  return new TransactionInstruction({
    programId: GOVERNANCE_PROGRAM_ID,
    keys: [
      meta(proposer, true, true),
      meta(banRecordPda(proposer)[0], false, false),
      meta(mint, false, false),
      meta(governanceConfig, false, false),
      meta(depositVault, false, true),
      meta(from, false, true),
      meta(proposal, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
      meta(RENT_SYSVAR_ID, false, false),
    ],
    data: instructionData(
      DISCRIMINATORS.createProposal,
      u64LE(id),
      enumTag(category),
      fixedBytes(titleHash, 32),
      fixedBytes(summaryHash, 32),
      i64LE(votingPeriodSecs),
    ),
  });
}

export function castVoteIx(
  voter: PublicKey,
  proposalId: bigint,
  inFavor: boolean,
  role: Role,
): TransactionInstruction {
  const [governanceConfig] = governanceConfigPda();
  const [proposal] = proposalPda(proposalId);
  const [stakingConfig] = stakingConfigPda();
  const [voterStake] = stakeAccountPda(voter, role);
  const [voteRecord] = voteRecordPda(proposal, voter);
  return new TransactionInstruction({
    programId: GOVERNANCE_PROGRAM_ID,
    keys: [
      meta(voter, true, true),
      meta(governanceConfig, false, false),
      meta(proposal, false, true),
      meta(stakingConfig, false, false),
      meta(voterStake, false, false),
      meta(voteRecord, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: instructionData(DISCRIMINATORS.castVote, boolByte(inFavor), enumTag(role)),
  });
}

/** Permissionless once voting has ended — no signer required. */
export function tallyAndFinalizeIx(proposalId: bigint): TransactionInstruction {
  const [proposal] = proposalPda(proposalId);
  return new TransactionInstruction({
    programId: GOVERNANCE_PROGRAM_ID,
    keys: [meta(proposal, false, true)],
    data: instructionData(DISCRIMINATORS.tallyAndFinalize),
  });
}

/** Permissionless once `tallyAndFinalizeIx` has run. */
export function refundOrForfeitDepositIx(
  mint: PublicKey,
  proposalId: bigint,
  proposerTokenAccount: PublicKey,
  forfeitDestination: PublicKey,
): TransactionInstruction {
  const [governanceConfig] = governanceConfigPda();
  const [depositVault] = depositVaultPda();
  const [proposal] = proposalPda(proposalId);
  return new TransactionInstruction({
    programId: GOVERNANCE_PROGRAM_ID,
    keys: [
      meta(mint, false, false),
      meta(governanceConfig, false, false),
      meta(depositVault, false, true),
      meta(proposal, false, true),
      meta(proposerTokenAccount, false, true),
      meta(forfeitDestination, false, true),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    data: instructionData(DISCRIMINATORS.refundOrForfeitDeposit),
  });
}

/**
 * Records an accepted `Parameter`-category proposal's authorization
 * (`Proposal.executed = true`) — does not perform a live cross-program
 * mutation, matching `openfiat-governance::instructions::
 * update_config_parameter`'s own scoping (no admin-gated update
 * instruction exists yet on `escrow`/`staking` for this to CPI into).
 */
export function updateConfigParameterIx(
  proposalId: bigint,
  targetProgram: PublicKey,
  parameterKey: string,
  newValue: bigint,
): TransactionInstruction {
  const [proposal] = proposalPda(proposalId);
  return new TransactionInstruction({
    programId: GOVERNANCE_PROGRAM_ID,
    keys: [meta(proposal, false, true)],
    data: instructionData(
      DISCRIMINATORS.updateConfigParameter,
      targetProgram.toBytes(),
      borshString(parameterKey),
      u64LE(newValue),
    ),
  });
}

/**
 * Records an accepted `Treasury`-category proposal's authorization —
 * same record-only scoping as `updateConfigParameterIx` (governance
 * holds no treasury vault to disburse from yet).
 */
export function authorizeTreasurySpendIx(
  proposalId: bigint,
  destination: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const [proposal] = proposalPda(proposalId);
  return new TransactionInstruction({
    programId: GOVERNANCE_PROGRAM_ID,
    keys: [meta(proposal, false, true)],
    data: instructionData(DISCRIMINATORS.authorizeTreasurySpend, destination.toBytes(), u64LE(amount)),
  });
}

/**
 * Adds a wallet to the protocol-wide ban list (OFS-7100 §12).
 *
 * One instruction closes deposit access across `escrow`, `staking`,
 * `presale` and `governance` at once — those programs read the record
 * this creates, they are not separately notified, and no application
 * can opt out.
 *
 * The authority is `GovernanceConfig.admin`: a single key, checked
 * directly. It is **not** a governance vote, despite §12.2 requiring
 * one — `governance`'s proposal-execution instructions only record an
 * authorization (`Proposal.executed = true`) and cannot mutate state,
 * so no working vote-gated path exists to build on yet. Do not present
 * this to users as governance-controlled. See
 * `governance::instructions::list_wallet`'s doc comment for what
 * closing that gap requires.
 *
 * `evidenceHash` pins the off-chain evidence the listing rests on. §12.2
 * separates publishing evidence (a risk intelligence provider) from
 * deciding exclusion (governance); this is where the former is
 * committed to so a listing can be contested against a fixed artefact.
 */
export function listWalletIx(
  admin: PublicKey,
  wallet: PublicKey,
  reason: BanReason,
  evidenceHash: Uint8Array,
): TransactionInstruction {
  const [governanceConfig] = governanceConfigPda();
  const [banRecord] = banRecordPda(wallet);
  return new TransactionInstruction({
    programId: GOVERNANCE_PROGRAM_ID,
    keys: [
      meta(admin, true, true),
      meta(governanceConfig, false, false),
      meta(banRecord, false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: instructionData(
      DISCRIMINATORS.listWallet,
      wallet.toBytes(),
      enumTag(reason),
      fixedBytes(evidenceHash, 32),
    ),
  });
}

/**
 * Removes a wallet from the ban list, restoring deposit access
 * protocol-wide (OFS-7100 §12.2).
 *
 * Mandatory rather than optional: once rejection is protocol-wide, an
 * erroneous listing costs a wallet all protocol access, so the reversal
 * path has to be as available as the exclusion path. Same authority as
 * `listWalletIx`, deliberately — an authority that could exclude but
 * not readmit is the failure §12.2 names. Rent returns to `admin`, who
 * paid it at listing.
 */
export function delistWalletIx(admin: PublicKey, wallet: PublicKey): TransactionInstruction {
  const [governanceConfig] = governanceConfigPda();
  const [banRecord] = banRecordPda(wallet);
  return new TransactionInstruction({
    programId: GOVERNANCE_PROGRAM_ID,
    keys: [
      meta(admin, true, true),
      meta(governanceConfig, false, false),
      meta(banRecord, false, true),
    ],
    data: instructionData(DISCRIMINATORS.delistWallet, wallet.toBytes()),
  });
}
