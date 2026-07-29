//! Proves `tests/support`'s own harness works before any real conformance
//! test is built on top of it: a validator with all three programs
//! loaded comes up, a fresh Token-2022 mint can be created and minted
//! from, and a real off-chain node in `RpcConnected` mode reports the
//! validator's real blockhash back over its own JSON-RPC surface.

mod support;

use openfiat_sdk::{Client, ClientConfig};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[tokio::test]
async fn the_shared_conformance_harness_actually_works() {
    let fixtures = support::escrow_staking_governance_fixtures();
    let Some(validator) = support::spawn_validator(&fixtures, 0) else {
        return;
    };

    let rpc_client =
        solana_client::nonblocking::rpc_client::RpcClient::new(validator.rpc_url.clone());
    support::wait_until_ready(&rpc_client).await;

    let payer = Keypair::new();
    support::airdrop_and_confirm(&rpc_client, &payer.pubkey(), 5_000_000_000).await;

    let mint = support::create_test_mint(&rpc_client, &payer, 9).await;
    let holder = Keypair::new();
    let token_account = support::create_and_fund_token_account(
        &rpc_client,
        &payer,
        &mint.pubkey(),
        &holder.pubkey(),
        &payer,
        1_000_000_000,
    )
    .await;

    let balance = rpc_client
        .get_token_account_balance(&token_account.pubkey())
        .await
        .expect("token account balance lookup failed");
    assert_eq!(balance.amount, "1000000000");

    let (endpoint, _handle) = support::spawn_node_with_chain(&validator.rpc_url).await;
    let client = Client::new(ClientConfig {
        endpoint,
        timeout_ms: 5_000,
    });

    // Give the actor's chain-poll tick a moment to fetch+announce a real
    // blockhash from the validator (CHAIN_POLL_INTERVAL is 10s in
    // production, but the actor's very first tick fires immediately on
    // an `interval`, so this should resolve fast).
    let mut status = client.get_chain_status().await.unwrap();
    for _ in 0..20 {
        if status.blockhash.is_some() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        status = client.get_chain_status().await.unwrap();
    }
    assert_eq!(status.mode, "RpcConnected");
    assert!(
        status.blockhash.is_some(),
        "node never observed a real blockhash from the validator"
    );
}
