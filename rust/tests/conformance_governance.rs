//! Phase 9 conformance proof: a real stake -> off-chain vote -> weight
//! verification cycle, against a real local validator running the real
//! `openfiat-staking` program and a real off-chain OpenFiat node in
//! `RpcConnected` mode.
//!
//! This is the first time in the whole project that Phase 6's async
//! vote-weight-verification fix (`crates/rpc::actor::
//! poll_vote_verifications`, previously only unit-tested against fake
//! `ChainClient`s) gets proven against a genuine on-chain `StakeAccount`.
//!
//! ## Why this test needs no `openfiat-governance` on-chain program at all
//!
//! `sendVoteCast`'s verification path reads the voter's claimed
//! `stake_account` (an `openfiat-staking` `StakeAccount` PDA) directly —
//! it has no dependency on an on-chain `Proposal` existing anywhere.
//! Only the *off-chain* `openfiat-governance` P2P layer's own `Proposal`
//! needs to exist (via `sendProposalCreate`) for a vote to have
//! something to attach to and be observable afterward via `getProposal`.
//! So this proof only needs `openfiat-staking` deployed/initialized —
//! not `openfiat-governance` on-chain at all. (The on-chain
//! `openfiat-governance` program's own `cast_vote` instruction is a
//! *separate* write path this proof deliberately does not exercise —
//! see `src/onchain/governance.rs`'s own doc comment on why the two
//! systems are architecturally independent.)
//!
//! ## The one critical detail this proof depends on
//!
//! `sendVoteCast`'s verification checks
//! `decoded_stake_account.owner == signed.vote.voter_public_key.as_bytes()`
//! — the *same* 32-byte Ed25519 public key must be used as both the
//! off-chain OpenFiat identity and the on-chain Solana wallet for a
//! voter, exactly the pattern `openfiat-core/crates/cli/src/main.rs`'s
//! own production code already uses (`Keypair::from_seed(wallet.seed())`).
//! `voter_seeded_identity_and_solana_keypairs` below builds both
//! keypairs from one seed for this reason.
//!
//! ## External observability (the part worth getting right)
//!
//! `openfiat_governance::record::Proposal.votes: Vec<CastVote>` is a
//! fully public, serialized field — `Client::get_proposal` returns it
//! as-is. So the applied vote's *real, verified* weight is directly
//! observable from outside the node process, with no internal hook
//! needed: this proof creates an off-chain proposal, casts a vote with a
//! deliberately wrong self-reported `weight`, and asserts `get_proposal`
//! shows the real on-chain staked amount instead — proving the
//! verification pipeline actually overrides the self-report, not just
//! that `sendVoteCast` returns `Ok(())` (which it always does once
//! queued, regardless of whether verification later succeeds or silently
//! drops the vote — `get_proposal`'s vote list is what actually
//! distinguishes those two outcomes). A second, negative case proves a
//! vote whose claimed `stake_account` belongs to a *different* keypair
//! never gets applied at all.

mod support;

use openfiat_crypto::Keypair as IdentityKeypair;
use openfiat_governance::events::ProposalCreate;
use openfiat_governance::events::VoteCast;
use openfiat_governance::record::{ProposalCategory, VoteChoice};
use openfiat_network::identity::peer_id_from_public_key;
use openfiat_sdk::onchain::Role;
use openfiat_sdk::onchain::staking;
use openfiat_sdk::{Client, ClientConfig};
use openfiat_types::Timestamp;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_keypair::Keypair as SolanaKeypair;
use solana_signer::Signer;
use std::time::Duration;

/// Builds a matching (off-chain identity, on-chain Solana) keypair pair
/// from one seed — see this file's own top doc comment on why this
/// correlation is required for vote-weight verification to ever pass.
fn seeded_identity_and_solana_keypairs(seed: [u8; 32]) -> (IdentityKeypair, SolanaKeypair) {
    (
        IdentityKeypair::from_seed(seed),
        SolanaKeypair::new_from_array(seed),
    )
}

#[tokio::test]
async fn a_real_vote_is_weighed_by_its_real_on_chain_stake_not_its_self_report() {
    let fixtures = support::escrow_staking_governance_fixtures();
    let Some(validator) = support::spawn_validator(&fixtures, 3) else {
        return;
    };

    let rpc_client = RpcClient::new(validator.rpc_url.clone());
    support::wait_until_ready(&rpc_client).await;

    // --- On-chain: staking config + a real, staked voter ---
    let admin = SolanaKeypair::new();
    support::airdrop_and_confirm(&rpc_client, &admin.pubkey(), 5_000_000_000).await;
    let mint = support::create_test_mint(&rpc_client, &admin, 9).await;

    let staking_config_ix = staking::initialize_staking_config_ix(
        &admin.pubkey(),
        &mint.pubkey(),
        // min_stake_by_role: 1 token each (this mint's own decimals)
        [1_000_000_000; openfiat_sdk::onchain::ROLE_COUNT],
        [60; openfiat_sdk::onchain::ROLE_COUNT], // unbonding_period_secs_by_role
        1_000,                                   // slash_bps (10%)
        &admin.pubkey(),                         // slashing_authority
        &admin.pubkey(),                         // slash_destination
        &admin.pubkey(),                         // rewards_authority
    );
    support::submit(&rpc_client, &admin, &[staking_config_ix], &[]).await;

    let (voter_identity, voter_solana) = seeded_identity_and_solana_keypairs([7u8; 32]);
    support::airdrop_and_confirm(&rpc_client, &voter_solana.pubkey(), 2_000_000_000).await;
    let voter_token_account = support::create_and_fund_token_account(
        &rpc_client,
        &admin,
        &mint.pubkey(),
        &voter_solana.pubkey(),
        &admin,
        50_000_000_000, // 50 tokens
    )
    .await;

    let role = Role::NodeOperator;
    let init_stake_ix = staking::initialize_stake_account_ix(&voter_solana.pubkey(), role);
    support::submit(&rpc_client, &voter_solana, &[init_stake_ix], &[]).await;

    let real_staked_amount: u64 = 12_345_000_000; // 12.345 tokens — deliberately not a round self-reportable-looking number
    let stake_ix = staking::stake_ix(
        &voter_solana.pubkey(),
        role,
        &mint.pubkey(),
        &voter_token_account.pubkey(),
        real_staked_amount,
    );
    support::submit(&rpc_client, &voter_solana, &[stake_ix], &[]).await;

    let (stake_account_pda, _) = staking::stake_account_pda(&voter_solana.pubkey(), role);

    // A second, unstaked identity whose vote should be silently dropped
    // (its claimed stake_account belongs to `voter_solana`, not itself).
    let (attacker_identity, _attacker_solana) = seeded_identity_and_solana_keypairs([9u8; 32]);

    // --- Off-chain node, RpcConnected against the same validator ---
    let (endpoint, _handle) = support::spawn_node_with_chain(&validator.rpc_url).await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });

    // A real off-chain proposal for the vote to attach to.
    let proposal_author = IdentityKeypair::generate();
    let proposal_author_peer = peer_id_from_public_key(&proposal_author.public_key()).unwrap();
    let proposal_id = "conformance-governance-1";
    client
        .send_proposal_create(
            ProposalCreate {
                id: openfiat_governance::ProposalId::new(proposal_id),
                title: "Conformance test proposal".to_string(),
                summary: "Exercises Phase 6's real on-chain vote-weight verification.".to_string(),
                category: ProposalCategory::Protocol,
                author: proposal_author_peer,
                author_public_key: proposal_author.public_key(),
                timestamp: Timestamp::now(),
            },
            &proposal_author,
        )
        .await
        .expect("sendProposalCreate must succeed");

    // The legitimate vote: self-reports a wildly wrong weight.
    let voter_peer = peer_id_from_public_key(&voter_identity.public_key()).unwrap();
    client
        .send_vote_cast(
            VoteCast {
                proposal_id: openfiat_governance::ProposalId::new(proposal_id),
                voter: voter_peer.clone(),
                voter_public_key: voter_identity.public_key(),
                choice: VoteChoice::Approve,
                weight: 999_999_999, // a deliberate lie
                stake_account: stake_account_pda.to_string(),
                timestamp: Timestamp::now(),
            },
            &voter_identity,
        )
        .await
        .expect("sendVoteCast must be accepted (queued) even before verification completes");

    // The attacker vote: claims the *voter's* real stake account, but
    // signs with a different identity — `voter_public_key` won't match
    // the decoded StakeAccount.owner, so this must never be applied.
    let attacker_peer = peer_id_from_public_key(&attacker_identity.public_key()).unwrap();
    client
        .send_vote_cast(
            VoteCast {
                proposal_id: openfiat_governance::ProposalId::new(proposal_id),
                voter: attacker_peer,
                voter_public_key: attacker_identity.public_key(),
                choice: VoteChoice::Reject,
                weight: 1,
                stake_account: stake_account_pda.to_string(), // not theirs
                timestamp: Timestamp::now(),
            },
            &attacker_identity,
        )
        .await
        .expect("sendVoteCast must be accepted (queued) regardless of the eventual verification outcome");

    // CHAIN_POLL_INTERVAL is 10s in production; poll_vote_verifications
    // runs on the same tick. Wait out at least one full cycle with margin.
    let mut proposal = client.get_proposal(proposal_id).await.unwrap();
    for _ in 0..30 {
        if let Some(p) = &proposal
            && !p.votes.is_empty()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(1_000)).await;
        proposal = client.get_proposal(proposal_id).await.unwrap();
    }

    let proposal = proposal.expect("the off-chain proposal must exist");
    assert_eq!(
        proposal.votes.len(),
        1,
        "exactly one vote should have been applied — the legitimate voter's, not the attacker's fraudulent claim on the same stake account"
    );
    let recorded = &proposal.votes[0];
    assert_eq!(recorded.voter, voter_peer);
    assert_eq!(
        recorded.weight, real_staked_amount,
        "the applied weight must be the real, independently-decoded on-chain staked amount, not the vote's self-reported (999_999_999) lie"
    );
}
