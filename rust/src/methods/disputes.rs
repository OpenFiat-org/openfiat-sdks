//! Dispute methods (OFS-2400).

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_disputes::events::{
    ArbitratorJoin, DisputeOpen, SignedArbitratorJoin, SignedDisputeOpen, SignedVoteCommit,
    SignedVoteReveal, VoteCommit, VoteReveal,
};
use openfiat_disputes::{Dispute, DisputeId};

impl Client {
    pub async fn get_dispute(&self, id: impl Into<String>) -> Result<Option<Dispute>> {
        self.call("getDispute", IdParams { id: id.into() }).await
    }

    pub async fn get_disputes(&self) -> Result<Vec<Dispute>> {
        self.call("getDisputes", ()).await
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
