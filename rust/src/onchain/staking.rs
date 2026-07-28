//! `openfiat-staking` instruction builders (OFS-4200 §5). Discriminators
//! below are taken verbatim from `programs/target/idl/staking.json`,
//! cross-checked against that file instruction by instruction.
//!
//! PDA seeds mirror `programs/programs/staking/src/constants.rs`
//! exactly: `StakingConfig`, `stake_vault`, and `rewards_vault` are
//! singletons; a `StakeAccount` is keyed by `(owner, role)`.

use super::{Role, STAKING_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, instruction_data, system_program_id};
use borsh::BorshSerialize;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

const STAKING_CONFIG_SEED: &[u8] = b"staking_config";
const STAKE_VAULT_SEED: &[u8] = b"stake_vault";
const REWARDS_VAULT_SEED: &[u8] = b"rewards_vault";
const STAKE_ACCOUNT_SEED: &[u8] = b"stake";

/// `[STAKING_CONFIG_SEED]` — a singleton.
pub fn staking_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STAKING_CONFIG_SEED], &STAKING_PROGRAM_ID)
}

/// `[STAKE_VAULT_SEED]` — the single global vault for every role's stake.
pub fn stake_vault_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STAKE_VAULT_SEED], &STAKING_PROGRAM_ID)
}

/// `[REWARDS_VAULT_SEED]`.
pub fn rewards_vault_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[REWARDS_VAULT_SEED], &STAKING_PROGRAM_ID)
}

/// `[STAKE_ACCOUNT_SEED, owner, role_as_u8]` (OFS-4200 §5) — also
/// consumed by `crate::onchain::escrow::reveal_dispute_vote_ix` and
/// `crate::onchain::governance::cast_vote_ix`, both of which read a
/// `StakeAccount` owned by *this* program via `seeds::program`.
pub fn stake_account_pda(owner: &Pubkey, role: Role) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[STAKE_ACCOUNT_SEED, owner.as_ref(), &[role as u8]],
        &STAKING_PROGRAM_ID,
    )
}

#[derive(BorshSerialize)]
struct InitializeStakingConfigParams {
    min_stake: u64,
    min_stake_arbitrator: u64,
    unbonding_period_secs: i64,
    slash_bps: u16,
    slashing_authority: Pubkey,
    slash_destination: Pubkey,
    rewards_authority: Pubkey,
}

/// One-time singleton setup (admin-only).
#[allow(clippy::too_many_arguments)]
pub fn initialize_staking_config_ix(
    admin: &Pubkey,
    mint: &Pubkey,
    min_stake: u64,
    min_stake_arbitrator: u64,
    unbonding_period_secs: i64,
    slash_bps: u16,
    slashing_authority: &Pubkey,
    slash_destination: &Pubkey,
    rewards_authority: &Pubkey,
) -> Instruction {
    let (staking_config, _) = staking_config_pda();
    let (stake_vault, _) = stake_vault_pda();
    let (rewards_vault, _) = rewards_vault_pda();
    let data = instruction_data(
        [78, 164, 6, 115, 206, 48, 168, 105],
        InitializeStakingConfigParams {
            min_stake,
            min_stake_arbitrator,
            unbonding_period_secs,
            slash_bps,
            slashing_authority: *slashing_authority,
            slash_destination: *slash_destination,
            rewards_authority: *rewards_authority,
        },
    );
    Instruction::new_with_bytes(
        STAKING_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(staking_config, false),
            AccountMeta::new(stake_vault, false),
            AccountMeta::new(rewards_vault, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(super::RENT_SYSVAR_ID, false),
        ],
    )
}

pub fn initialize_stake_account_ix(owner: &Pubkey, role: Role) -> Instruction {
    let (stake_account, _) = stake_account_pda(owner, role);
    let data = instruction_data([184, 7, 155, 82, 149, 217, 185, 196], role);
    Instruction::new_with_bytes(
        STAKING_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*owner, true),
            AccountMeta::new(stake_account, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
    )
}

/// `from` is the owner's own token account funding the stake.
pub fn stake_ix(
    owner: &Pubkey,
    role: Role,
    mint: &Pubkey,
    from: &Pubkey,
    amount: u64,
) -> Instruction {
    let (staking_config, _) = staking_config_pda();
    let (stake_account, _) = stake_account_pda(owner, role);
    let (stake_vault, _) = stake_vault_pda();
    let data = instruction_data([206, 176, 202, 18, 200, 209, 179, 108], amount);
    Instruction::new_with_bytes(
        STAKING_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*owner, true),
            AccountMeta::new_readonly(staking_config, false),
            AccountMeta::new(stake_account, false),
            AccountMeta::new(stake_vault, false),
            AccountMeta::new(*from, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

/// Immediately reduces `effective_stake` while the tokens themselves
/// stay locked until `unbonding_release_at` (OFS-4100 §4).
pub fn request_unstake_ix(owner: &Pubkey, role: Role, amount: u64) -> Instruction {
    let (staking_config, _) = staking_config_pda();
    let (stake_account, _) = stake_account_pda(owner, role);
    let data = instruction_data([44, 154, 110, 253, 160, 202, 54, 34], amount);
    Instruction::new_with_bytes(
        STAKING_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*owner, true),
            AccountMeta::new_readonly(staking_config, false),
            AccountMeta::new(stake_account, false),
        ],
    )
}

/// Callable once `unbonding_release_at` has passed. `to` is the
/// destination token account.
pub fn withdraw_unstaked_ix(owner: &Pubkey, role: Role, mint: &Pubkey, to: &Pubkey) -> Instruction {
    let (staking_config, _) = staking_config_pda();
    let (stake_account, _) = stake_account_pda(owner, role);
    let (stake_vault, _) = stake_vault_pda();
    let data = instruction_data([19, 202, 68, 255, 216, 40, 205, 61], ());
    Instruction::new_with_bytes(
        STAKING_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*owner, true),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(staking_config, false),
            AccountMeta::new(stake_account, false),
            AccountMeta::new(stake_vault, false),
            AccountMeta::new(*to, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

/// Callable only by `StakingConfig.slashing_authority`. `destination`
/// must match `StakingConfig.slash_destination`.
pub fn slash_ix(
    slashing_authority: &Pubkey,
    mint: &Pubkey,
    owner: &Pubkey,
    role: Role,
    destination: &Pubkey,
    misconduct_code: u16,
) -> Instruction {
    let (staking_config, _) = staking_config_pda();
    let (stake_account, _) = stake_account_pda(owner, role);
    let (stake_vault, _) = stake_vault_pda();
    let data = instruction_data([204, 141, 18, 161, 8, 177, 92, 142], misconduct_code);
    Instruction::new_with_bytes(
        STAKING_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*slashing_authority, true),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(staking_config, false),
            AccountMeta::new(stake_account, false),
            AccountMeta::new(stake_vault, false),
            AccountMeta::new(*destination, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

/// Callable only by `StakingConfig.rewards_authority` (plan decision #4's
/// off-chain "reward cranker" — see that instruction's own doc comment
/// on-chain for why this program does no connectivity verification
/// itself).
pub fn distribute_reward_ix(
    rewards_authority: &Pubkey,
    owner: &Pubkey,
    role: Role,
    amount: u64,
) -> Instruction {
    let (staking_config, _) = staking_config_pda();
    let (stake_account, _) = stake_account_pda(owner, role);
    let data = instruction_data([135, 65, 136, 143, 108, 234, 198, 46], amount);
    Instruction::new_with_bytes(
        STAKING_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*rewards_authority, true),
            AccountMeta::new_readonly(staking_config, false),
            AccountMeta::new(stake_account, false),
        ],
    )
}

/// `to` is the destination token account for this owner's accrued
/// `pending_rewards`.
pub fn claim_rewards_ix(owner: &Pubkey, role: Role, mint: &Pubkey, to: &Pubkey) -> Instruction {
    let (staking_config, _) = staking_config_pda();
    let (stake_account, _) = stake_account_pda(owner, role);
    let (rewards_vault, _) = rewards_vault_pda();
    let data = instruction_data([4, 144, 132, 71, 116, 23, 151, 80], ());
    Instruction::new_with_bytes(
        STAKING_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*owner, true),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(staking_config, false),
            AccountMeta::new(stake_account, false),
            AccountMeta::new(rewards_vault, false),
            AccountMeta::new(*to, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stake_account_pda_uses_the_documented_seeds() {
        let owner = Pubkey::new_unique();
        let (expected, _) = Pubkey::find_program_address(
            &[b"stake", owner.as_ref(), &[Role::Arbitrator as u8]],
            &STAKING_PROGRAM_ID,
        );
        assert_eq!(stake_account_pda(&owner, Role::Arbitrator).0, expected);
    }

    #[test]
    fn staking_config_stake_vault_rewards_vault_are_singletons() {
        let (cfg, _) = Pubkey::find_program_address(&[b"staking_config"], &STAKING_PROGRAM_ID);
        let (stake_vault, _) = Pubkey::find_program_address(&[b"stake_vault"], &STAKING_PROGRAM_ID);
        let (rewards_vault, _) =
            Pubkey::find_program_address(&[b"rewards_vault"], &STAKING_PROGRAM_ID);
        assert_eq!(staking_config_pda().0, cfg);
        assert_eq!(stake_vault_pda().0, stake_vault);
        assert_eq!(rewards_vault_pda().0, rewards_vault);
    }

    /// Discriminators copy-pasted straight from
    /// `programs/target/idl/staking.json`.
    #[test]
    fn every_instruction_carries_its_real_idl_discriminator() {
        let admin = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let cases: Vec<(Instruction, [u8; 8])> = vec![
            (
                initialize_staking_config_ix(
                    &admin,
                    &mint,
                    1_000,
                    5_000,
                    604_800,
                    500,
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                ),
                [78, 164, 6, 115, 206, 48, 168, 105],
            ),
            (
                initialize_stake_account_ix(&owner, Role::Merchant),
                [184, 7, 155, 82, 149, 217, 185, 196],
            ),
            (
                stake_ix(&owner, Role::Merchant, &mint, &Pubkey::new_unique(), 100),
                [206, 176, 202, 18, 200, 209, 179, 108],
            ),
            (
                request_unstake_ix(&owner, Role::Merchant, 50),
                [44, 154, 110, 253, 160, 202, 54, 34],
            ),
            (
                withdraw_unstaked_ix(&owner, Role::Merchant, &mint, &Pubkey::new_unique()),
                [19, 202, 68, 255, 216, 40, 205, 61],
            ),
            (
                slash_ix(
                    &admin,
                    &mint,
                    &owner,
                    Role::Merchant,
                    &Pubkey::new_unique(),
                    1,
                ),
                [204, 141, 18, 161, 8, 177, 92, 142],
            ),
            (
                distribute_reward_ix(&admin, &owner, Role::Merchant, 10),
                [135, 65, 136, 143, 108, 234, 198, 46],
            ),
            (
                claim_rewards_ix(&owner, Role::Merchant, &mint, &Pubkey::new_unique()),
                [4, 144, 132, 71, 116, 23, 151, 80],
            ),
        ];
        for (ix, discriminator) in cases {
            assert_eq!(ix.program_id, STAKING_PROGRAM_ID);
            assert_eq!(&ix.data[..8], &discriminator[..]);
        }
    }

    #[test]
    fn initialize_stake_account_encodes_the_role_argument_as_a_single_byte() {
        let ix = initialize_stake_account_ix(&Pubkey::new_unique(), Role::OracleProvider);
        assert_eq!(ix.data.len(), 8 + 1, "discriminator + one u8 role tag");
        assert_eq!(ix.data[8], Role::OracleProvider as u8);
    }

    #[test]
    fn stake_account_accounts_match_the_idl_signer_and_writable_flags() {
        let ix = stake_ix(
            &Pubkey::new_unique(),
            Role::Merchant,
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            1,
        );
        assert_eq!(ix.accounts.len(), 7);
        assert!(ix.accounts[0].is_signer && !ix.accounts[0].is_writable); // owner
        assert!(!ix.accounts[1].is_signer && !ix.accounts[1].is_writable); // staking_config
        assert!(ix.accounts[2].is_writable); // stake_account
        assert!(ix.accounts[3].is_writable); // stake_vault
    }
}
