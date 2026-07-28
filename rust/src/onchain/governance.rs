//! `openfiat-governance` instruction builders (OFS-4200 §6). Discriminators
//! below are taken verbatim from `programs/target/idl/governance.json`,
//! cross-checked against that file instruction by instruction.
//!
//! PDA seeds mirror `programs/programs/governance/src/constants.rs`
//! exactly: `GovernanceConfig`/`deposit_vault` are singletons, a
//! `Proposal` is keyed by `id`, a `VoteRecord` by `(proposal, voter)` —
//! its existence is itself the double-vote guard.

use super::{
    GOVERNANCE_PROGRAM_ID, ProposalCategory, Role, TOKEN_2022_PROGRAM_ID, instruction_data,
    system_program_id,
};
use crate::onchain::staking;
use borsh::BorshSerialize;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

const GOVERNANCE_CONFIG_SEED: &[u8] = b"governance_config";
const DEPOSIT_VAULT_SEED: &[u8] = b"deposit_vault";
const PROPOSAL_SEED: &[u8] = b"proposal";
const VOTE_RECORD_SEED: &[u8] = b"vote";

/// `[GOVERNANCE_CONFIG_SEED]` — a singleton.
pub fn governance_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[GOVERNANCE_CONFIG_SEED], &GOVERNANCE_PROGRAM_ID)
}

/// `[DEPOSIT_VAULT_SEED]`.
pub fn deposit_vault_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[DEPOSIT_VAULT_SEED], &GOVERNANCE_PROGRAM_ID)
}

/// `[PROPOSAL_SEED, id.to_le_bytes()]`.
pub fn proposal_pda(id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PROPOSAL_SEED, &id.to_le_bytes()], &GOVERNANCE_PROGRAM_ID)
}

/// `[VOTE_RECORD_SEED, proposal, voter]` — its existence is itself the
/// double-vote guard (OFS-4200 §6).
pub fn vote_record_pda(proposal: &Pubkey, voter: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[VOTE_RECORD_SEED, proposal.as_ref(), voter.as_ref()],
        &GOVERNANCE_PROGRAM_ID,
    )
}

#[derive(BorshSerialize)]
struct InitializeGovernanceConfigParams {
    total_open_supply: u64,
    quorum_bps: u16,
    threshold_simple_bps: u16,
    threshold_treasury_bps: u16,
    threshold_upgrade_bps: u16,
    quorum_upgrade_bps: u16,
    deposit_amount: u64,
    forfeit_destination: Pubkey,
    vote_lock_secs: i64,
}

/// One-time singleton setup (admin-only).
#[allow(clippy::too_many_arguments)]
pub fn initialize_governance_config_ix(
    admin: &Pubkey,
    mint: &Pubkey,
    total_open_supply: u64,
    quorum_bps: u16,
    threshold_simple_bps: u16,
    threshold_treasury_bps: u16,
    threshold_upgrade_bps: u16,
    quorum_upgrade_bps: u16,
    deposit_amount: u64,
    forfeit_destination: &Pubkey,
    vote_lock_secs: i64,
) -> Instruction {
    let (governance_config, _) = governance_config_pda();
    let (deposit_vault, _) = deposit_vault_pda();
    let data = instruction_data(
        [15, 40, 42, 141, 94, 104, 27, 201],
        InitializeGovernanceConfigParams {
            total_open_supply,
            quorum_bps,
            threshold_simple_bps,
            threshold_treasury_bps,
            threshold_upgrade_bps,
            quorum_upgrade_bps,
            deposit_amount,
            forfeit_destination: *forfeit_destination,
            vote_lock_secs,
        },
    );
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(governance_config, false),
            AccountMeta::new(deposit_vault, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(super::RENT_SYSVAR_ID, false),
        ],
    )
}

/// `from` is the proposer's own token account funding the stake deposit
/// (`GovernanceConfig.deposit_amount`, refunded or forfeited once
/// `tally_and_finalize` runs).
#[allow(clippy::too_many_arguments)]
pub fn create_proposal_ix(
    proposer: &Pubkey,
    mint: &Pubkey,
    from: &Pubkey,
    id: u64,
    category: ProposalCategory,
    title_hash: [u8; 32],
    summary_hash: [u8; 32],
    voting_period_secs: i64,
) -> Instruction {
    let (governance_config, _) = governance_config_pda();
    let (deposit_vault, _) = deposit_vault_pda();
    let (proposal, _) = proposal_pda(id);
    let data = instruction_data(
        [132, 116, 68, 174, 216, 160, 198, 22],
        (id, category, title_hash, summary_hash, voting_period_secs),
    );
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*proposer, true),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(governance_config, false),
            AccountMeta::new(deposit_vault, false),
            AccountMeta::new(*from, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(super::RENT_SYSVAR_ID, false),
        ],
    )
}

/// Weighs the vote by reading `voter`'s `openfiat-staking` `StakeAccount`
/// under `role` directly (no CPI dispatch) — any role's stake counts
/// toward voting weight (unlike escrow's dispute-vote reveal, which is
/// deliberately Arbitrator-only). `vote_record`'s PDA (keyed by
/// proposal+voter only, not role) is what actually enforces one vote per
/// proposal regardless of how many roles the voter holds stake under.
pub fn cast_vote_ix(voter: &Pubkey, id: u64, in_favor: bool, role: Role) -> Instruction {
    let (governance_config, _) = governance_config_pda();
    let (proposal, _) = proposal_pda(id);
    let (voter_stake, _) = staking::stake_account_pda(voter, role);
    let (vote_record, _) = vote_record_pda(&proposal, voter);
    let data = instruction_data([20, 212, 15, 189, 69, 180, 69, 151], (in_favor, role));
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*voter, true),
            AccountMeta::new_readonly(governance_config, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(voter_stake, false),
            AccountMeta::new(vote_record, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
    )
}

/// Permissionless, callable once `proposal.voting_ends_at` has passed. A
/// quorum miss or a genuine vote tie both resolve to `Rejected`,
/// deterministically.
pub fn tally_and_finalize_ix(id: u64) -> Instruction {
    let (proposal, _) = proposal_pda(id);
    let data = instruction_data([21, 190, 147, 204, 51, 17, 163, 150], ());
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &data,
        vec![AccountMeta::new(proposal, false)],
    )
}

/// Permissionless, callable once `tally_and_finalize` has run. Refunds
/// the proposer if quorum was met (regardless of accept/reject),
/// otherwise forfeits to `GovernanceConfig.forfeit_destination`.
pub fn refund_or_forfeit_deposit_ix(
    mint: &Pubkey,
    id: u64,
    proposer_token_account: &Pubkey,
    forfeit_destination: &Pubkey,
) -> Instruction {
    let (governance_config, _) = governance_config_pda();
    let (deposit_vault, _) = deposit_vault_pda();
    let (proposal, _) = proposal_pda(id);
    let data = instruction_data([85, 63, 214, 158, 230, 140, 62, 248], ());
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(governance_config, false),
            AccountMeta::new(deposit_vault, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new(*proposer_token_account, false),
            AccountMeta::new(*forfeit_destination, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

/// **Record-only** (OFS-4200 §6, this workspace's own documented scope
/// note): marks `proposal.executed = true` once `Accepted` and
/// `category == Parameter`; does not perform a live cross-program
/// mutation — see the on-chain instruction's own doc comment for why.
pub fn update_config_parameter_ix(
    id: u64,
    target_program: Pubkey,
    parameter_key: String,
    new_value: u64,
) -> Instruction {
    let (proposal, _) = proposal_pda(id);
    let data = instruction_data(
        [126, 60, 74, 140, 2, 137, 230, 61],
        (target_program, parameter_key, new_value),
    );
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &data,
        vec![AccountMeta::new(proposal, false)],
    )
}

/// **Record-only** (same scope note as `update_config_parameter_ix`):
/// marks `proposal.executed = true` once `Accepted` and
/// `category == Treasury`; does not disburse funds.
pub fn authorize_treasury_spend_ix(id: u64, destination: Pubkey, amount: u64) -> Instruction {
    let (proposal, _) = proposal_pda(id);
    let data = instruction_data(
        [248, 111, 88, 252, 136, 223, 53, 172],
        (destination, amount),
    );
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &data,
        vec![AccountMeta::new(proposal, false)],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proposal_pda_uses_the_documented_seeds() {
        let (expected, _) = Pubkey::find_program_address(
            &[b"proposal", &9u64.to_le_bytes()],
            &GOVERNANCE_PROGRAM_ID,
        );
        assert_eq!(proposal_pda(9).0, expected);
    }

    #[test]
    fn vote_record_pda_is_keyed_by_proposal_and_voter_only_not_role() {
        let proposal = Pubkey::new_unique();
        let voter = Pubkey::new_unique();
        let (expected, _) = Pubkey::find_program_address(
            &[b"vote", proposal.as_ref(), voter.as_ref()],
            &GOVERNANCE_PROGRAM_ID,
        );
        assert_eq!(vote_record_pda(&proposal, &voter).0, expected);
    }

    #[test]
    fn governance_config_and_deposit_vault_are_singletons() {
        let (cfg, _) =
            Pubkey::find_program_address(&[b"governance_config"], &GOVERNANCE_PROGRAM_ID);
        let (vault, _) = Pubkey::find_program_address(&[b"deposit_vault"], &GOVERNANCE_PROGRAM_ID);
        assert_eq!(governance_config_pda().0, cfg);
        assert_eq!(deposit_vault_pda().0, vault);
    }

    /// Discriminators copy-pasted straight from
    /// `programs/target/idl/governance.json`.
    #[test]
    fn every_instruction_carries_its_real_idl_discriminator() {
        let admin = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let voter = Pubkey::new_unique();
        let cases: Vec<(Instruction, [u8; 8])> = vec![
            (
                initialize_governance_config_ix(
                    &admin,
                    &mint,
                    1_000_000_000,
                    400,
                    5_000,
                    6_600,
                    7_500,
                    700,
                    1_000,
                    &Pubkey::new_unique(),
                    172_800,
                ),
                [15, 40, 42, 141, 94, 104, 27, 201],
            ),
            (
                create_proposal_ix(
                    &admin,
                    &mint,
                    &Pubkey::new_unique(),
                    1,
                    ProposalCategory::Parameter,
                    [0u8; 32],
                    [0u8; 32],
                    604_800,
                ),
                [132, 116, 68, 174, 216, 160, 198, 22],
            ),
            (
                cast_vote_ix(&voter, 1, true, Role::Merchant),
                [20, 212, 15, 189, 69, 180, 69, 151],
            ),
            (
                tally_and_finalize_ix(1),
                [21, 190, 147, 204, 51, 17, 163, 150],
            ),
            (
                refund_or_forfeit_deposit_ix(
                    &mint,
                    1,
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                ),
                [85, 63, 214, 158, 230, 140, 62, 248],
            ),
            (
                update_config_parameter_ix(1, Pubkey::new_unique(), "fee_bps".to_string(), 20),
                [126, 60, 74, 140, 2, 137, 230, 61],
            ),
            (
                authorize_treasury_spend_ix(1, Pubkey::new_unique(), 1_000),
                [248, 111, 88, 252, 136, 223, 53, 172],
            ),
        ];
        for (ix, discriminator) in cases {
            assert_eq!(ix.program_id, GOVERNANCE_PROGRAM_ID);
            assert_eq!(&ix.data[..8], &discriminator[..]);
        }
    }

    #[test]
    fn cast_vote_reads_the_staking_programs_stake_account_not_a_governance_pda() {
        let voter = Pubkey::new_unique();
        let ix = cast_vote_ix(&voter, 1, true, Role::NodeOperator);
        let voter_stake_meta = &ix.accounts[3];
        let (expected, _) = staking::stake_account_pda(&voter, Role::NodeOperator);
        assert_eq!(voter_stake_meta.pubkey, expected);
        assert!(!voter_stake_meta.is_signer && !voter_stake_meta.is_writable);
    }

    #[test]
    fn tally_and_finalize_takes_only_the_proposal_account() {
        assert_eq!(tally_and_finalize_ix(5).accounts.len(), 1);
    }
}
