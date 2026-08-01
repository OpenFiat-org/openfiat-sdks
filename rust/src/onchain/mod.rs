//! Typed instruction builders for the three on-chain Anchor programs
//! (OFS-4200): `openfiat-escrow`, `openfiat-staking`,
//! `openfiat-governance`. This SDK has no dependency on `anchor-lang`
//! itself (a much heavier dependency with its own Solana SDK version
//! pins that would conflict with the ones `Cargo.toml` already commits
//! to) — each builder here hand-encodes the same wire format Anchor's
//! own `#[program]` macro produces: an 8-byte instruction discriminator
//! (`sha256("global:<snake_case_name>")[..8]`, taken verbatim from a
//! real `anchor build`'s generated `programs/target/idl/*.json` rather
//! than recomputed by hand — see each program's own doc comment for
//! which IDL file) followed by each argument Borsh-serialized in
//! declared order.
//!
//! Every builder returns a plain [`solana_instruction::Instruction`] —
//! this crate never constructs, signs, or submits a transaction on the
//! caller's behalf (matching every other `sendX` method's contract, see
//! `methods::chain`'s own doc). A caller assembles one or more
//! instructions into a `Message`, signs it with their own Solana
//! keypair, and submits it via [`crate::Client::send_transaction`] —
//! see `examples/stake_and_vote.rs`.

pub mod escrow;
pub mod governance;
pub mod staking;

use borsh::BorshSerialize;
use solana_pubkey::{Pubkey, pubkey};

/// `openfiat-escrow`'s deployed program id (`declare_id!` in
/// `programs/programs/escrow/src/lib.rs`).
pub const ESCROW_PROGRAM_ID: Pubkey = pubkey!("HaPpM1QYM3dKp3sX7zhEdft9hB6ncu6xfALAbkyQChQP");
/// `openfiat-staking`'s deployed program id.
pub const STAKING_PROGRAM_ID: Pubkey = pubkey!("HYEXk8XQukBkZbiYB33JyVefQDxqyCpPudad3wBCyYmx");
/// `openfiat-governance`'s deployed program id.
pub const GOVERNANCE_PROGRAM_ID: Pubkey = pubkey!("AVJfKUjHsizkGGUy8sdz4Xma2hVgmgvgg8GmUMs8E4eE");

/// The OPEN token mint (Token-2022) — the protocol's own token, and the
/// denomination of every stake account, rewards vault and treasury bucket
/// in [`crate::onchain::staking`] and [`crate::onchain::governance`].
///
/// Exported for the same reason the program ids above are. `openfiat-core`
/// pins this in `crates/chain/src/programs.rs` as a compile-time constant
/// so a node operator cannot nominate the token their own stake is
/// denominated in (#105); a caller that has to retype the base58 string to
/// build a `stake_ix` reintroduces exactly that, one layer out. A wrong
/// mint here does not fail loudly — it derives a real, empty associated
/// token account and the transaction is rejected for a balance the caller
/// can see in a wallet that holds the other token.
///
/// Not a default anywhere, and specifically not escrow's: a trade settles
/// in whatever mint the advertisement names (wSOL, USDC), which is why the
/// escrow builders take the mint and its token program as parameters. This
/// is the answer only where the protocol itself is the counterparty.
pub const OPEN_MINT: Pubkey = pubkey!("29w8TroBTYoaqrXBDcpv5L54VZRA8Kf7kU5U1cakvFdj");

/// The SPL Token-2022 program.
///
/// Still the right answer for staking and governance, which deal only in
/// OPEN, and OPEN is a Token-2022 mint. It is **not** automatically the
/// right answer for escrow: since the programs moved to
/// `Interface<TokenInterface>`, a settlement mint may be legacy SPL —
/// wSOL and real USDC both are — so escrow builders take the program as a
/// parameter instead. See [`LEGACY_TOKEN_PROGRAM_ID`].
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
/// The original SPL Token program.
///
/// Most mints in circulation are still this one, including wSOL and the
/// real USDC and USDT. An escrow transaction naming Token-2022 for one of
/// them is rejected by the runtime before the program sees it, which is
/// the failure the `token_program` parameter on the escrow builders
/// exists to make impossible to write by accident.
///
/// Neither constant is a default anywhere. A caller derives the right one
/// from the mint account's own `owner` — the SDK cannot know it without an
/// RPC round trip, and a builder that quietly performs network I/O is
/// worse than one that asks.
pub const LEGACY_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/// The Rent sysvar — required by every `init`-ing instruction (account
/// creation reads it for rent-exemption).
pub const RENT_SYSVAR_ID: Pubkey = pubkey!("SysvarRent111111111111111111111111111111111");
/// The SlotHashes sysvar — read by the dispute instructions that latch a
/// case's arbitrator-sortition seed (OFS-4100 §4.1). Passed as an account
/// rather than fetched in-program because it is far too large to
/// deserialize there.
pub const SLOT_HASHES_SYSVAR_ID: Pubkey = pubkey!("SysvarS1otHashes111111111111111111111111111");

/// The System Program's id is the all-zero `Pubkey` by construction —
/// no separate constant needed. `solana_pubkey::Pubkey::default()`
/// already *is* `11111111111111111111111111111111111111111111`.
pub fn system_program_id() -> Pubkey {
    Pubkey::default()
}

/// A staked/bonded protocol role (OFS-4200 §2, `openfiat-programs-shared::Role`).
/// `StakeAccount` is keyed by `(owner, role)` — one wallet may hold
/// independent stakes under different roles. Variant order must match
/// `programs/shared/src/lib.rs` exactly: Borsh encodes an enum as a
/// single `u8` variant tag, so a reordered copy here would silently
/// select the wrong role on-chain.
#[derive(BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Merchant,
    Arbitrator,
    NodeOperator,
    NotificationProvider,
    OracleProvider,
    RiskIntelligenceProvider,
    SnapshotProvider,
}

/// Number of [`Role`] variants — the length of `StakingConfig`'s per-role
/// minimum-stake array. Must match `Role::COUNT` in `programs/shared`.
pub const ROLE_COUNT: usize = 7;

/// OFS-4100 §5's 6-category governance taxonomy (OFS-4200 §2).
#[derive(BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProposalCategory {
    Informational,
    Standards,
    Parameter,
    Treasury,
    ProtocolUpgrade,
    Constitutional,
}

/// PDA seed for a `governance::BanRecord` (OFS-7100 §12).
///
/// Lives in this module rather than in `governance` for the same reason
/// its on-chain counterpart lives in `programs/shared`: the gate is
/// enforced from escrow and staking too, and those modules should not
/// have to reach into `governance` for it.
pub const BAN_SEED: &[u8] = b"ban";

/// The canonical ban address for a wallet — `[BAN_SEED, wallet]` under
/// `openfiat-governance`.
///
/// Every gated instruction re-derives this on-chain from its own
/// signer's key and rejects anything else, so passing a different
/// account fails with Anchor's `ConstraintSeeds` rather than slipping
/// past the ban. The wallet is banned iff this address is occupied; for
/// an unbanned wallet it names an account that does not exist, which is
/// exactly what the program expects.
pub fn ban_record_pda(wallet: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[BAN_SEED, wallet.as_ref()], &GOVERNANCE_PROGRAM_ID)
}

/// Grounds for a listing (OFS-7100 §12). Variant order must match
/// `governance::state::BanReason` — Borsh's enum tag is the declaration
/// index, so a reordered copy would silently record the wrong reason.
#[derive(BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum BanReason {
    StolenFunds,
    Sanctions,
    Phishing,
    Scam,
    Other,
}

/// A dispute case's resolution outcome (OFS-2400 §17, OFS-4200 §2).
#[derive(BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisputeOutcome {
    BuyerWins,
    MerchantWins,
    MutualSettlement,
    InvalidDispute,
}

/// Builds an Anchor instruction's data: `discriminator ++ Borsh(args)`.
/// `args` is typically a tuple of every argument in declared order —
/// Borsh serializes a tuple as the concatenation of each element's own
/// serialization, which is exactly how Anchor encodes a multi-argument
/// instruction (there is no wrapping struct on the wire).
pub(crate) fn instruction_data(discriminator: [u8; 8], args: impl BorshSerialize) -> Vec<u8> {
    let mut data = discriminator.to_vec();
    args.serialize(&mut data)
        .expect("Borsh serialization of instruction args cannot fail");
    data
}

/// Every address in this module is checked against `openfiat-core`'s own
/// pinned constants rather than against a second copy of the base58
/// strings — a transcription this file cannot get wrong twice in the same
/// way, since one side is read from the dependency `Cargo.toml` already
/// resolves.
///
/// `openfiat_chain::PROGRAM_IDS` *is* the record #105 created: the
/// compile-time protocol identity a node reads instead of its own
/// configuration. It comes from a git dependency, so it is present in
/// every `cargo test` run including a fresh clone's — there is nothing to
/// skip on, and these are deliberately hard assertions. The TypeScript
/// side cannot reach a cargo dependency and reads the deployment record
/// from the filesystem instead; see `tests/open-mint.test.ts` there for
/// why that one has to be allowed to skip and this one does not.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_open_mint_matches_the_mint_openfiat_core_is_pinned_to() {
        assert_eq!(
            OPEN_MINT.to_string(),
            openfiat_chain::PROGRAM_IDS.mint,
            "this SDK and openfiat-core disagree about which token is OPEN, so \
             every stake, vote and reward built here targets an empty token account"
        );
    }

    #[test]
    fn the_program_ids_match_the_ones_openfiat_core_is_pinned_to() {
        assert_eq!(
            ESCROW_PROGRAM_ID.to_string(),
            openfiat_chain::PROGRAM_IDS.escrow
        );
        assert_eq!(
            STAKING_PROGRAM_ID.to_string(),
            openfiat_chain::PROGRAM_IDS.staking
        );
        assert_eq!(
            GOVERNANCE_PROGRAM_ID.to_string(),
            openfiat_chain::PROGRAM_IDS.governance
        );
    }
}
