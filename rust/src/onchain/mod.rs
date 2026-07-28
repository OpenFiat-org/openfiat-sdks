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

/// The SPL Token-2022 program — every token account/mint these three
/// programs touch is a Token-2022 `InterfaceAccount` (OFS-4200 §4-6).
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
/// The Rent sysvar — required by every `init`-ing instruction (account
/// creation reads it for rent-exemption).
pub const RENT_SYSVAR_ID: Pubkey = pubkey!("SysvarRent111111111111111111111111111111111");

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
