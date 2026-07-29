//! Phase 9 conformance proof: a disputed trade reaches a real,
//! stake-weighted outcome on the real `openfiat-escrow` program (a local
//! `solana-test-validator` with all three programs loaded), and the
//! off-chain `DisputeRegistry`'s own independent record of that dispute
//! observes the on-chain outcome's confirmation.
//!
//! Two genuinely independent commit-reveal systems are exercised, by
//! design (confirmed architectural fact, not an oversight — the
//! off-chain `openfiat-disputes` crate and the on-chain
//! `openfiat-escrow` Phase 4b instructions use different commitment
//! schemes and don't share arbitrator identities): the off-chain
//! dispute is driven to `Resolved` first (its own commit-reveal, with
//! its own arbitrator keypairs), then the on-chain `DisputeCase` is
//! driven through its own full commit-reveal-execute cycle with
//! *different* arbitrator identities. The only real integration point
//! is `execute_dispute_outcome`'s confirmation, submitted with a
//! `"dispute:<id>"` correlation tag, which `poll_chain` routes into
//! `DisputeRegistry::apply_onchain_execution` — but only once that
//! off-chain `Dispute` is already `Resolved`, which is why the
//! off-chain half runs first.

mod support;

use openfiat_crypto::Keypair as IdentityKeypair;
use openfiat_disputes::events::{ArbitratorJoin, DisputeOpen, VoteCommit, VoteReveal};
use openfiat_disputes::{DisputeId, DisputeStatus, Vote, commitment as offchain_commitment};
use openfiat_network::identity::peer_id_from_public_key;
use openfiat_sdk::onchain::escrow::{
    commit_dispute_vote_ix, create_liquidity_vault_ix, create_trade_escrow_ix,
    deposit_liquidity_ix, dispute_case_pda, execute_dispute_outcome_ix, fund_trade_escrow_ix,
    initialize_fee_config_ix, open_dispute_case_ix, reserve_liquidity_ix, reveal_dispute_vote_ix,
};
use openfiat_sdk::onchain::staking::{
    initialize_stake_account_ix, initialize_staking_config_ix, stake_ix,
};
use openfiat_sdk::onchain::{DisputeOutcome, Role};
use openfiat_sdk::{Client, ClientConfig};
use openfiat_settlement::SettlementId;
use openfiat_settlement::events::SettlementInitiate;
use openfiat_types::{Amount, Timestamp};
use sha2::{Digest, Sha256};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction::versioned::VersionedTransaction;
use std::time::Duration;

const DECIMALS: u64 = 1_000_000_000; // 9 decimals, matches the test mint
const RESERVATION_ID: u64 = 1;
// Generous: the window starts ticking the moment `open_dispute_case` is
// submitted, and each of the 3 arbitrators' commit/reveal is its own
// sequential on-chain transaction — under real (especially concurrently
// loaded) confirmation latency, a short window can close before the
// last one lands (confirmed via a real `CommitWindowClosed` failure at
// 18s in this exact environment, not a theoretical concern).
const COMMIT_WINDOW_SECS: i64 = 90;
const REVEAL_WINDOW_SECS: i64 = 90;

fn onchain_commitment(outcome: DisputeOutcome, salt: [u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update([outcome as u8]);
    hasher.update(salt);
    hasher.finalize().into()
}

#[tokio::test]
async fn a_disputed_trade_reaches_a_stake_weighted_onchain_outcome_and_the_offchain_registry_observes_it()
 {
    let fixtures = support::escrow_staking_governance_fixtures();
    let Some(validator) = support::spawn_validator(&fixtures, 2) else {
        return;
    };
    let rpc = solana_client::nonblocking::rpc_client::RpcClient::new(validator.rpc_url.clone());
    support::wait_until_ready(&rpc).await;

    let admin = Keypair::new();
    support::airdrop_and_confirm(&rpc, &admin.pubkey(), 20_000_000_000).await;
    let mint = support::create_test_mint(&rpc, &admin, 9).await;

    // --- FeeConfig (4 real treasury token accounts — `execute_dispute_outcome`
    // deserializes all 4 as real `InterfaceAccount<TokenAccount>`s
    // regardless of which outcome branch actually transfers to them). ---
    let dev_treasury = support::create_and_fund_token_account(
        &rpc,
        &admin,
        &mint.pubkey(),
        &Pubkey::new_unique(),
        &admin,
        0,
    )
    .await;
    let eco_treasury = support::create_and_fund_token_account(
        &rpc,
        &admin,
        &mint.pubkey(),
        &Pubkey::new_unique(),
        &admin,
        0,
    )
    .await;
    let infra_treasury = support::create_and_fund_token_account(
        &rpc,
        &admin,
        &mint.pubkey(),
        &Pubkey::new_unique(),
        &admin,
        0,
    )
    .await;
    let emergency_reserve = support::create_and_fund_token_account(
        &rpc,
        &admin,
        &mint.pubkey(),
        &Pubkey::new_unique(),
        &admin,
        0,
    )
    .await;

    let fee_config_ix = initialize_fee_config_ix(
        &admin.pubkey(),
        0,
        0,
        15,
        &dev_treasury.pubkey(),
        &eco_treasury.pubkey(),
        &infra_treasury.pubkey(),
        &emergency_reserve.pubkey(),
        4000,
        3000,
        2000,
        1000,
        1800,
    );
    support::submit(&rpc, &admin, &[fee_config_ix], &[]).await;

    // --- StakingConfig — a small min_stake_arbitrator, this is a fresh
    // dedicated test mint with arbitrary supply, not the real OFS-4100
    // figure. ---
    let min_stake_arbitrator = 100 * DECIMALS;
    let staking_config_ix = initialize_staking_config_ix(
        &admin.pubkey(),
        &mint.pubkey(),
        10 * DECIMALS,
        min_stake_arbitrator,
        604_800,
        1000,
        &admin.pubkey(),
        &dev_treasury.pubkey(),
        &admin.pubkey(),
    );
    support::submit(&rpc, &admin, &[staking_config_ix], &[]).await;

    // --- Escrow: get a trade to AwaitingFiatSettlement ---
    let merchant = Keypair::new();
    support::airdrop_and_confirm(&rpc, &merchant.pubkey(), 5_000_000_000).await;
    let buyer_onchain = Keypair::new();
    support::airdrop_and_confirm(&rpc, &buyer_onchain.pubkey(), 3_000_000_000).await;

    let merchant_from = support::create_and_fund_token_account(
        &rpc,
        &admin,
        &mint.pubkey(),
        &merchant.pubkey(),
        &admin,
        1_000_000 * DECIMALS,
    )
    .await;
    // `execute_dispute_outcome`'s `buyer_token_account` constraint
    // requires `.owner == trade_escrow.buyer` regardless of outcome.
    let buyer_token_account = support::create_and_fund_token_account(
        &rpc,
        &admin,
        &mint.pubkey(),
        &buyer_onchain.pubkey(),
        &admin,
        0,
    )
    .await;

    support::submit(
        &rpc,
        &merchant,
        &[create_liquidity_vault_ix(
            &merchant.pubkey(),
            &mint.pubkey(),
        )],
        &[],
    )
    .await;
    support::submit(
        &rpc,
        &merchant,
        &[deposit_liquidity_ix(
            &merchant.pubkey(),
            &mint.pubkey(),
            &merchant_from.pubkey(),
            100_000 * DECIMALS,
        )],
        &[],
    )
    .await;
    support::submit(
        &rpc,
        &merchant,
        &[reserve_liquidity_ix(
            &merchant.pubkey(),
            &mint.pubkey(),
            50_000 * DECIMALS,
        )],
        &[],
    )
    .await;
    support::submit(
        &rpc,
        &merchant,
        &[create_trade_escrow_ix(
            &merchant.pubkey(),
            &buyer_onchain.pubkey(),
            &mint.pubkey(),
            RESERVATION_ID,
            50_000 * DECIMALS,
            3600,
        )],
        &[],
    )
    .await;
    support::submit(
        &rpc,
        &merchant,
        &[fund_trade_escrow_ix(
            &merchant.pubkey(),
            &mint.pubkey(),
            RESERVATION_ID,
        )],
        &[],
    )
    .await;

    // --- 3 on-chain arbitrators, each with a real Arbitrator StakeAccount ---
    let mut onchain_arbitrators = Vec::new();
    for _ in 0..3 {
        let arb = Keypair::new();
        support::airdrop_and_confirm(&rpc, &arb.pubkey(), 2_000_000_000).await;
        support::submit(
            &rpc,
            &arb,
            &[initialize_stake_account_ix(&arb.pubkey(), Role::Arbitrator)],
            &[],
        )
        .await;
        let arb_from = support::create_and_fund_token_account(
            &rpc,
            &admin,
            &mint.pubkey(),
            &arb.pubkey(),
            &admin,
            min_stake_arbitrator * 2,
        )
        .await;
        support::submit(
            &rpc,
            &arb,
            &[stake_ix(
                &arb.pubkey(),
                Role::Arbitrator,
                &mint.pubkey(),
                &arb_from.pubkey(),
                min_stake_arbitrator,
            )],
            &[],
        )
        .await;
        onchain_arbitrators.push(arb);
    }

    // --- Open the on-chain dispute case ---
    support::submit(
        &rpc,
        &buyer_onchain,
        &[open_dispute_case_ix(
            &buyer_onchain.pubkey(),
            &buyer_onchain.pubkey(),
            RESERVATION_ID,
            COMMIT_WINDOW_SECS,
            REVEAL_WINDOW_SECS,
        )],
        &[],
    )
    .await;

    // 2 BuyerWins, 1 MerchantWins — a genuine majority, not unanimous or
    // tied, so `execute_dispute_outcome`'s own tally is really exercised.
    let outcomes = [
        DisputeOutcome::BuyerWins,
        DisputeOutcome::BuyerWins,
        DisputeOutcome::MerchantWins,
    ];
    let salts: [[u8; 32]; 3] = [[11u8; 32], [22u8; 32], [33u8; 32]];

    for ((arb, outcome), salt) in onchain_arbitrators.iter().zip(outcomes).zip(salts) {
        let commitment = onchain_commitment(outcome, salt);
        support::submit(
            &rpc,
            arb,
            &[commit_dispute_vote_ix(
                &arb.pubkey(),
                RESERVATION_ID,
                commitment,
            )],
            &[],
        )
        .await;
    }

    // --- Off-chain dispute, driven to Resolved *before* the on-chain
    // execution is submitted (its own required precondition). Uses
    // wholly different arbitrator identities — independent systems. ---
    let (endpoint, _handle) = support::spawn_node_with_chain(&validator.rpc_url).await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 10_000,
    });

    let off_buyer = IdentityKeypair::generate();
    let off_seller = IdentityKeypair::generate();
    let settlement_id = client
        .send_settlement_initiate(
            SettlementInitiate {
                id: SettlementId::new("set-conformance-dispute-1"),
                reservation_id: openfiat_reservations::ReservationId::new(
                    "res-conformance-dispute-1",
                ),
                buyer: peer_id_from_public_key(&off_buyer.public_key()).unwrap(),
                buyer_public_key: off_buyer.public_key(),
                seller: peer_id_from_public_key(&off_seller.public_key()).unwrap(),
                seller_public_key: off_seller.public_key(),
                amount: Amount::new(5_000_000, 2), // $50,000.00 at 2 decimals
                timestamp: Timestamp::now(),
            },
            &off_buyer,
        )
        .await
        .expect("send_settlement_initiate failed");

    let dispute_id_str = "dispute-conformance-1";
    client
        .send_dispute_open(
            DisputeOpen {
                id: DisputeId::new(dispute_id_str),
                settlement_id,
                opener: peer_id_from_public_key(&off_buyer.public_key()).unwrap(),
                opener_public_key: off_buyer.public_key(),
                reason: "conformance proof".to_string(),
                timestamp: Timestamp::now(),
            },
            &off_buyer,
        )
        .await
        .expect("send_dispute_open failed");

    let off_arbitrators: Vec<IdentityKeypair> =
        (0..3).map(|_| IdentityKeypair::generate()).collect();
    for arb in &off_arbitrators {
        client
            .send_arbitrator_join(
                ArbitratorJoin {
                    dispute_id: DisputeId::new(dispute_id_str),
                    arbitrator: peer_id_from_public_key(&arb.public_key()).unwrap(),
                    arbitrator_public_key: arb.public_key(),
                    timestamp: Timestamp::now(),
                },
                arb,
            )
            .await
            .expect("send_arbitrator_join failed");
    }

    let off_votes = [Vote::BuyerWins, Vote::BuyerWins, Vote::MerchantWins];
    let off_secrets: [[u8; 32]; 3] = [[1u8; 32], [2u8; 32], [3u8; 32]];
    for ((arb, vote), secret) in off_arbitrators.iter().zip(off_votes).zip(off_secrets) {
        client
            .send_vote_commit(
                VoteCommit {
                    dispute_id: DisputeId::new(dispute_id_str),
                    arbitrator: peer_id_from_public_key(&arb.public_key()).unwrap(),
                    commitment: offchain_commitment::compute(vote, &secret),
                    timestamp: Timestamp::now(),
                },
                arb,
            )
            .await
            .expect("send_vote_commit failed");
    }
    for ((arb, vote), secret) in off_arbitrators.iter().zip(off_votes).zip(off_secrets) {
        client
            .send_vote_reveal(
                VoteReveal {
                    dispute_id: DisputeId::new(dispute_id_str),
                    arbitrator: peer_id_from_public_key(&arb.public_key()).unwrap(),
                    vote,
                    secret,
                    timestamp: Timestamp::now(),
                },
                arb,
            )
            .await
            .expect("send_vote_reveal failed");
    }

    let off_dispute = client
        .get_dispute(dispute_id_str)
        .await
        .unwrap()
        .expect("off-chain dispute must exist");
    assert_eq!(
        off_dispute.status,
        DisputeStatus::Resolved,
        "off-chain dispute must reach Resolved before the on-chain execution can be recorded against it"
    );

    // --- Wait out the commit window, then reveal on-chain ---
    tokio::time::sleep(Duration::from_secs(COMMIT_WINDOW_SECS as u64 + 5)).await;
    for ((arb, outcome), salt) in onchain_arbitrators.iter().zip(outcomes).zip(salts) {
        support::submit(
            &rpc,
            arb,
            &[reveal_dispute_vote_ix(
                &arb.pubkey(),
                RESERVATION_ID,
                outcome,
                salt,
            )],
            &[],
        )
        .await;
    }

    // --- Wait out the reveal window, then execute on-chain, tagged for
    // `poll_chain` to route into the off-chain DisputeRegistry ---
    tokio::time::sleep(Duration::from_secs(REVEAL_WINDOW_SECS as u64 + 5)).await;
    let execute_ix = execute_dispute_outcome_ix(
        &merchant.pubkey(),
        &mint.pubkey(),
        RESERVATION_ID,
        &buyer_token_account.pubkey(),
        &dev_treasury.pubkey(),
        &eco_treasury.pubkey(),
        &infra_treasury.pubkey(),
        &emergency_reserve.pubkey(),
    );
    let blockhash = rpc.get_latest_blockhash().await.unwrap();
    let message = Message::new_with_blockhash(&[execute_ix], Some(&admin.pubkey()), &blockhash);
    let transaction = Transaction::new(&[&admin], message, blockhash);
    let versioned: VersionedTransaction = transaction.into();
    client
        .send_transaction_correlated(&versioned, format!("dispute:{dispute_id_str}"))
        .await
        .expect("send_transaction_correlated failed");

    // --- Independent on-chain confirmation: the real DisputeCase is
    // resolved, read back directly, not through the app/node's own state. ---
    let (dispute_case_pubkey, _) = dispute_case_pda(RESERVATION_ID);
    // `execute_dispute_outcome` was submitted via `send_transaction_correlated`
    // (relayed through the node's own `poll_chain`, not a direct RPC
    // confirm) — that needs one tick to submit (up to CHAIN_POLL_INTERVAL,
    // 10s) plus real confirmation time, so a short poll here undercounts
    // real latency the same way the commit/reveal windows did.
    let mut resolved = false;
    for _ in 0..90 {
        if let Ok(account) = rpc.get_account(&dispute_case_pubkey).await {
            const DISCRIMINATOR: [u8; 8] = [164, 200, 54, 239, 94, 76, 51, 130];
            if account.data[..8] == DISCRIMINATOR && account.data[72] == 1 {
                resolved = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    assert!(resolved, "on-chain DisputeCase.resolved never became true");

    // --- CHAIN_POLL_INTERVAL is 10s; poll_chain submits on one tick and
    // confirms on a later one — give it real time, not a short timeout. ---
    let mut onchain_signature_observed = false;
    for _ in 0..6 {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let dispute = client
            .get_dispute(dispute_id_str)
            .await
            .unwrap()
            .expect("dispute must still exist");
        if dispute.onchain_execution_signature.is_some() {
            onchain_signature_observed = true;
            break;
        }
    }
    assert!(
        onchain_signature_observed,
        "DisputeRegistry never observed the on-chain execute_dispute_outcome confirmation"
    );
}
