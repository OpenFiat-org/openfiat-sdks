//! `openfiat-escrow` instruction builders (OFS-4200 §4, Phase 4b's
//! dispute-to-chain bridge). Discriminators below are taken verbatim
//! from `programs/target/idl/escrow.json`, cross-checked against that
//! file instruction by instruction — not recomputed by hand.
//!
//! PDA seeds mirror `programs/programs/escrow/src/constants.rs` exactly:
//! `LiquidityVault`/its token vault key off `(merchant, mint)`,
//! `TradeEscrowVault`/its token vault and `DisputeCase` key off
//! `reservation_id`, `FeeConfig` is a singleton.

use super::{
    DisputeOutcome, ESCROW_PROGRAM_ID, RENT_SYSVAR_ID, TOKEN_2022_PROGRAM_ID, instruction_data,
    system_program_id,
};
use crate::onchain::staking;
use borsh::BorshSerialize;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

const LIQUIDITY_VAULT_SEED: &[u8] = b"liquidity_vault";
const LIQUIDITY_VAULT_TOKENS_SEED: &[u8] = b"liquidity_vault_tokens";
const TRADE_ESCROW_SEED: &[u8] = b"trade_escrow";
const TRADE_ESCROW_TOKENS_SEED: &[u8] = b"trade_escrow_tokens";
const FEE_CONFIG_SEED: &[u8] = b"fee_config";
const DISPUTE_CASE_SEED: &[u8] = b"dispute_case";

/// `[LIQUIDITY_VAULT_SEED, merchant, mint]`.
pub fn liquidity_vault_pda(merchant: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[LIQUIDITY_VAULT_SEED, merchant.as_ref(), mint.as_ref()],
        &ESCROW_PROGRAM_ID,
    )
}

/// `[LIQUIDITY_VAULT_TOKENS_SEED, merchant, mint]`.
pub fn liquidity_vault_tokens_pda(merchant: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            LIQUIDITY_VAULT_TOKENS_SEED,
            merchant.as_ref(),
            mint.as_ref(),
        ],
        &ESCROW_PROGRAM_ID,
    )
}

/// `[TRADE_ESCROW_SEED, reservation_id.to_le_bytes()]`.
pub fn trade_escrow_pda(reservation_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[TRADE_ESCROW_SEED, &reservation_id.to_le_bytes()],
        &ESCROW_PROGRAM_ID,
    )
}

/// `[TRADE_ESCROW_TOKENS_SEED, reservation_id.to_le_bytes()]`.
pub fn trade_escrow_tokens_pda(reservation_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[TRADE_ESCROW_TOKENS_SEED, &reservation_id.to_le_bytes()],
        &ESCROW_PROGRAM_ID,
    )
}

/// `[FEE_CONFIG_SEED]` — a singleton.
pub fn fee_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[FEE_CONFIG_SEED], &ESCROW_PROGRAM_ID)
}

/// `[DISPUTE_CASE_SEED, reservation_id.to_le_bytes()]`.
pub fn dispute_case_pda(reservation_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[DISPUTE_CASE_SEED, &reservation_id.to_le_bytes()],
        &ESCROW_PROGRAM_ID,
    )
}

#[derive(BorshSerialize)]
struct InitializeFeeConfigParams {
    ad_listing_fee: u64,
    dispute_filing_fee: u64,
    settlement_fee_bps: u16,
    dev_treasury: Pubkey,
    ecosystem_treasury: Pubkey,
    infra_treasury: Pubkey,
    emergency_reserve: Pubkey,
    dev_treasury_bps: u16,
    ecosystem_treasury_bps: u16,
    infra_treasury_bps: u16,
    emergency_reserve_bps: u16,
    timeout_secs: i64,
}

#[derive(BorshSerialize)]
struct UpdateFeeConfigParams {
    ad_listing_fee: u64,
    dispute_filing_fee: u64,
    settlement_fee_bps: u16,
    dev_treasury_bps: u16,
    ecosystem_treasury_bps: u16,
    infra_treasury_bps: u16,
    emergency_reserve_bps: u16,
    timeout_secs: i64,
}

/// Corrects the singleton `FeeConfig` after initialization (admin-only).
///
/// Unlike `initialize_fee_config_ix`, the treasuries are **accounts**, not
/// params: the program takes them as `TokenAccount`s constrained to `mint`,
/// so a wallet address cannot be stored where a token account is required.
/// That is deliberate — the devnet config was originally initialized with
/// treasury owner wallets, which made every `release_escrow` unexecutable.
#[allow(clippy::too_many_arguments)]
pub fn update_fee_config_ix(
    admin: &Pubkey,
    mint: &Pubkey,
    dev_treasury: &Pubkey,
    ecosystem_treasury: &Pubkey,
    infra_treasury: &Pubkey,
    emergency_reserve: &Pubkey,
    ad_listing_fee: u64,
    dispute_filing_fee: u64,
    settlement_fee_bps: u16,
    dev_treasury_bps: u16,
    ecosystem_treasury_bps: u16,
    infra_treasury_bps: u16,
    emergency_reserve_bps: u16,
    timeout_secs: i64,
) -> Instruction {
    let (fee_config, _) = fee_config_pda();
    let data = instruction_data(
        [104, 184, 103, 242, 88, 151, 107, 20],
        UpdateFeeConfigParams {
            ad_listing_fee,
            dispute_filing_fee,
            settlement_fee_bps,
            dev_treasury_bps,
            ecosystem_treasury_bps,
            infra_treasury_bps,
            emergency_reserve_bps,
            timeout_secs,
        },
    );
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(fee_config, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(*dev_treasury, false),
            AccountMeta::new_readonly(*ecosystem_treasury, false),
            AccountMeta::new_readonly(*infra_treasury, false),
            AccountMeta::new_readonly(*emergency_reserve, false),
        ],
    )
}

/// One-time singleton setup (admin-only). `dev_treasury`/`ecosystem_treasury`/
/// `infra_treasury`/`emergency_reserve` are plain external SPL token
/// accounts, not PDAs this program owns — the caller creates and
/// controls them.
#[allow(clippy::too_many_arguments)]
pub fn initialize_fee_config_ix(
    admin: &Pubkey,
    ad_listing_fee: u64,
    dispute_filing_fee: u64,
    settlement_fee_bps: u16,
    dev_treasury: &Pubkey,
    ecosystem_treasury: &Pubkey,
    infra_treasury: &Pubkey,
    emergency_reserve: &Pubkey,
    dev_treasury_bps: u16,
    ecosystem_treasury_bps: u16,
    infra_treasury_bps: u16,
    emergency_reserve_bps: u16,
    timeout_secs: i64,
) -> Instruction {
    let (fee_config, _) = fee_config_pda();
    let data = instruction_data(
        [62, 162, 20, 133, 121, 65, 145, 27],
        InitializeFeeConfigParams {
            ad_listing_fee,
            dispute_filing_fee,
            settlement_fee_bps,
            dev_treasury: *dev_treasury,
            ecosystem_treasury: *ecosystem_treasury,
            infra_treasury: *infra_treasury,
            emergency_reserve: *emergency_reserve,
            dev_treasury_bps,
            ecosystem_treasury_bps,
            infra_treasury_bps,
            emergency_reserve_bps,
            timeout_secs,
        },
    );
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(fee_config, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
    )
}

pub fn create_liquidity_vault_ix(merchant: &Pubkey, mint: &Pubkey) -> Instruction {
    let (liquidity_vault, _) = liquidity_vault_pda(merchant, mint);
    let (token_vault, _) = liquidity_vault_tokens_pda(merchant, mint);
    let data = instruction_data([204, 255, 106, 205, 72, 186, 252, 83], ());
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*merchant, true),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(liquidity_vault, false),
            AccountMeta::new(token_vault, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(RENT_SYSVAR_ID, false),
        ],
    )
}

/// `from` is the merchant's own token account funding the deposit.
pub fn deposit_liquidity_ix(
    merchant: &Pubkey,
    mint: &Pubkey,
    from: &Pubkey,
    amount: u64,
) -> Instruction {
    let (liquidity_vault, _) = liquidity_vault_pda(merchant, mint);
    let (token_vault, _) = liquidity_vault_tokens_pda(merchant, mint);
    let data = instruction_data([245, 99, 59, 25, 151, 71, 233, 249], amount);
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*merchant, true),
            AccountMeta::new(liquidity_vault, false),
            AccountMeta::new(token_vault, false),
            AccountMeta::new(*from, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

/// Marking-only — no token movement (see the on-chain instruction's own
/// doc comment on why this requires the merchant's signature).
pub fn reserve_liquidity_ix(merchant: &Pubkey, mint: &Pubkey, amount: u64) -> Instruction {
    let (liquidity_vault, _) = liquidity_vault_pda(merchant, mint);
    let data = instruction_data([197, 37, 232, 60, 182, 38, 12, 84], amount);
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*merchant, true),
            AccountMeta::new(liquidity_vault, false),
        ],
    )
}

/// `to` is the destination token account the merchant withdraws into.
pub fn withdraw_liquidity_ix(
    merchant: &Pubkey,
    mint: &Pubkey,
    to: &Pubkey,
    amount: u64,
) -> Instruction {
    let (liquidity_vault, _) = liquidity_vault_pda(merchant, mint);
    let (token_vault, _) = liquidity_vault_tokens_pda(merchant, mint);
    let data = instruction_data([149, 158, 33, 185, 47, 243, 253, 31], amount);
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*merchant, true),
            AccountMeta::new(liquidity_vault, false),
            AccountMeta::new(token_vault, false),
            AccountMeta::new(*to, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

/// `buyer` is recorded verbatim, not a signer (OFS-2200's off-chain
/// Reservation Protocol already established their intent to trade).
pub fn create_trade_escrow_ix(
    merchant: &Pubkey,
    buyer: &Pubkey,
    mint: &Pubkey,
    reservation_id: u64,
    amount: u64,
    timeout_secs: i64,
) -> Instruction {
    let (liquidity_vault, _) = liquidity_vault_pda(merchant, mint);
    let (trade_escrow, _) = trade_escrow_pda(reservation_id);
    let (token_vault, _) = trade_escrow_tokens_pda(reservation_id);
    let data = instruction_data(
        [149, 181, 111, 61, 122, 174, 71, 51],
        (reservation_id, amount, timeout_secs),
    );
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*merchant, true),
            AccountMeta::new_readonly(*buyer, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(liquidity_vault, false),
            AccountMeta::new(trade_escrow, false),
            AccountMeta::new(token_vault, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(RENT_SYSVAR_ID, false),
        ],
    )
}

pub fn fund_trade_escrow_ix(merchant: &Pubkey, mint: &Pubkey, reservation_id: u64) -> Instruction {
    let (liquidity_vault, _) = liquidity_vault_pda(merchant, mint);
    let (liquidity_token_vault, _) = liquidity_vault_tokens_pda(merchant, mint);
    let (trade_escrow, _) = trade_escrow_pda(reservation_id);
    let (trade_escrow_token_vault, _) = trade_escrow_tokens_pda(reservation_id);
    let data = instruction_data([148, 177, 67, 164, 227, 76, 173, 101], ());
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*merchant, true),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(liquidity_vault, false),
            AccountMeta::new(liquidity_token_vault, false),
            AccountMeta::new(trade_escrow, false),
            AccountMeta::new(trade_escrow_token_vault, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

/// OFS-2300 §15: records the merchant's approval; `release_escrow` is
/// the only instruction that actually moves funds.
pub fn approve_settlement_ix(merchant: &Pubkey, reservation_id: u64) -> Instruction {
    let (trade_escrow, _) = trade_escrow_pda(reservation_id);
    let data = instruction_data([186, 5, 15, 163, 23, 10, 142, 12], ());
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*merchant, true),
            AccountMeta::new(trade_escrow, false),
        ],
    )
}

/// Permissionless once `approve_settlement` has run (OFS-2300 §16) — no
/// signer-typed account of its own; the caller's transaction still needs
/// *a* fee payer, handled at the `Message`/`Transaction` level, not here.
/// `seller` and `buyer_token_account` must already be known by the
/// caller (e.g. from the trade's own off-chain record); the four
/// treasury accounts must match `FeeConfig`'s recorded addresses.
#[allow(clippy::too_many_arguments)]
pub fn release_escrow_ix(
    seller: &Pubkey,
    mint: &Pubkey,
    reservation_id: u64,
    buyer_token_account: &Pubkey,
    dev_treasury: &Pubkey,
    ecosystem_treasury: &Pubkey,
    infra_treasury: &Pubkey,
    emergency_reserve: &Pubkey,
) -> Instruction {
    let (liquidity_vault, _) = liquidity_vault_pda(seller, mint);
    let (trade_escrow, _) = trade_escrow_pda(reservation_id);
    let (trade_escrow_token_vault, _) = trade_escrow_tokens_pda(reservation_id);
    let (fee_config, _) = fee_config_pda();
    let data = instruction_data([146, 253, 129, 233, 20, 145, 181, 206], ());
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(liquidity_vault, false),
            AccountMeta::new(trade_escrow, false),
            AccountMeta::new(trade_escrow_token_vault, false),
            AccountMeta::new(*buyer_token_account, false),
            AccountMeta::new_readonly(fee_config, false),
            AccountMeta::new(*dev_treasury, false),
            AccountMeta::new(*ecosystem_treasury, false),
            AccountMeta::new(*infra_treasury, false),
            AccountMeta::new(*emergency_reserve, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

/// Callable by either party (buyer or seller) before `approve_settlement`
/// has run (OFS-2300 §19a).
pub fn cancel_reservation_ix(
    signer: &Pubkey,
    seller: &Pubkey,
    mint: &Pubkey,
    reservation_id: u64,
) -> Instruction {
    let (liquidity_vault, _) = liquidity_vault_pda(seller, mint);
    let (trade_escrow, _) = trade_escrow_pda(reservation_id);
    let (trade_escrow_token_vault, _) = trade_escrow_tokens_pda(reservation_id);
    let (liquidity_token_vault, _) = liquidity_vault_tokens_pda(seller, mint);
    let data = instruction_data([72, 162, 75, 180, 116, 157, 146, 172], ());
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*signer, true),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(liquidity_vault, false),
            AccountMeta::new(trade_escrow, false),
            AccountMeta::new(trade_escrow_token_vault, false),
            AccountMeta::new(liquidity_token_vault, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

/// Permissionless once `trade_escrow.timeout_at` has passed (OFS-2300 §8a).
pub fn expire_reservation_ix(seller: &Pubkey, mint: &Pubkey, reservation_id: u64) -> Instruction {
    let (liquidity_vault, _) = liquidity_vault_pda(seller, mint);
    let (trade_escrow, _) = trade_escrow_pda(reservation_id);
    let (trade_escrow_token_vault, _) = trade_escrow_tokens_pda(reservation_id);
    let (liquidity_token_vault, _) = liquidity_vault_tokens_pda(seller, mint);
    let data = instruction_data([19, 147, 203, 128, 237, 194, 72, 183], ());
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(liquidity_vault, false),
            AccountMeta::new(trade_escrow, false),
            AccountMeta::new(trade_escrow_token_vault, false),
            AccountMeta::new(liquidity_token_vault, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

/// Opens a dispute case and freezes the trade escrow in one atomic step
/// (Phase 4b). `signer` must be the trade's buyer or seller; `payer`
/// (which may be the same key) pays this new account's rent.
pub fn open_dispute_case_ix(
    signer: &Pubkey,
    payer: &Pubkey,
    reservation_id: u64,
    commit_window_secs: i64,
    reveal_window_secs: i64,
) -> Instruction {
    let (trade_escrow, _) = trade_escrow_pda(reservation_id);
    let (dispute_case, _) = dispute_case_pda(reservation_id);
    let data = instruction_data(
        [28, 229, 240, 113, 124, 180, 117, 138],
        (commit_window_secs, reveal_window_secs),
    );
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*signer, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new(trade_escrow, false),
            AccountMeta::new(dispute_case, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
    )
}

pub fn commit_dispute_vote_ix(
    arbitrator: &Pubkey,
    reservation_id: u64,
    commitment: [u8; 32],
) -> Instruction {
    let (dispute_case, _) = dispute_case_pda(reservation_id);
    let data = instruction_data([210, 14, 34, 127, 75, 185, 189, 168], commitment);
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*arbitrator, true),
            AccountMeta::new(dispute_case, false),
        ],
    )
}

/// `arbitrator_stake` is this arbitrator's own `openfiat-staking`
/// `StakeAccount` under the `Arbitrator` role — a PDA owned by the
/// *staking* program, not this one (`seeds::program = staking::ID`
/// on-chain); see [`staking::stake_account_pda`].
pub fn reveal_dispute_vote_ix(
    arbitrator: &Pubkey,
    reservation_id: u64,
    outcome: DisputeOutcome,
    salt: [u8; 32],
) -> Instruction {
    let (dispute_case, _) = dispute_case_pda(reservation_id);
    let (arbitrator_stake, _) = staking::stake_account_pda(arbitrator, super::Role::Arbitrator);
    let data = instruction_data([211, 91, 1, 75, 154, 51, 233, 106], (outcome, salt));
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*arbitrator, true),
            AccountMeta::new(dispute_case, false),
            AccountMeta::new_readonly(arbitrator_stake, false),
        ],
    )
}

/// Permissionless once the reveal window has closed — tallies
/// `dispute_case`'s own on-chain-recorded, stake-weighted votes itself
/// (Phase 4b, plan decision #2).
#[allow(clippy::too_many_arguments)]
pub fn execute_dispute_outcome_ix(
    seller: &Pubkey,
    mint: &Pubkey,
    reservation_id: u64,
    buyer_token_account: &Pubkey,
    dev_treasury: &Pubkey,
    ecosystem_treasury: &Pubkey,
    infra_treasury: &Pubkey,
    emergency_reserve: &Pubkey,
) -> Instruction {
    let (dispute_case, _) = dispute_case_pda(reservation_id);
    let (trade_escrow, _) = trade_escrow_pda(reservation_id);
    let (trade_escrow_token_vault, _) = trade_escrow_tokens_pda(reservation_id);
    let (liquidity_vault, _) = liquidity_vault_pda(seller, mint);
    let (liquidity_token_vault, _) = liquidity_vault_tokens_pda(seller, mint);
    let (fee_config, _) = fee_config_pda();
    let data = instruction_data([158, 56, 238, 187, 219, 223, 212, 99], ());
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(dispute_case, false),
            AccountMeta::new(trade_escrow, false),
            AccountMeta::new(trade_escrow_token_vault, false),
            AccountMeta::new(liquidity_vault, false),
            AccountMeta::new(liquidity_token_vault, false),
            AccountMeta::new(*buyer_token_account, false),
            AccountMeta::new_readonly(fee_config, false),
            AccountMeta::new(*dev_treasury, false),
            AccountMeta::new(*ecosystem_treasury, false),
            AccountMeta::new(*infra_treasury, false),
            AccountMeta::new(*emergency_reserve, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_fee_config_ix_carries_treasuries_as_accounts_not_data() {
        let admin = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let dev = Pubkey::new_unique();
        let eco = Pubkey::new_unique();
        let infra = Pubkey::new_unique();
        let emergency = Pubkey::new_unique();
        let ix = update_fee_config_ix(
            &admin, &mint, &dev, &eco, &infra, &emergency, 7, 9, 15, 4_000, 3_000, 2_000, 1_000,
            1_800,
        );
        assert_eq!(&ix.data[..8], &[104, 184, 103, 242, 88, 151, 107, 20]);
        // 8 disc + 8 + 8 + 2*5 + 8 — no 32-byte pubkeys in the payload.
        assert_eq!(ix.data.len(), 8 + 8 + 8 + 2 + 2 + 2 + 2 + 2 + 8);

        let (fee_config, _) = fee_config_pda();
        let keys: Vec<Pubkey> = ix.accounts.iter().map(|a| a.pubkey).collect();
        assert_eq!(
            keys,
            vec![admin, fee_config, mint, dev, eco, infra, emergency]
        );
        assert!(ix.accounts[0].is_signer);
        assert!(ix.accounts[1].is_writable);
    }

    #[test]
    fn liquidity_vault_pda_uses_the_documented_seeds() {
        let merchant = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let (expected, _) = Pubkey::find_program_address(
            &[b"liquidity_vault", merchant.as_ref(), mint.as_ref()],
            &ESCROW_PROGRAM_ID,
        );
        assert_eq!(liquidity_vault_pda(&merchant, &mint).0, expected);
    }

    #[test]
    fn trade_escrow_pda_uses_the_documented_seeds() {
        let (expected, _) = Pubkey::find_program_address(
            &[b"trade_escrow", &42u64.to_le_bytes()],
            &ESCROW_PROGRAM_ID,
        );
        assert_eq!(trade_escrow_pda(42).0, expected);
    }

    #[test]
    fn dispute_case_pda_uses_the_documented_seeds() {
        let (expected, _) = Pubkey::find_program_address(
            &[b"dispute_case", &7u64.to_le_bytes()],
            &ESCROW_PROGRAM_ID,
        );
        assert_eq!(dispute_case_pda(7).0, expected);
    }

    #[test]
    fn fee_config_pda_is_a_singleton() {
        let (expected, _) = Pubkey::find_program_address(&[b"fee_config"], &ESCROW_PROGRAM_ID);
        assert_eq!(fee_config_pda().0, expected);
    }

    /// Every discriminator below is copy-pasted straight from
    /// `programs/target/idl/escrow.json` — this test is a tripwire
    /// against a future edit silently drifting from that file.
    #[test]
    fn every_instruction_carries_its_real_idl_discriminator() {
        let merchant = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let cases: Vec<(Instruction, [u8; 8])> = vec![
            (
                initialize_fee_config_ix(
                    &merchant,
                    1,
                    1,
                    15,
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                    2500,
                    2500,
                    2500,
                    2500,
                    1800,
                ),
                [62, 162, 20, 133, 121, 65, 145, 27],
            ),
            (
                create_liquidity_vault_ix(&merchant, &mint),
                [204, 255, 106, 205, 72, 186, 252, 83],
            ),
            (
                deposit_liquidity_ix(&merchant, &mint, &Pubkey::new_unique(), 100),
                [245, 99, 59, 25, 151, 71, 233, 249],
            ),
            (
                reserve_liquidity_ix(&merchant, &mint, 100),
                [197, 37, 232, 60, 182, 38, 12, 84],
            ),
            (
                withdraw_liquidity_ix(&merchant, &mint, &Pubkey::new_unique(), 100),
                [149, 158, 33, 185, 47, 243, 253, 31],
            ),
            (
                create_trade_escrow_ix(&merchant, &Pubkey::new_unique(), &mint, 1, 100, 1800),
                [149, 181, 111, 61, 122, 174, 71, 51],
            ),
            (
                fund_trade_escrow_ix(&merchant, &mint, 1),
                [148, 177, 67, 164, 227, 76, 173, 101],
            ),
            (
                approve_settlement_ix(&merchant, 1),
                [186, 5, 15, 163, 23, 10, 142, 12],
            ),
            (
                release_escrow_ix(
                    &merchant,
                    &mint,
                    1,
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                ),
                [146, 253, 129, 233, 20, 145, 181, 206],
            ),
            (
                cancel_reservation_ix(&merchant, &merchant, &mint, 1),
                [72, 162, 75, 180, 116, 157, 146, 172],
            ),
            (
                expire_reservation_ix(&merchant, &mint, 1),
                [19, 147, 203, 128, 237, 194, 72, 183],
            ),
            (
                open_dispute_case_ix(&merchant, &merchant, 1, 3600, 3600),
                [28, 229, 240, 113, 124, 180, 117, 138],
            ),
            (
                commit_dispute_vote_ix(&merchant, 1, [0u8; 32]),
                [210, 14, 34, 127, 75, 185, 189, 168],
            ),
            (
                reveal_dispute_vote_ix(&merchant, 1, DisputeOutcome::BuyerWins, [0u8; 32]),
                [211, 91, 1, 75, 154, 51, 233, 106],
            ),
            (
                execute_dispute_outcome_ix(
                    &merchant,
                    &mint,
                    1,
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                    &Pubkey::new_unique(),
                ),
                [158, 56, 238, 187, 219, 223, 212, 99],
            ),
        ];
        for (ix, discriminator) in cases {
            assert_eq!(ix.program_id, ESCROW_PROGRAM_ID);
            assert_eq!(&ix.data[..8], &discriminator[..]);
        }
    }

    #[test]
    fn release_escrow_has_no_signer_typed_account_and_eleven_accounts() {
        let ix = release_escrow_ix(
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            1,
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
        );
        assert_eq!(ix.accounts.len(), 11);
        assert!(ix.accounts.iter().all(|a| !a.is_signer));
    }

    #[test]
    fn reveal_dispute_vote_derives_the_stake_pda_under_the_staking_program() {
        let arbitrator = Pubkey::new_unique();
        let ix = reveal_dispute_vote_ix(&arbitrator, 1, DisputeOutcome::InvalidDispute, [1u8; 32]);
        let arbitrator_stake_account = &ix.accounts[2];
        let (expected, _) = staking::stake_account_pda(&arbitrator, super::super::Role::Arbitrator);
        assert_eq!(arbitrator_stake_account.pubkey, expected);
        assert!(!arbitrator_stake_account.is_signer);
        assert!(!arbitrator_stake_account.is_writable);
    }
}
