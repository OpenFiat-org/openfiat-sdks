/**
 * Building a real stake + governance-vote sequence entirely client-side
 * with this SDK's `onchain` module (OFS-4200): initialize the staking
 * config and a stake account, stake OPEN under the `Merchant` role,
 * then initialize governance, create a proposal, and cast a vote whose
 * weight the `openfiat-governance` program itself derives on-chain from
 * the just-staked amount — no instruction here is hand-assembled by
 * this example; every one comes from `onchain.staking`/`onchain.
 * governance`'s typed builders.
 *
 * This only *constructs* the instructions and logs them — it doesn't
 * submit them, since that needs a running validator with the three
 * programs actually deployed (a local `solana-test-validator` or
 * devnet) and a funded OPEN mint/token accounts already set up, which
 * this standalone example can't assume. See `tests/live_node.test.ts`'s
 * neighbor (the on-chain live-validator conformance test) for a run
 * that submits and confirms these for real.
 *
 * Run with `pnpm tsx examples/stake_and_vote.ts`.
 */
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { onchain } from "../src/index.js";

function main() {
  const mint = Keypair.generate().publicKey; // stand-in for a real OPEN Token-2022 mint
  const admin = Keypair.generate();
  const owner = Keypair.generate();
  const ownerTokenAccount = Keypair.generate().publicKey;

  const stakingIxs = [
    onchain.staking.initializeStakingConfigIx(admin.publicKey, mint, {
      minStakeByRole: [1_000n, 5_000n, 1_000n, 5_000n, 1_000n, 1_000n, 1_000n],
      unbondingPeriodSecsByRole: Array<bigint>(ROLE_COUNT).fill(604_800n), // 7 days
      slashBps: 500, // 5%
      slashingAuthority: admin.publicKey,
      slashDestination: Keypair.generate().publicKey,
      rewardsAuthority: admin.publicKey,
    }),
    onchain.staking.initializeStakeAccountIx(owner.publicKey, onchain.Role.Merchant),
    onchain.staking.stakeIx(owner.publicKey, mint, onchain.Role.Merchant, ownerTokenAccount, 10_000n),
  ];

  const proposalId = 1n;
  const governanceIxs = [
    onchain.governance.initializeGovernanceConfigIx(admin.publicKey, mint, {
      totalOpenSupply: 1_000_000_000n,
      quorumBps: 1_000, // 10%
      thresholdSimpleBps: 5_000, // 50%
      thresholdTreasuryBps: 6_000,
      thresholdUpgradeBps: 7_500,
      quorumUpgradeBps: 2_000,
      depositAmount: 100n,
      forfeitDestination: Keypair.generate().publicKey,
      voteLockSecs: 86_400n,
    }),
    onchain.governance.createProposalIx(
      owner.publicKey,
      mint,
      ownerTokenAccount,
      proposalId,
      onchain.ProposalCategory.Parameter,
      new Uint8Array(32), // sha256(title) — a real caller hashes the actual proposal text
      new Uint8Array(32), // sha256(summary)
      604_800n, // 7-day voting period
    ),
    onchain.governance.castVoteIx(owner.publicKey, proposalId, true, onchain.Role.Merchant),
  ];

  const allInstructions = [...stakingIxs, ...governanceIxs, SystemProgram.transfer({
    fromPubkey: owner.publicKey,
    toPubkey: owner.publicKey,
    lamports: 0, // a harmless no-op instruction, just to show these compose into one real Transaction
  })];

  const transaction = new Transaction().add(...allInstructions);
  console.log(`built a ${transaction.instructions.length}-instruction transaction:`);
  for (const ix of transaction.instructions) {
    console.log(`  programId=${ix.programId.toBase58()} accounts=${ix.keys.length} dataBytes=${ix.data.length}`);
  }
}

main();
