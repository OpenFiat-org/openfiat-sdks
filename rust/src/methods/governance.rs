//! Governance methods (OFS-4000).

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_governance::events::{ProposalCreate, SignedProposalCreate, SignedVoteCast, VoteCast};
use openfiat_governance::{Proposal, ProposalId};

impl Client {
    pub async fn get_proposal(&self, id: impl Into<String>) -> Result<Option<Proposal>> {
        self.call("getProposal", IdParams { id: id.into() }).await
    }

    pub async fn get_proposals(&self) -> Result<Vec<Proposal>> {
        self.call("getProposals", ()).await
    }

    pub async fn send_proposal_create(
        &self,
        create: ProposalCreate,
        keypair: &Keypair,
    ) -> Result<ProposalId> {
        let signed = SignedProposalCreate::sign(create, keypair);
        let id: String = self.send_signed("sendProposalCreate", &signed).await?;
        Ok(ProposalId::new(id))
    }

    pub async fn send_vote_cast(&self, vote: VoteCast, keypair: &Keypair) -> Result<()> {
        let signed = SignedVoteCast::sign(vote, keypair);
        self.send_signed("sendVoteCast", &signed).await
    }
}
