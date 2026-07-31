//! `openfiat-governance` instruction builders (OFS-4200 §6). Discriminators
//! below are taken verbatim from `programs/target/idl/governance.json`,
//! cross-checked against that file instruction by instruction.
//!
//! PDA seeds mirror `programs/programs/governance/src/constants.rs`
//! exactly: `GovernanceConfig`/`deposit_vault` are singletons, a
//! `Proposal` is keyed by `id`, a `VoteRecord` by `(proposal, voter)` —
//! its existence is itself the double-vote guard.

use super::{
    BanReason, GOVERNANCE_PROGRAM_ID, ProposalCategory, Role, TOKEN_2022_PROGRAM_ID,
    instruction_data, system_program_id,
};
use crate::onchain::staking;
use borsh::BorshSerialize;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

const GOVERNANCE_CONFIG_SEED: &[u8] = b"governance_config";
const DEPOSIT_VAULT_SEED: &[u8] = b"deposit_vault";
const PROPOSAL_SEED: &[u8] = b"proposal";
const VOTE_RECORD_SEED: &[u8] = b"vote";
const PROPOSAL_ACTION_SEED: &[u8] = b"proposal_action";
const EMERGENCY_AUTHORITY_SEED: &[u8] = b"emergency_authority";

/// What a proposal, if it passes, is authorized to *do* (OFS-4200 §6,
/// OFS-7100 §12.2) — `governance::state::GovernanceAction`.
///
/// This is what makes a governance vote able to cause a state change at
/// all. `list_wallet`/`delist_wallet` take no privileged signer; they
/// take a passed proposal whose action names the exact wallet, so the
/// action has to be fixed at creation time and is what
/// [`create_proposal_ix`] commits to.
///
/// Variant order must match `governance::state::GovernanceAction` —
/// Borsh tags an enum with its declaration index, and a reordered copy
/// here would encode "delist" where the program reads "list".
#[derive(BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum GovernanceAction {
    /// No on-chain effect. Informational proposals, and the categories
    /// whose execution instructions are still record-only.
    None,
    ListWallet {
        wallet: Pubkey,
        reason: BanReason,
        evidence_hash: [u8; 32],
    },
    DelistWallet {
        wallet: Pubkey,
    },
}

/// `[EMERGENCY_AUTHORITY_SEED]` — the singleton holding AllenHark's
/// first-year exception and the timestamp it expires at (OFS-4100 §5.1).
///
/// Read-only to every instruction except the two that create it, which
/// is precisely what makes the deadline non-extendable: there is no
/// transaction anyone can send that moves `expires_at`.
pub fn emergency_authority_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[EMERGENCY_AUTHORITY_SEED], &GOVERNANCE_PROGRAM_ID)
}

/// `[PROPOSAL_ACTION_SEED, proposal]` — one action per proposal, and one
/// proposal per action. That binding is what stops a passed vote to ban
/// wallet A being redeemed against wallet B.
pub fn proposal_action_pda(proposal: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PROPOSAL_ACTION_SEED, proposal.as_ref()],
        &GOVERNANCE_PROGRAM_ID,
    )
}

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
            // Created here too, so a fresh deployment's sunset clock
            // starts at governance genesis. It takes no parameters,
            // which is why this signature is unchanged.
            AccountMeta::new(emergency_authority_pda().0, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(super::RENT_SYSVAR_ID, false),
        ],
    )
}

#[derive(BorshSerialize)]
struct UpdateGovernanceConfigParams {
    total_open_supply: u64,
    quorum_bps: u16,
    threshold_simple_bps: u16,
    threshold_treasury_bps: u16,
    threshold_upgrade_bps: u16,
    quorum_upgrade_bps: u16,
    deposit_amount: u64,
    vote_lock_secs: i64,
}

/// Corrects the singleton config (admin-only).
///
/// `forfeit_destination` is an *account* here, not a param as it is on
/// `initialize_governance_config_ix` — the program takes it that way so a
/// wallet address cannot be stored where a token account is required. The
/// deployed config held exactly that mistake, which left
/// `refund_or_forfeit_deposit` unable to load its accounts at all. The
/// mint must equal the one recorded on the config.
#[allow(clippy::too_many_arguments)]
pub fn update_governance_config_ix(
    admin: &Pubkey,
    mint: &Pubkey,
    forfeit_destination: &Pubkey,
    total_open_supply: u64,
    quorum_bps: u16,
    threshold_simple_bps: u16,
    threshold_treasury_bps: u16,
    threshold_upgrade_bps: u16,
    quorum_upgrade_bps: u16,
    deposit_amount: u64,
    vote_lock_secs: i64,
) -> Instruction {
    let (governance_config, _) = governance_config_pda();
    let data = instruction_data(
        [140, 45, 181, 17, 77, 67, 157, 248],
        UpdateGovernanceConfigParams {
            total_open_supply,
            quorum_bps,
            threshold_simple_bps,
            threshold_treasury_bps,
            threshold_upgrade_bps,
            quorum_upgrade_bps,
            deposit_amount,
            vote_lock_secs,
        },
    );
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(governance_config, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(*forfeit_destination, false),
            // Read-only. Past its `expires_at` the program refuses any
            // change to `vote_lock_secs` — OFS-4100 §5.1's sunset on the
            // delay power. Every other field stays writable forever.
            AccountMeta::new_readonly(emergency_authority_pda().0, false),
        ],
    )
}

/// Starts AllenHark's first-year governance exception on a deployment
/// whose `GovernanceConfig` predates it (OFS-4100 §5.1, OFS-4200 §6.2).
///
/// Permissionless and parameterless, and both on purpose. With no
/// arguments there is nothing a caller can pass that lengthens the window
/// — the holders are compiled into the program and the deadline is
/// `now + one year` — so the only thing this influences is *when* the
/// clock starts, which can only bring the deadline nearer. Permissionless
/// means no key can withhold the start in order to keep the expiry
/// perpetually ahead of itself.
///
/// Callable exactly once per deployment: it `init`s the account, so a
/// second call fails. A fresh deployment never needs it, since
/// [`initialize_governance_config_ix`] creates the same account.
///
/// `payer` funds rent and gains nothing by paying it.
pub fn initialize_emergency_authority_ix(payer: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &[93, 231, 250, 142, 49, 224, 152, 213],
        vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(emergency_authority_pda().0, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
    )
}

/// Declares which off-chain proposal this on-chain one is the chain-side
/// half of (OFS-4200 §6.1).
///
/// `offchain_id_hash` is the **SHA-256 of the off-chain proposal id's
/// UTF-8 bytes** — nothing else matches. The off-chain proposal must
/// already name this proposal's `id` in its own signed `ProposalCreate`
/// event: the link is two reciprocal claims, and a node holding only one
/// reports it as unreciprocated rather than joining the records.
/// Publishing one side without the other achieves nothing.
///
/// Proposer-only, `Voting`-only, and write-once. An all-zero digest is
/// refused by the program, because that value is its "nothing claimed"
/// sentinel and storing it would spend the single write while leaving
/// the proposal looking unlinked forever.
pub fn link_offchain_proposal_ix(
    proposer: &Pubkey,
    proposal_id: u64,
    offchain_id_hash: [u8; 32],
) -> Instruction {
    let (proposal, _) = proposal_pda(proposal_id);
    let mut data = Vec::with_capacity(40);
    data.extend_from_slice(&[175, 29, 244, 214, 83, 241, 103, 128]);
    data.extend_from_slice(&offchain_id_hash);
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*proposer, true),
            AccountMeta::new(proposal, false),
        ],
    )
}

/// `from` is the proposer's own token account funding the stake deposit
/// (`GovernanceConfig.deposit_amount`, refunded or forfeited once
/// `tally_and_finalize` runs).
///
/// `action` is what the proposal will be entitled to do if it passes,
/// and it is fixed here — there is no instruction that attaches or
/// changes one later. That is deliberate on-chain: an action that could
/// be added after voting opened would let a proposer gather votes on one
/// thing and spend them on another. A [`GovernanceAction::ListWallet`]
/// or [`GovernanceAction::DelistWallet`] must be proposed under
/// [`ProposalCategory::Standards`]; the program rejects any other
/// category, so listing and delisting face an identical bar.
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
    action: GovernanceAction,
) -> Instruction {
    let (governance_config, _) = governance_config_pda();
    let (deposit_vault, _) = deposit_vault_pda();
    let (proposal, _) = proposal_pda(id);
    let (proposal_action, _) = proposal_action_pda(&proposal);
    let data = instruction_data(
        [132, 116, 68, 174, 216, 160, 198, 22],
        (
            id,
            category,
            title_hash,
            summary_hash,
            voting_period_secs,
            action,
        ),
    );
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*proposer, true),
            AccountMeta::new_readonly(super::ban_record_pda(proposer).0, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(governance_config, false),
            AccountMeta::new(deposit_vault, false),
            AccountMeta::new(*from, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new(proposal_action, false),
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
    let (staking_config, _) = staking::staking_config_pda();
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
            // `cast_vote` reads `StakingConfig` for the role's minimum
            // stake, so a balance that has fallen below it carries no
            // weight. This account was missing here and the builder
            // produced an instruction the program could not accept.
            AccountMeta::new_readonly(staking_config, false),
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

/// Adds a wallet to the protocol-wide ban list (OFS-7100 §12) by
/// executing a proposal that has already passed.
///
/// One instruction closes deposit access across `escrow`, `staking`,
/// `presale` and `governance` at once — those programs read the record
/// this creates rather than being separately notified, and no
/// application can opt out.
///
/// # The authority is the vote
///
/// There is no privileged signer. `proposal_id` must name a proposal
/// that is `Accepted`, met quorum, has not been executed, is past its
/// `vote_lock_secs` execution timelock, and whose `GovernanceAction`
/// names **this** wallet. `GovernanceConfig.admin` is not read.
///
/// `submitter` signs and pays the `BanRecord`'s rent, and that is all it
/// does — any funded key will do. The reason and evidence hash are read
/// from the proposal, not passed here, so the party who submits cannot
/// record grounds the voters never agreed to.
///
/// Earlier versions of this builder took an `admin` and the reason and
/// evidence as arguments, because the program checked a single key. That
/// meant one key could deny any wallet deposit access to the entire
/// protocol. It no longer can.
pub fn list_wallet_ix(submitter: &Pubkey, proposal_id: u64, wallet: &Pubkey) -> Instruction {
    let (governance_config, _) = governance_config_pda();
    let (proposal, _) = proposal_pda(proposal_id);
    let (proposal_action, _) = proposal_action_pda(&proposal);
    let (ban_record, _) = super::ban_record_pda(wallet);
    let data = instruction_data([176, 149, 148, 11, 126, 182, 162, 248], wallet.to_bytes());
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*submitter, true),
            AccountMeta::new_readonly(governance_config, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(proposal_action, false),
            AccountMeta::new(ban_record, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
    )
}

/// Removes a wallet from the ban list, restoring deposit access
/// protocol-wide (OFS-7100 §12.2), by executing a passed proposal.
///
/// Mandatory rather than optional: once rejection is protocol-wide an
/// erroneous listing costs a wallet all protocol access, so the reversal
/// path has to be as available as the exclusion path. It runs through
/// the identical mechanism as [`list_wallet_ix`] — same guard, same
/// category, same absence of a privileged signer — because an authority
/// that could exclude but not readmit is the failure §12.2 names. The
/// closed record's rent goes to whoever submits.
pub fn delist_wallet_ix(submitter: &Pubkey, proposal_id: u64, wallet: &Pubkey) -> Instruction {
    let (governance_config, _) = governance_config_pda();
    let (proposal, _) = proposal_pda(proposal_id);
    let (proposal_action, _) = proposal_action_pda(&proposal);
    let (ban_record, _) = super::ban_record_pda(wallet);
    let data = instruction_data([40, 136, 186, 228, 254, 114, 109, 134], wallet.to_bytes());
    Instruction::new_with_bytes(
        GOVERNANCE_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*submitter, true),
            AccountMeta::new_readonly(governance_config, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(proposal_action, false),
            AccountMeta::new(ban_record, false),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// OFS-4100 §5.1's sunset is enforced against this account, so an
    /// instruction that omitted it would be rejected by the program —
    /// and a builder that placed it anywhere but last would send the
    /// program somebody else's account under its name.
    #[test]
    fn config_instructions_carry_the_emergency_authority_the_sunset_is_read_from() {
        let admin = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let destination = Pubkey::new_unique();
        let (emergency_authority, _) = emergency_authority_pda();

        let update = update_governance_config_ix(
            &admin,
            &mint,
            &destination,
            1_000_000,
            1_000,
            5_000,
            6_000,
            6_600,
            2_000,
            5_000,
            604_800,
        );
        let last = update.accounts.last().expect("accounts are not empty");
        assert_eq!(last.pubkey, emergency_authority);
        assert!(
            !last.is_writable,
            "the sunset must be read, never written — a writable reference here would be a \
             path to moving the deadline"
        );

        let initialize = initialize_governance_config_ix(
            &admin,
            &mint,
            1_000_000,
            1_000,
            5_000,
            6_000,
            6_600,
            2_000,
            5_000,
            &destination,
            604_800,
        );
        let position = initialize
            .accounts
            .iter()
            .position(|account| account.pubkey == emergency_authority)
            .expect("a fresh deployment must create the sunset alongside the config");
        assert_eq!(
            position, 4,
            "account order is positional; the program reads slot 4 as the emergency authority"
        );
        assert!(
            initialize.accounts[position].is_writable,
            "init writes it once"
        );
    }

    /// The digest is the join key, and it is fixed-width by definition.
    /// A short or long one would be silently truncated or overrun by the
    /// program's Borsh decoder, producing a link nothing ever matches.
    #[test]
    fn a_link_carries_exactly_the_thirty_two_byte_digest() {
        let ix = link_offchain_proposal_ix(&Pubkey::new_unique(), 42, [9u8; 32]);
        assert_eq!(ix.data.len(), 8 + 32);
        assert_eq!(&ix.data[8..], &[9u8; 32]);
        assert_eq!(ix.accounts[1].pubkey, proposal_pda(42).0);
        assert!(
            ix.accounts[0].is_signer && !ix.accounts[0].is_writable,
            "the proposer signs; it is not the account being written"
        );
    }

    #[test]
    fn update_governance_config_takes_the_destination_as_an_account() {
        let admin = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let forfeit_destination = Pubkey::new_unique();
        let ix = update_governance_config_ix(
            &admin,
            &mint,
            &forfeit_destination,
            1_000_000_000,
            1_000,
            5_001,
            6_000,
            6_600,
            2_000,
            5_000,
            604_800,
        );
        assert_eq!(ix.program_id, GOVERNANCE_PROGRAM_ID);
        assert_eq!(&ix.data[..8], &[140, 45, 181, 17, 77, 67, 157, 248]);

        let (governance_config, _) = governance_config_pda();
        // The emergency authority joined this list when OFS-4100 §5.1's
        // sunset started being enforced here — read-only, and last.
        let expected = [
            admin,
            governance_config,
            mint,
            forfeit_destination,
            emergency_authority_pda().0,
        ];
        let actual: Vec<Pubkey> = ix.accounts.iter().map(|a| a.pubkey).collect();
        assert_eq!(actual, expected);
        // Only the admin signs; the destination rides along as a plain
        // account so the program can type-check it.
        assert!(ix.accounts[0].is_signer);
        assert!(!ix.accounts[3].is_signer);
        assert!(!ix.accounts[3].is_writable);

        // 8 discriminator + u64 + 5×u16 + u64 + i64.
        assert_eq!(ix.data.len(), 8 + 8 + 10 + 8 + 8);
    }

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
                    GovernanceAction::None,
                ),
                [132, 116, 68, 174, 216, 160, 198, 22],
            ),
            (
                cast_vote_ix(&voter, 1, true, Role::Merchant),
                [20, 212, 15, 189, 69, 180, 69, 151],
            ),
            (
                list_wallet_ix(&admin, 1, &voter),
                [176, 149, 148, 11, 126, 182, 162, 248],
            ),
            (
                delist_wallet_ix(&admin, 1, &voter),
                [40, 136, 186, 228, 254, 114, 109, 134],
            ),
            (
                tally_and_finalize_ix(1),
                [21, 190, 147, 204, 51, 17, 163, 150],
            ),
            (
                initialize_emergency_authority_ix(&admin),
                [93, 231, 250, 142, 49, 224, 152, 213],
            ),
            (
                link_offchain_proposal_ix(&admin, 1, [7u8; 32]),
                [175, 29, 244, 214, 83, 241, 103, 128],
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
        let voter_stake_meta = &ix.accounts[4];
        let (expected, _) = staking::stake_account_pda(&voter, Role::NodeOperator);
        assert_eq!(voter_stake_meta.pubkey, expected);
        assert!(!voter_stake_meta.is_signer && !voter_stake_meta.is_writable);
    }

    #[test]
    fn cast_vote_carries_the_staking_config_the_program_reads_the_role_minimum_from() {
        // This account was absent from the builder, which made every
        // `cast_vote` it produced unsendable: Anchor deserializes the
        // accounts positionally, so a missing one shifts everything
        // after it. The assertion is on the position as well as the
        // address, because that is what actually went wrong.
        let voter = Pubkey::new_unique();
        let ix = cast_vote_ix(&voter, 1, true, Role::NodeOperator);
        let (staking_config, _) = staking::staking_config_pda();
        assert_eq!(ix.accounts[3].pubkey, staking_config);
        assert!(!ix.accounts[3].is_signer && !ix.accounts[3].is_writable);
        assert_eq!(ix.accounts.len(), 7);
    }

    #[test]
    fn tally_and_finalize_takes_only_the_proposal_account() {
        assert_eq!(tally_and_finalize_ix(5).accounts.len(), 1);
    }

    #[test]
    fn ban_record_pda_uses_the_documented_seeds() {
        // The enforcing programs in escrow/staking/presale re-derive
        // exactly this on-chain from their own signer's key, so a client
        // that got the seed or the owning program wrong would build
        // instructions that fail with ConstraintSeeds — never ones that
        // slip past the ban.
        let wallet = Pubkey::new_unique();
        let (expected, _) =
            Pubkey::find_program_address(&[b"ban", wallet.as_ref()], &GOVERNANCE_PROGRAM_ID);
        assert_eq!(super::super::ban_record_pda(&wallet).0, expected);
    }

    #[test]
    fn list_wallet_carries_a_proposal_and_its_action_and_no_authority() {
        // The property that matters: nothing in this instruction is a
        // key with standing. The only signer is the rent payer, and the
        // two accounts that decide whether it succeeds are the proposal
        // and the action the vote fixed to it.
        let submitter = Pubkey::new_unique();
        let wallet = Pubkey::new_unique();
        let ix = list_wallet_ix(&submitter, 42, &wallet);

        assert_eq!(&ix.data[8..40], wallet.as_ref());
        assert_eq!(ix.data.len(), 8 + 32);

        let (governance_config, _) = governance_config_pda();
        let (proposal, _) = proposal_pda(42);
        let (proposal_action, _) = proposal_action_pda(&proposal);
        let (ban_record, _) = super::super::ban_record_pda(&wallet);
        let actual: Vec<Pubkey> = ix.accounts.iter().map(|a| a.pubkey).collect();
        assert_eq!(
            actual,
            [
                submitter,
                governance_config,
                proposal,
                proposal_action,
                ban_record,
                system_program_id()
            ]
        );
        // The proposal is spent (`executed = true`) and the record is
        // created, so both are writable; the config is read only for
        // `vote_lock_secs`, and the action is never written at all.
        assert!(ix.accounts[0].is_signer);
        assert!(ix.accounts[2].is_writable);
        assert!(ix.accounts[4].is_writable);
        assert!(!ix.accounts[1].is_writable);
        assert!(!ix.accounts[3].is_writable);
    }

    #[test]
    fn delist_targets_the_same_address_listing_created() {
        // §12.2 requires delisting to be possible at all. The two
        // builders agreeing on the address is what makes it possible in
        // practice — a mismatch would leave a wallet listed forever with
        // a delist instruction that always failed.
        let submitter = Pubkey::new_unique();
        let wallet = Pubkey::new_unique();
        let listed = list_wallet_ix(&submitter, 1, &wallet);
        let delisted = delist_wallet_ix(&submitter, 2, &wallet);

        assert_eq!(delisted.accounts[4].pubkey, listed.accounts[4].pubkey);
        assert_eq!(&delisted.data[8..40], wallet.as_ref());
        assert_eq!(delisted.data.len(), 8 + 32);
        assert!(delisted.accounts[0].is_signer);
    }

    #[test]
    fn listing_and_delisting_take_the_same_shape_of_authority() {
        // An exclusion power wider than the readmission power is the
        // failure OFS-7100 §12.2 names. Both builders taking a proposal,
        // its action, and a signer with no constraint on it is what
        // keeps them the same width.
        let submitter = Pubkey::new_unique();
        let wallet = Pubkey::new_unique();
        let listed = list_wallet_ix(&submitter, 7, &wallet);
        let delisted = delist_wallet_ix(&submitter, 7, &wallet);

        let shape = |ix: &Instruction| -> Vec<(Pubkey, bool, bool)> {
            ix.accounts
                .iter()
                .take(4)
                .map(|a| (a.pubkey, a.is_signer, a.is_writable))
                .collect()
        };
        assert_eq!(shape(&listed), shape(&delisted));
    }

    #[test]
    fn create_proposal_carries_the_proposers_own_ban_address_and_the_action_pda() {
        // Not any ban address: the program derives this one from the
        // signer's key. Passing someone else's — even a real, empty ban
        // PDA — is rejected, which is the whole security property.
        let proposer = Pubkey::new_unique();
        let wallet = Pubkey::new_unique();
        let ix = create_proposal_ix(
            &proposer,
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            1,
            ProposalCategory::Standards,
            [0u8; 32],
            [0u8; 32],
            604_800,
            GovernanceAction::ListWallet {
                wallet,
                reason: BanReason::Sanctions,
                evidence_hash: [7u8; 32],
            },
        );
        assert_eq!(
            ix.accounts[1].pubkey,
            super::super::ban_record_pda(&proposer).0
        );
        assert!(!ix.accounts[1].is_writable && !ix.accounts[1].is_signer);

        // The action account is created here and nowhere else — the
        // action a proposal may perform is fixed before the first vote.
        let (proposal, _) = proposal_pda(1);
        assert_eq!(ix.accounts[7].pubkey, proposal_action_pda(&proposal).0);
        assert!(ix.accounts[7].is_writable);

        // 8 discriminator + u64 + category tag + 2×32 hashes + i64,
        // then the action: variant tag + pubkey + reason tag + 32.
        let action_offset = 8 + 8 + 1 + 32 + 32 + 8;
        assert_eq!(ix.data[action_offset], 1); // ListWallet is variant 1
        assert_eq!(
            &ix.data[action_offset + 1..action_offset + 33],
            wallet.as_ref()
        );
        assert_eq!(ix.data[action_offset + 33], 1); // Sanctions
        assert_eq!(&ix.data[action_offset + 34..], &[7u8; 32]);
    }

    #[test]
    fn a_none_action_encodes_as_a_single_tag_byte() {
        let ix = create_proposal_ix(
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            3,
            ProposalCategory::Parameter,
            [0u8; 32],
            [0u8; 32],
            60,
            GovernanceAction::None,
        );
        assert_eq!(ix.data.len(), 8 + 8 + 1 + 32 + 32 + 8 + 1);
        assert_eq!(*ix.data.last().unwrap(), 0);
    }
}
