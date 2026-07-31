//! Constructs (but does not necessarily submit) a full stake -> vote
//! sequence against the three on-chain Anchor programs (OFS-4200): a
//! `Merchant`-role stake, then a governance proposal and a vote weighed
//! by that same stake. Demonstrates `openfiat_sdk::onchain`'s intended
//! usage — every account this program needs is either supplied directly
//! or derived locally via a `*_pda` helper, never computed by hand.
//!
//! This example only builds instructions/messages and prints them; it
//! does not sign or submit anything, since a real run needs the three
//! programs (`openfiat-escrow`, `openfiat-staking`,
//! `openfiat-governance`) actually deployed to whatever cluster it
//! targets, plus a funded OPEN token account for every signer — neither
//! of which this example can assume. See `solana_transaction.rs` for
//! the sign-and-submit half of this flow once those preconditions hold.
//!
//! Run with `cargo run --example stake_and_vote`.

use openfiat_sdk::onchain::{ProposalCategory, Role, governance, staking};
use solana_hash::Hash;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;

fn main() {
    let admin = Keypair::new();
    let voter = Keypair::new();
    let mint = Pubkey::new_unique();
    let voter_open_account = Pubkey::new_unique();
    let deposit_source = Pubkey::new_unique();

    // 1. One-time singleton setup (admin-only) — a real deployment runs
    //    these once, not per-user.
    let init_staking = staking::initialize_staking_config_ix(
        &admin.pubkey(),
        &mint,
        // min_stake_by_role, indexed by Role
        [
            1_000_000, 5_000_000, 1_000_000, 5_000_000, 1_000_000, 1_000_000, 1_000_000,
        ],
        [7 * 24 * 3600; openfiat_sdk::onchain::ROLE_COUNT], // unbonding_period_secs_by_role
        500,                                                // slash_bps (5%)
        &admin.pubkey(),
        &admin.pubkey(),
        &admin.pubkey(),
    );
    let init_governance = governance::initialize_governance_config_ix(
        &admin.pubkey(),
        &mint,
        1_000_000_000,   // total_open_supply (OFS-4100 §1)
        400,             // quorum_bps (4%)
        5_000,           // threshold_simple_bps (50%)
        6_600,           // threshold_treasury_bps
        7_500,           // threshold_upgrade_bps
        700,             // quorum_upgrade_bps
        10_000,          // deposit_amount
        &admin.pubkey(), // forfeit_destination
        3 * 24 * 3600,   // vote_lock_secs
    );

    // 2. The voter stakes real OPEN under the Merchant role.
    let init_stake_account = staking::initialize_stake_account_ix(&voter.pubkey(), Role::Merchant);
    let stake = staking::stake_ix(
        &voter.pubkey(),
        Role::Merchant,
        &mint,
        &voter_open_account,
        50_000,
    );

    // 3. A governance proposal, funded by a stake deposit, then a vote
    //    weighed by the stake just placed above.
    let create_proposal = governance::create_proposal_ix(
        &voter.pubkey(),
        &mint,
        &deposit_source,
        1,
        ProposalCategory::Parameter,
        [0u8; 32],
        [0u8; 32],
        7 * 24 * 3600,
        // What this proposal may do if it passes, fixed here and never
        // changeable afterwards. `None` for a parameter proposal, whose
        // execution instruction is still record-only; a ban-list
        // proposal would carry `GovernanceAction::ListWallet { .. }`
        // and would have to be filed under `Standards`.
        governance::GovernanceAction::None,
    );
    let cast_vote = governance::cast_vote_ix(&voter.pubkey(), 1, true, Role::Merchant);

    let instructions = [
        init_staking,
        init_governance,
        init_stake_account,
        stake,
        create_proposal,
        cast_vote,
    ];

    // A real submission needs a fresh blockhash from the target cluster
    // (see `solana_transaction.rs`) — a fixed one only demonstrates
    // message construction here.
    let message =
        Message::new_with_blockhash(&instructions, Some(&voter.pubkey()), &Hash::default());

    println!(
        "built {} instructions across escrow/staking/governance's on-chain programs:",
        instructions.len()
    );
    for (i, ix) in message.instructions.iter().enumerate() {
        let program_id = message.account_keys[ix.program_id_index as usize];
        println!(
            "  [{i}] program {program_id} ({} account(s), {} data byte(s))",
            ix.accounts.len(),
            ix.data.len()
        );
    }
}
