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
    DisputeOutcome, ESCROW_PROGRAM_ID, RENT_SYSVAR_ID, Role, SLOT_HASHES_SYSVAR_ID,
    TOKEN_2022_PROGRAM_ID, instruction_data, system_program_id,
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
const ARBITRATION_POOL_SEED: &[u8] = b"arbitration_pool";

/// The single arbitration pool holding OPEN dispute deposits. Its
/// authority is the `FeeConfig` PDA, so only the program moves what it
/// holds — deposits are owed either back to a merchant or forward to
/// arbitrators, never to the admin.
pub fn arbitration_pool_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ARBITRATION_POOL_SEED], &ESCROW_PROGRAM_ID)
}

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
    // Field order is the wire format — Borsh has no field names — so these
    // two are appended last, matching their declaration order in the
    // program's own `UpdateFeeConfigParams`.
    min_arbitrator_stake_age_secs: i64,
    arbitrator_sortition_bps: u16,
    /// The complete settlement-mint allowlist, replacing whatever is
    /// stored — a replacement rather than an append, so it is also the only
    /// way to de-list. Appended last for the same wire-format reason as the
    /// two fields above.
    settlement_mints: Vec<Pubkey>,
}

/// Corrects the singleton `FeeConfig` after initialization (admin-only).
///
/// Unlike `initialize_fee_config_ix`, the treasuries are **accounts**, not
/// params: the program takes them as `TokenAccount`s constrained to `mint`,
/// so a wallet address cannot be stored where a token account is required.
/// That is deliberate — the devnet config was originally initialized with
/// treasury owner wallets, which made every `release_escrow` unexecutable.
///
/// # The two arbitrator-eligibility parameters
///
/// `min_arbitrator_stake_age_secs` and `arbitrator_sortition_bps` (OFS-4100
/// §4, §4.1) gate who may commit a dispute vote. This instruction is the
/// **only** path by which either is turned on: both deploy disabled,
/// because neither can be satisfied by anybody on a chain younger than the
/// requirement it imposes — on day one no wallet has held stake for thirty
/// days, and a 1/100 draw over a ten-wallet pool leaves nobody eligible.
///
/// Zero disables each. `arbitrator_sortition_bps` must be below 10_000; the
/// program rejects a value that would admit every wallet rather than
/// silently accepting "disabled" written unclearly.
///
/// # The settlement-mint allowlist
///
/// `settlement_mints` is the **complete** list, replacing whatever is
/// stored, which is what makes this the de-listing path as well as the
/// adding one. It may hold at most 16 entries, may not be empty, and may
/// not repeat a mint or contain the default pubkey — an empty list would
/// refuse every trade, which is pausing the protocol rather than setting a
/// fee. De-listing strands nothing: existing vaults stay depositable and
/// withdrawable, and only new reservations and escrows are refused.
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
    min_arbitrator_stake_age_secs: i64,
    arbitrator_sortition_bps: u16,
    settlement_mints: Vec<Pubkey>,
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
            min_arbitrator_stake_age_secs,
            arbitrator_sortition_bps,
            settlement_mints,
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

/// Creates a merchant's vault for one mint.
///
/// `fee_config` carries the settlement-mint allowlist, and
/// `arbitration_pool` is how the program recognises the OPEN mint — OPEN is
/// not an allowlisted settlement mint, so a merchant's OPEN vault (the one
/// that funds the ad-listing fee and the arbitration deposit) is only
/// creatable through that carve-out. Both are seeds-derived singletons, so
/// neither is a parameter; both must nonetheless be in the account list, and
/// `initialize_arbitration_pool` must have run on the cluster first.
pub fn create_liquidity_vault_ix(merchant: &Pubkey, mint: &Pubkey) -> Instruction {
    let (fee_config, _) = fee_config_pda();
    let (arbitration_pool, _) = arbitration_pool_pda();
    let (liquidity_vault, _) = liquidity_vault_pda(merchant, mint);
    let (token_vault, _) = liquidity_vault_tokens_pda(merchant, mint);
    let data = instruction_data([204, 255, 106, 205, 72, 186, 252, 83], ());
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*merchant, true),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(fee_config, false),
            AccountMeta::new_readonly(arbitration_pool, false),
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
            AccountMeta::new_readonly(super::ban_record_pda(merchant).0, false),
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
///
/// `fee_config` is read for the settlement-mint allowlist: a reservation is
/// where new exposure to a mint starts, so a de-listed mint is refused here
/// while everything already deposited stays withdrawable.
pub fn reserve_liquidity_ix(merchant: &Pubkey, mint: &Pubkey, amount: u64) -> Instruction {
    let (liquidity_vault, _) = liquidity_vault_pda(merchant, mint);
    let (fee_config, _) = fee_config_pda();
    let data = instruction_data([197, 37, 232, 60, 182, 38, 12, 84], amount);
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*merchant, true),
            AccountMeta::new(liquidity_vault, false),
            AccountMeta::new_readonly(fee_config, false),
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
    let (fee_config, _) = fee_config_pda();
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
            AccountMeta::new_readonly(fee_config, false),
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

/// Creates the arbitration pool. Admin-only, once per deployment.
pub fn initialize_arbitration_pool_ix(admin: &Pubkey, mint: &Pubkey) -> Instruction {
    let (fee_config, _) = fee_config_pda();
    let (arbitration_pool, _) = arbitration_pool_pda();
    let data = instruction_data([77, 223, 22, 51, 66, 236, 5, 90], ());
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(fee_config, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(arbitration_pool, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
    )
}

/// Bills the merchant's OPEN vault for one advertisement listing.
///
/// Advertisements are off-chain gossip records, so there is no on-chain
/// listing to bill against — the merchant is the on-chain anchor and their
/// liquidity vault is the source. `advertisement_id` is carried for the
/// emitted event only, as a join key for indexers; the program stores no
/// per-advertisement state.
#[allow(clippy::too_many_arguments)]
pub fn charge_ad_listing_fee_ix(
    merchant: &Pubkey,
    mint: &Pubkey,
    dev_treasury: &Pubkey,
    ecosystem_treasury: &Pubkey,
    infra_treasury: &Pubkey,
    emergency_reserve: &Pubkey,
    advertisement_id: [u8; 32],
) -> Instruction {
    let (fee_config, _) = fee_config_pda();
    let (liquidity_vault, _) = liquidity_vault_pda(merchant, mint);
    let (token_vault, _) = liquidity_vault_tokens_pda(merchant, mint);
    let data = instruction_data([200, 39, 46, 240, 232, 173, 134, 196], advertisement_id);
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*merchant, true),
            AccountMeta::new_readonly(fee_config, false),
            AccountMeta::new(liquidity_vault, false),
            AccountMeta::new(token_vault, false),
            AccountMeta::new(*dev_treasury, false),
            AccountMeta::new(*ecosystem_treasury, false),
            AccountMeta::new(*infra_treasury, false),
            AccountMeta::new(*emergency_reserve, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        ],
    )
}

/// Claims an arbitrator's pro-rata share of a resolved case's deposit.
///
/// Pull rather than push: pushing would put up to seven unknown token
/// accounts on `execute_dispute_outcome`, where one closed account would
/// fail the whole resolution and leave an escrow frozen because a *payout*
/// failed.
pub fn claim_arbitration_reward_ix(
    arbitrator: &Pubkey,
    reservation_id: u64,
    deposit_mint: &Pubkey,
    to: &Pubkey,
) -> Instruction {
    let (dispute_case, _) = dispute_case_pda(reservation_id);
    let (fee_config, _) = fee_config_pda();
    let (arbitration_pool, _) = arbitration_pool_pda();
    let data = instruction_data([20, 88, 236, 69, 233, 200, 195, 238], ());
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*arbitrator, true),
            AccountMeta::new(dispute_case, false),
            AccountMeta::new_readonly(fee_config, false),
            AccountMeta::new_readonly(*deposit_mint, false),
            AccountMeta::new(arbitration_pool, false),
            AccountMeta::new(*to, false),
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
/// Opens the on-chain case. The arbitration deposit is debited from the
/// *merchant's* OPEN liquidity vault whoever opened the dispute — a buyer
/// is often a one-time participant and must face no cost barrier to being
/// heard (OFS-4100 §9.3). `merchant` is therefore the trade's seller
/// rather than the caller, and `deposit_mint` is OPEN rather than the
/// settlement stablecoin.
///
/// If the merchant's vault cannot cover the deposit the case still opens
/// with whatever was there; requiring the full amount would let a merchant
/// make themselves undisputable by keeping that vault empty.
#[allow(clippy::too_many_arguments)]
pub fn open_dispute_case_ix(
    signer: &Pubkey,
    payer: &Pubkey,
    reservation_id: u64,
    commit_window_secs: i64,
    reveal_window_secs: i64,
    merchant: &Pubkey,
    deposit_mint: &Pubkey,
) -> Instruction {
    let (trade_escrow, _) = trade_escrow_pda(reservation_id);
    let (dispute_case, _) = dispute_case_pda(reservation_id);
    let (fee_config, _) = fee_config_pda();
    let (merchant_open_vault, _) = liquidity_vault_pda(merchant, deposit_mint);
    let (merchant_open_token_vault, _) = liquidity_vault_tokens_pda(merchant, deposit_mint);
    let (arbitration_pool, _) = arbitration_pool_pda();
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
            AccountMeta::new_readonly(fee_config, false),
            AccountMeta::new_readonly(*deposit_mint, false),
            AccountMeta::new(merchant_open_vault, false),
            AccountMeta::new(merchant_open_token_vault, false),
            AccountMeta::new(arbitration_pool, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program_id(), false),
            AccountMeta::new_readonly(SLOT_HASHES_SYSVAR_ID, false),
        ],
    )
}

/// Committing is gated on three things (OFS-4100 §4, §4.1): the
/// `Arbitrator` role's minimum stake, the age of that stake, and a per-case
/// sortition draw. The program therefore reads the staking config, this
/// arbitrator's own `StakeAccount` — both PDAs owned by the *staking*
/// program (`seeds::program = staking::ID` on-chain), derived here rather
/// than passed in — and the escrow `FeeConfig`, which holds the two
/// eligibility parameters so governance can retune them without a redeploy.
pub fn commit_dispute_vote_ix(
    arbitrator: &Pubkey,
    reservation_id: u64,
    commitment: [u8; 32],
) -> Instruction {
    let (dispute_case, _) = dispute_case_pda(reservation_id);
    let (staking_config, _) = staking::staking_config_pda();
    let (arbitrator_stake, _) = staking::stake_account_pda(arbitrator, Role::Arbitrator);
    let (fee_config, _) = fee_config_pda();
    let data = instruction_data([210, 14, 34, 127, 75, 185, 189, 168], commitment);
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*arbitrator, true),
            AccountMeta::new(dispute_case, false),
            AccountMeta::new_readonly(staking_config, false),
            AccountMeta::new_readonly(arbitrator_stake, false),
            AccountMeta::new_readonly(fee_config, false),
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
    let (staking_config, _) = staking::staking_config_pda();
    let (arbitrator_stake, _) = staking::stake_account_pda(arbitrator, super::Role::Arbitrator);
    let data = instruction_data([211, 91, 1, 75, 154, 51, 233, 106], (outcome, salt));
    Instruction::new_with_bytes(
        ESCROW_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(*arbitrator, true),
            AccountMeta::new(dispute_case, false),
            AccountMeta::new_readonly(staking_config, false),
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
    deposit_mint: &Pubkey,
) -> Instruction {
    let (dispute_case, _) = dispute_case_pda(reservation_id);
    let (trade_escrow, _) = trade_escrow_pda(reservation_id);
    let (trade_escrow_token_vault, _) = trade_escrow_tokens_pda(reservation_id);
    let (liquidity_vault, _) = liquidity_vault_pda(seller, mint);
    let (liquidity_token_vault, _) = liquidity_vault_tokens_pda(seller, mint);
    let (fee_config, _) = fee_config_pda();
    let (arbitration_pool, _) = arbitration_pool_pda();
    let (merchant_open_vault, _) = liquidity_vault_pda(seller, deposit_mint);
    let (merchant_open_token_vault, _) = liquidity_vault_tokens_pda(seller, deposit_mint);
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
            AccountMeta::new_readonly(*deposit_mint, false),
            AccountMeta::new(arbitration_pool, false),
            AccountMeta::new(merchant_open_vault, false),
            AccountMeta::new(merchant_open_token_vault, false),
            AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
            // Passed even though a round that decides never touches it: a
            // round that falls short re-draws the case seed, and Anchor's
            // account list is fixed per instruction rather than per branch.
            AccountMeta::new_readonly(SLOT_HASHES_SYSVAR_ID, false),
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
        let settlement_a = Pubkey::new_unique();
        let settlement_b = Pubkey::new_unique();
        let ix = update_fee_config_ix(
            &admin,
            &mint,
            &dev,
            &eco,
            &infra,
            &emergency,
            7,
            9,
            15,
            4_000,
            3_000,
            2_000,
            1_000,
            1_800,
            // The two arbitrator-eligibility gates, appended last in the
            // wire format. Non-zero here so the length assertion below would
            // still catch them being dropped from the payload.
            30 * 24 * 60 * 60,
            100,
            // Two allowlisted mints, so the Vec's length prefix and its
            // elements are both non-degenerate in the length assertion.
            vec![settlement_a, settlement_b],
        );
        assert_eq!(&ix.data[..8], &[104, 184, 103, 242, 88, 151, 107, 20]);
        // 8 disc + u64*2 + u16*5 + i64 + i64 + u16, then the allowlist as a
        // Borsh Vec: a u32 length followed by two raw 32-byte keys. The
        // treasuries are still absent from the payload — every one of them
        // travels as an account, which is the property this test is named
        // for and which the allowlist must not quietly undo.
        assert_eq!(
            ix.data.len(),
            8 + 8 + 8 + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 2 + 4 + 32 + 32
        );
        assert_eq!(
            &ix.data[ix.data.len() - 64..ix.data.len() - 32],
            settlement_a.as_ref()
        );
        assert_eq!(&ix.data[ix.data.len() - 32..], settlement_b.as_ref());

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
    /// The three instructions that gained an account when the
    /// settlement-mint allowlist landed.
    ///
    /// Pinned as exact, ordered lists rather than "contains fee_config":
    /// Anchor matches accounts by POSITION, not by name, so an account
    /// inserted at the wrong index still deserializes — into the wrong
    /// field — and fails somewhere unrelated. A containment check would
    /// pass on exactly the layout that breaks.
    #[test]
    fn the_allowlist_gated_instructions_carry_fee_config_in_the_right_slot() {
        let merchant = Pubkey::new_unique();
        let buyer = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let (fee_config, _) = fee_config_pda();
        let (arbitration_pool, _) = arbitration_pool_pda();
        let (liquidity_vault, _) = liquidity_vault_pda(&merchant, &mint);
        let (liquidity_tokens, _) = liquidity_vault_tokens_pda(&merchant, &mint);
        let (trade_escrow, _) = trade_escrow_pda(1);
        let (trade_tokens, _) = trade_escrow_tokens_pda(1);

        let keys =
            |ix: &Instruction| -> Vec<Pubkey> { ix.accounts.iter().map(|a| a.pubkey).collect() };

        // `arbitration_pool` is here only so the program can recognise the
        // OPEN mint, which is deliberately NOT an allowlisted settlement
        // mint — dropping it makes a merchant's OPEN vault uncreatable and
        // silently zeroes every arbitration deposit.
        assert_eq!(
            keys(&create_liquidity_vault_ix(&merchant, &mint)),
            vec![
                merchant,
                mint,
                fee_config,
                arbitration_pool,
                liquidity_vault,
                liquidity_tokens,
                TOKEN_2022_PROGRAM_ID,
                system_program_id(),
                RENT_SYSVAR_ID,
            ]
        );

        assert_eq!(
            keys(&reserve_liquidity_ix(&merchant, &mint, 100)),
            vec![merchant, liquidity_vault, fee_config]
        );

        assert_eq!(
            keys(&create_trade_escrow_ix(
                &merchant, &buyer, &mint, 1, 100, 1800
            )),
            vec![
                merchant,
                buyer,
                mint,
                fee_config,
                liquidity_vault,
                trade_escrow,
                trade_tokens,
                TOKEN_2022_PROGRAM_ID,
                system_program_id(),
                RENT_SYSVAR_ID,
            ]
        );
    }

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
                open_dispute_case_ix(
                    &merchant,
                    &merchant,
                    1,
                    3600,
                    3600,
                    &merchant,
                    &Pubkey::new_unique(),
                ),
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
    fn commit_dispute_vote_carries_the_stake_accounts_the_eligibility_gate_reads() {
        // Three gates now guard a commit (OFS-4100 §4, §4.1): the Arbitrator
        // stake minimum, the age of that stake, and the per-case sortition
        // draw. The program can only check them if all of these accounts are
        // present — omitting any would make every commit fail
        // deserialization rather than merely skip a check.
        let arbitrator = Pubkey::new_unique();
        let ix = commit_dispute_vote_ix(&arbitrator, 1, [0u8; 32]);
        assert_eq!(ix.accounts.len(), 5);

        let (expected_config, _) = staking::staking_config_pda();
        assert_eq!(ix.accounts[2].pubkey, expected_config);
        assert!(!ix.accounts[2].is_signer);
        assert!(!ix.accounts[2].is_writable);

        let (expected_stake, _) =
            staking::stake_account_pda(&arbitrator, super::super::Role::Arbitrator);
        assert_eq!(ix.accounts[3].pubkey, expected_stake);
        assert!(!ix.accounts[3].is_signer);
        assert!(!ix.accounts[3].is_writable);

        // `fee_config` holds both eligibility parameters, so the gates follow
        // a governance change with no redeploy of the escrow program.
        let (expected_fee_config, _) = fee_config_pda();
        assert_eq!(ix.accounts[4].pubkey, expected_fee_config);
        assert!(!ix.accounts[4].is_signer);
        assert!(!ix.accounts[4].is_writable);
    }

    #[test]
    fn the_dispute_instructions_that_draw_a_seed_carry_the_slot_hashes_sysvar() {
        // Both instructions latch a case's sortition seed from a recent slot
        // hash. Without the sysvar the program cannot seed the draw at all,
        // and the address must be exact — a wrong one is rejected by the
        // `address = SlotHashes::id()` constraint rather than silently
        // producing a predictable seed.
        let open = open_dispute_case_ix(
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            1,
            60,
            60,
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
        );
        assert_eq!(open.accounts.last().unwrap().pubkey, SLOT_HASHES_SYSVAR_ID);

        let execute = execute_dispute_outcome_ix(
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            1,
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
            &Pubkey::new_unique(),
        );
        assert_eq!(
            execute.accounts.last().unwrap().pubkey,
            SLOT_HASHES_SYSVAR_ID
        );
        assert!(!execute.accounts.last().unwrap().is_writable);
    }

    #[test]
    fn reveal_dispute_vote_derives_the_stake_pda_under_the_staking_program() {
        let arbitrator = Pubkey::new_unique();
        let ix = reveal_dispute_vote_ix(&arbitrator, 1, DisputeOutcome::InvalidDispute, [1u8; 32]);
        // Index 3, not 2: `staking_config` was inserted ahead of the stake
        // account when `effective_stake` became config-aware, so the reveal
        // can tell whether the stake clears its role minimum.
        let (expected_config, _) = staking::staking_config_pda();
        assert_eq!(ix.accounts[2].pubkey, expected_config);
        let arbitrator_stake_account = &ix.accounts[3];
        let (expected, _) = staking::stake_account_pda(&arbitrator, super::super::Role::Arbitrator);
        assert_eq!(arbitrator_stake_account.pubkey, expected);
        assert!(!arbitrator_stake_account.is_signer);
        assert!(!arbitrator_stake_account.is_writable);
    }
}
