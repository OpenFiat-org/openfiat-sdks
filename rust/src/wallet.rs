//! Node identity/authentication for `sendX` methods, re-exported from
//! `openfiat-core` so callers don't need a direct dependency on it.
//!
//! Every `send_*` method on [`crate::Client`] takes an `&Keypair` to sign
//! the event it submits — get one either fresh
//! ([`openfiat_crypto::Keypair::generate`]) or from a Solana CLI-format
//! wallet.json via [`solana_keyfile::load`] + [`keypair_from_wallet`].

pub use openfiat_crypto::Keypair;
pub use openfiat_wallet::{Wallet, solana_keyfile};

/// A `Keypair` matching a loaded [`Wallet`]'s identity — `Wallet` signs
/// through its own `sign`/`peer_id` methods rather than exposing a raw
/// `Keypair`, so this rebuilds one from the wallet's seed for the
/// `Signed*::sign(unsigned, &Keypair)` calls every domain event type
/// expects.
pub fn keypair_from_wallet(wallet: &Wallet) -> Keypair {
    Keypair::from_seed(wallet.seed())
}
