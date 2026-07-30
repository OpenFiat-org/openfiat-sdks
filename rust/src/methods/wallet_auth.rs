//! Proving you hold a wallet, for the reads that are not everyone's.
//!
//! Most of a node's read surface is open, because what it returns is
//! already replicated to every node. A handful of reads are not, and the
//! line between them is not "is this secret" — nothing here is secret —
//! but "does answering this to a stranger assemble something the protocol
//! deliberately leaves scattered". The trade graph is that something:
//! which merchant a wallet always returns to, and who a busy merchant's
//! regulars are, is a physical-safety question in a P2P fiat market.
//!
//! So `getSettlements`, `getReservations`, `getDisputes` and `getTrades`
//! answer with the redacted shapes in [`crate::methods::redaction`], and
//! a party reads their own records in full through `getMySettlements`,
//! `getMyReservations`, `getMyDisputes` and `getMyTrades` — each of which
//! takes a [`WalletProof`] rather than a wallet parameter, so there is no
//! way to spell "somebody else's history".
//!
//! `getTrades` joined the list late, and instructively: it composes a
//! reservation and a settlement, so while the three underlying reads were
//! being closed it went on returning both whole. Reasoning about the
//! methods somebody thought of does not cover the one they did not.
//!
//! # The exchange
//!
//! 1. `getWalletChallenge` hands out a single-use, expiring nonce bound
//!    to one wallet. Deliberately open: a nonce is worthless without the
//!    private key that signs it, and demanding a signature to obtain the
//!    thing you sign would be circular.
//! 2. The wallet signs `"<domain>:<subject>:<nonce>"` and presents the
//!    signature with its public key. The node checks that the key derives
//!    to the wallet being asked about *before* it touches the nonce, then
//!    consumes the nonce *before* it checks the signature — so a captured
//!    signature burns the nonce rather than replaying it.
//!
//! One issuer serves every gated surface, because a nonce carries no
//! domain of its own: the separation is entirely in what gets signed.
//! That is why each `get_my_*` method signs under its own
//! `CHALLENGE_DOMAIN` constant, and why those constants are transcribed
//! from `openfiat-rpc`'s own — a typo produces a signature the node
//! refuses with an error that never mentions the domain.
//!
//! # What this is not
//!
//! It is not confidentiality. These records gossip to every node, so
//! anyone running one reads them all. What it protects is the *ease* of
//! the query: the difference between `curl`-ing a stranger's public
//! access node and standing up a node to index the network.

use crate::client::{Client, WalletParams, encode_base64, encode_peer_id};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_network::identity::peer_id_from_public_key;
use openfiat_types::{PeerId, Timestamp};

/// A single-use, expiring challenge bound to one wallet.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct WalletChallenge {
    /// The wallet this challenge was issued for, in the node's own
    /// canonical base64 spelling. Signed verbatim, so a caller must echo
    /// back what the node sent rather than re-encoding their own peer id
    /// — two spellings that decode to the same bytes still hash
    /// differently.
    pub subject: String,
    /// 32 random bytes, hex-encoded.
    pub nonce: String,
    pub expires_at: Timestamp,
}

impl WalletChallenge {
    /// The exact bytes the wallet must sign to answer this challenge on
    /// the surface `domain` names.
    pub fn signing_bytes(&self, domain: &str) -> Vec<u8> {
        format!("{domain}:{}:{}", self.subject, self.nonce).into_bytes()
    }
}

/// A wallet answering a challenge: whose records, which nonce, the key
/// claiming to be that wallet, and its signature over the challenge.
#[derive(Debug, Clone, serde::Serialize)]
pub struct WalletProof {
    /// Base64 `PeerId`, matching every other wallet-scoped method.
    pub wallet: String,
    /// Base64 raw 32-byte Ed25519 public key. Sent explicitly rather than
    /// left for the node to recover from `wallet`, so the identity claim
    /// is something the caller states and the node checks.
    pub public_key: String,
    pub nonce: String,
    /// Base64, matching every other signed payload on this surface.
    pub signature: String,
}

impl Client {
    /// Ask for a single-use challenge for `wallet` to sign.
    ///
    /// Prefer the `get_my_*` methods, which perform both steps. This is
    /// exposed for callers whose signing key lives somewhere the SDK
    /// cannot reach — a hardware or browser wallet — who need
    /// [`WalletChallenge::signing_bytes`] and then build a
    /// [`WalletProof`] themselves.
    pub async fn get_wallet_challenge(&self, wallet: &PeerId) -> Result<WalletChallenge> {
        self.call(
            "getWalletChallenge",
            WalletParams {
                wallet: encode_peer_id(wallet),
            },
        )
        .await
    }

    /// Fetch a challenge for `keypair`'s own wallet and answer it under
    /// `domain`.
    ///
    /// The wallet is derived from the keypair rather than taken as an
    /// argument: the node refuses any proof whose key does not derive to
    /// the wallet named, so a wallet parameter here could only ever be
    /// right or be an error, and taking it would suggest otherwise.
    pub(crate) async fn wallet_proof(
        &self,
        keypair: &Keypair,
        domain: &str,
    ) -> Result<WalletProof> {
        let wallet = peer_id_from_public_key(&keypair.public_key())
            .expect("an Ed25519 public key always derives a peer id");
        let challenge = self.get_wallet_challenge(&wallet).await?;
        let signature = keypair.sign(&challenge.signing_bytes(domain));
        Ok(WalletProof {
            // The subject the node issued, not a re-encoding of the peer
            // id — it is what the node rebuilds the signing bytes from.
            wallet: challenge.subject,
            public_key: encode_base64(keypair.public_key().as_bytes()),
            nonce: challenge.nonce,
            signature: encode_base64(
                &signature
                    .as_bytes()
                    .expect("a freshly signed signature is always 64 bytes"),
            ),
        })
    }
}
