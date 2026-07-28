//! Proves `onchain::staking`'s instruction builders against a *real*
//! `solana-test-validator` running the actual compiled `openfiat-staking`
//! program — not just well-formed bytes, but bytes a real deployed
//! program actually accepts and acts on. This is Phase 7's first genuine
//! end-to-end proof for the on-chain SDK wiring (the full multi-program
//! trade/dispute/governance conformance proofs are Phase 9's job, run
//! against a full cluster with all three programs and a real mint — see
//! the plan's own phase split).
//!
//! `initialize_stake_account` is deliberately the instruction proven
//! here: unlike almost every other instruction across all three
//! programs, it touches no SPL token mint or token account at all
//! (`owner: Signer, stake_account: init, system_program` — see
//! `openfiat-core/programs/programs/staking/src/instructions/
//! initialize_stake_account.rs`), so this test needs no Token-2022 mint
//! setup to exercise a real, complete instruction round trip: build with
//! this SDK, sign, submit, confirm, then read the resulting account back
//! and independently decode its bytes.
//!
//! Requires `solana-test-validator` on `PATH` (already installed in this
//! environment) and the compiled `staking.so` at
//! `openfiat-core/programs/target/deploy/staking.so` (built by this
//! workspace's own `anchor build`, already present from Phase 5a).
//! Skips itself (rather than failing) if either isn't available, so a
//! machine without the Solana CLI toolchain doesn't break `cargo test`.

use openfiat_sdk::onchain::staking::{initialize_stake_account_ix, stake_account_pda};
use openfiat_sdk::onchain::{Role, STAKING_PROGRAM_ID};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_hash::Hash;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

const STAKING_SO_RELATIVE: &str = "../../openfiat-core/programs/target/deploy/staking.so";
const RPC_URL: &str = "http://127.0.0.1:8912";

struct TestValidator {
    process: Child,
}

impl Drop for TestValidator {
    fn drop(&mut self) {
        let _ = self.process.kill();
        let _ = self.process.wait();
    }
}

/// Starts a throwaway `solana-test-validator` with only `staking.so`
/// loaded, on a non-default port so it can't collide with a developer's
/// own locally running validator. Returns `None` (test should skip, not
/// fail) if the validator binary or the compiled program isn't present.
fn spawn_validator() -> Option<TestValidator> {
    let so_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(STAKING_SO_RELATIVE);
    if !so_path.exists() {
        eprintln!(
            "skipping: {} not found — run `anchor build` in openfiat-core/programs first",
            so_path.display()
        );
        return None;
    }
    if Command::new("solana-test-validator")
        .arg("--version")
        .stdout(Stdio::null())
        .status()
        .is_err()
    {
        eprintln!("skipping: solana-test-validator not found on PATH");
        return None;
    }

    let ledger =
        std::env::temp_dir().join(format!("openfiat-sdk-test-ledger-{}", std::process::id()));
    let process = Command::new("solana-test-validator")
        .args([
            "--reset",
            "--quiet",
            "--ledger",
            ledger.to_str().unwrap(),
            "--rpc-port",
            "8912",
            "--faucet-port",
            "9912",
            "--bpf-program",
            &STAKING_PROGRAM_ID.to_string(),
            so_path.to_str().unwrap(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn solana-test-validator");

    Some(TestValidator { process })
}

/// Polls `getLatestBlockhash` until the validator is actually accepting
/// RPC calls (it takes a few seconds to boot) — bounded so a genuinely
/// broken validator fails the test rather than hanging forever.
async fn wait_until_ready(client: &RpcClient) -> Hash {
    for _ in 0..60 {
        if let Ok(hash) = client.get_latest_blockhash().await {
            return hash;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    panic!("solana-test-validator did not become ready in time");
}

async fn airdrop_and_confirm(client: &RpcClient, to: &solana_pubkey::Pubkey, lamports: u64) {
    let signature = client
        .request_airdrop(to, lamports)
        .await
        .expect("airdrop request failed");
    for _ in 0..60 {
        if let Ok(true) = client.confirm_transaction(&signature).await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    panic!("airdrop was never confirmed");
}

#[tokio::test]
async fn initialize_stake_account_ix_is_accepted_by_the_real_staking_program() {
    let Some(_validator) = spawn_validator() else {
        return;
    };

    let client = RpcClient::new(RPC_URL.to_string());
    let blockhash = wait_until_ready(&client).await;

    let owner = Keypair::new();
    airdrop_and_confirm(&client, &owner.pubkey(), 1_000_000_000).await;

    let ix = initialize_stake_account_ix(&owner.pubkey(), Role::Merchant);

    let message = Message::new_with_blockhash(&[ix], Some(&owner.pubkey()), &blockhash);
    let transaction = Transaction::new(&[&owner], message, blockhash);

    let signature = client
        .send_and_confirm_transaction(&transaction)
        .await
        .expect("initialize_stake_account_ix must be accepted by the real staking program");
    assert!(!signature.to_string().is_empty());

    let (stake_account_pda, _bump) = stake_account_pda(&owner.pubkey(), Role::Merchant);
    let account = client
        .get_account_with_commitment(&stake_account_pda, CommitmentConfig::confirmed())
        .await
        .expect("rpc call failed")
        .value
        .expect("the real program must have created this account");

    // Layout matches `openfiat-core/crates/rpc/src/onchain_stake.rs`'s
    // own decoder exactly: discriminator(8) + owner(32) + role(1) +
    // amount(8) — independently confirms the real program wrote the
    // owner and a zero starting stake, not just that *some* account
    // exists at this address.
    assert_eq!(account.data.len(), 8 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 1);
    assert_eq!(&account.data[8..40], owner.pubkey().to_bytes());
    assert_eq!(account.data[40], Role::Merchant as u8);
    let amount = u64::from_le_bytes(account.data[41..49].try_into().unwrap());
    assert_eq!(
        amount, 0,
        "a freshly initialized stake account has zero staked"
    );
}
