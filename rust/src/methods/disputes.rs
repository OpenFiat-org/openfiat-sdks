//! Dispute methods (OFS-2400).

use crate::client::{Client, IdParams};
use crate::error::Result;
use crate::methods::redaction::PublicDispute;
use openfiat_crypto::Keypair;
use openfiat_disputes::events::{
    ArbitratorJoin, DisputeOpen, SignedArbitratorJoin, SignedDisputeOpen, SignedVoteCommit,
    SignedVoteReveal, VoteCommit, VoteReveal,
};
use openfiat_disputes::{Dispute, DisputeId};

/// Domain separator for `getMyDisputes`, transcribed from
/// `openfiat-rpc`'s `methods::disputes::CHALLENGE_DOMAIN`.
pub const CHALLENGE_DOMAIN: &str = "openfiat-my-disputes";

impl Client {
    /// Read one dispute as a stranger sees it: status, arbitrator counts
    /// and outcome survive; the parties, the free-text `reason` and
    /// which arbitrator voted how do not. The pairing is what makes
    /// pressuring an arbitrator worth the effort, so counts are
    /// published and the pairing is not.
    pub async fn get_dispute(&self, id: impl Into<String>) -> Result<Option<PublicDispute>> {
        self.call("getDispute", IdParams { id: id.into() }).await
    }

    /// Every dispute on the network, redacted.
    pub async fn get_disputes(&self) -> Result<Vec<PublicDispute>> {
        self.call("getDisputes", ()).await
    }

    /// Every dispute `keypair`'s wallet is a party to — or is a seated
    /// arbitrator on — in full, proved by signing a freshly issued
    /// wallet challenge.
    ///
    /// An arbitrator qualifies because reading the whole case is the job
    /// they were seated to do.
    pub async fn get_my_disputes(&self, keypair: &Keypair) -> Result<Vec<Dispute>> {
        let proof = self.wallet_proof(keypair, CHALLENGE_DOMAIN).await?;
        self.call("getMyDisputes", proof).await
    }

    pub async fn send_dispute_open(
        &self,
        open: DisputeOpen,
        keypair: &Keypair,
    ) -> Result<DisputeId> {
        let signed = SignedDisputeOpen::sign(open, keypair);
        let id: String = self.send_signed("sendDisputeOpen", &signed).await?;
        Ok(DisputeId::new(id))
    }

    pub async fn send_arbitrator_join(
        &self,
        join: ArbitratorJoin,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedArbitratorJoin::sign(join, keypair);
        self.send_signed("sendArbitratorJoin", &signed).await
    }

    pub async fn send_vote_commit(&self, commit: VoteCommit, keypair: &Keypair) -> Result<()> {
        let signed = SignedVoteCommit::sign(commit, keypair);
        self.send_signed("sendVoteCommit", &signed).await
    }

    pub async fn send_vote_reveal(&self, reveal: VoteReveal, keypair: &Keypair) -> Result<()> {
        let signed = SignedVoteReveal::sign(reveal, keypair);
        self.send_signed("sendVoteReveal", &signed).await
    }
}
