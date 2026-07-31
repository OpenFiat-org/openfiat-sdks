//! Node identity/authentication for `sendX` methods, re-exported from
//! `openfiat-core` so callers don't need a direct dependency on it.
//!
//! Every `send_*` method on [`crate::Client`] takes an `&Keypair` to sign
//! the event it submits — get one either fresh
//! ([`openfiat_crypto::Keypair::generate`]) or from a Solana CLI-format
//! wallet.json via [`solana_keyfile::load`] + [`keypair_from_wallet`].

pub use openfiat_crypto::Keypair;
pub use openfiat_wallet::{Wallet, solana_keyfile};

/// Sealing a notification destination to the gateway that will deliver it
/// (OFS-6000 §11).
///
/// Re-exported rather than reimplemented. A subscription replicates to
/// every node on the network, so a wallet's email address or phone number
/// must be readable by exactly one party — and a second implementation of
/// the construction is a second chance to get it subtly wrong, in a way
/// that fails as "the gateway cannot open it" long after the subscription
/// has been signed and gossiped.
///
/// [`open`] is here for gateways, which is the only role that has a reason
/// to hold the secret key a box is addressed to.
pub use openfiat_crypto::{SealError, SealedBox, open, seal};

/// A `Keypair` matching a loaded [`Wallet`]'s identity — `Wallet` signs
/// through its own `sign`/`peer_id` methods rather than exposing a raw
/// `Keypair`, so this rebuilds one from the wallet's seed for the
/// `Signed*::sign(unsigned, &Keypair)` calls every domain event type
/// expects.
pub fn keypair_from_wallet(wallet: &Wallet) -> Keypair {
    Keypair::from_seed(wallet.seed())
}
