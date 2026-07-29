//! Shared harness for Phase 9's conformance suite: a real
//! `solana-test-validator` with `openfiat-escrow`/`openfiat-staking`/
//! `openfiat-governance` all loaded, a real off-chain OpenFiat node
//! (`openfiat_rpc::spawn_actor`, the same one `openfiat-cli` runs) in
//! `RpcConnected` mode pointed at it, and a fresh Token-2022 test mint
//! this process actually controls — unlike the real devnet OPEN mint
//! (Phase 8 confirmed its mint authority is permanently unset), so no
//! conformance run could ever fund a test wallet from it.
//!
//! Not a `#[test]` file itself (Cargo only auto-discovers top-level
//! `tests/*.rs` files as test binaries) — each real conformance test
//! under `tests/conformance_*.rs` pulls this in via `mod support;` and
//! calls into it.

use openfiat_chain::NodeChainMode;
use openfiat_rpc::{NetworkConfig, RpcHandle};
use openfiat_sdk::onchain::{ESCROW_PROGRAM_ID, GOVERNANCE_PROGRAM_ID, STAKING_PROGRAM_ID};
use openfiat_storage::mem::MemoryStore;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_hash::Hash;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

pub const TOKEN_2022_PROGRAM_ID: Pubkey =
    solana_pubkey::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// A throwaway validator instance for one conformance test — `Drop` kills
/// the child process so a panicking assertion doesn't leak it.
pub struct TestValidator {
    process: Child,
    pub rpc_url: String,
}

impl Drop for TestValidator {
    fn drop(&mut self) {
        let _ = self.process.kill();
        let _ = self.process.wait();
    }
}

/// One `(program_id, path-to-.so relative to this crate)` pair to load
/// into the validator via `--bpf-program`.
pub struct ProgramFixture {
    pub id: Pubkey,
    pub so_relative_path: &'static str,
}

pub fn escrow_staking_governance_fixtures() -> [ProgramFixture; 3] {
    [
        ProgramFixture {
            id: ESCROW_PROGRAM_ID,
            so_relative_path: "../../openfiat-core/programs/target/deploy/escrow.so",
        },
        ProgramFixture {
            id: STAKING_PROGRAM_ID,
            so_relative_path: "../../openfiat-core/programs/target/deploy/staking.so",
        },
        ProgramFixture {
            id: GOVERNANCE_PROGRAM_ID,
            so_relative_path: "../../openfiat-core/programs/target/deploy/governance.so",
        },
    ]
}

/// Spawns a validator with the given programs loaded, on a port derived
/// from `port_offset` so multiple conformance tests can run concurrently
/// (`cargo test` runs integration test binaries in parallel by default)
/// without colliding. Returns `None` (caller should skip, not fail) if
/// `solana-test-validator` or any `.so` file isn't present — matching
/// `onchain_live_validator.rs`'s own precedent for a machine without the
/// Solana CLI toolchain.
pub fn spawn_validator(fixtures: &[ProgramFixture], port_offset: u16) -> Option<TestValidator> {
    for fixture in fixtures {
        let so_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(fixture.so_relative_path);
        if !so_path.exists() {
            eprintln!(
                "skipping: {} not found — run `anchor build` in openfiat-core/programs first",
                so_path.display()
            );
            return None;
        }
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

    // `* 10` spacing, not `+ port_offset` directly: `solana-test-validator`
    // always binds its RPC PubSub/WebSocket port at `rpc_port + 1`
    // (no separate flag controls it) — with 1-apart offsets, instance
    // N's pubsub port collides with instance N+1's own RPC port.
    // Confirmed via a real "Address already in use" on the RPC bind,
    // traced to another instance's PID via `lsof -i`, not assumed.
    let rpc_port = 8_900 + port_offset * 10;
    let faucet_port = 9_900 + port_offset * 10;
    // `solana-test-validator` binds gossip (and its other dynamic ports)
    // to a fixed default range regardless of `--rpc-port` — with several
    // conformance tests each spawning their own validator concurrently
    // (`cargo test` runs integration test binaries in parallel), every
    // instance but the first panics on startup with "Address already in
    // use" unless each gets its own non-overlapping range. Confirmed via
    // a real crash log, not a hypothetical: `gossip_addr bind_to port
    // 8000: Address already in use`.
    // 50-port spacing per instance; the range itself must be at least
    // ~26 ports wide or `solana-test-validator` rejects it outright
    // ("Port range is too small") — confirmed via its own real error.
    let dynamic_port_base = 10_000 + port_offset * 50;
    let dynamic_port_range = format!("{dynamic_port_base}-{}", dynamic_port_base + 39);
    let ledger = std::env::temp_dir().join(format!(
        "openfiat-conformance-ledger-{}-{}",
        std::process::id(),
        port_offset
    ));

    let mut args: Vec<String> = vec![
        "--reset".into(),
        "--quiet".into(),
        "--ledger".into(),
        ledger.to_str().unwrap().into(),
        "--rpc-port".into(),
        rpc_port.to_string(),
        "--faucet-port".into(),
        faucet_port.to_string(),
        "--dynamic-port-range".into(),
        dynamic_port_range,
        // Belt-and-suspenders: the actual crash was specifically
        // `gossip_addr bind_to port 8000`, a fixed default independent
        // of `--dynamic-port-range` — pin it explicitly too, one port
        // below this instance's own dynamic range.
        "--gossip-port".into(),
        (dynamic_port_base - 1).to_string(),
    ];
    for fixture in fixtures {
        let so_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(fixture.so_relative_path);
        args.push("--bpf-program".into());
        args.push(fixture.id.to_string());
        args.push(so_path.to_str().unwrap().into());
    }

    let process = Command::new("solana-test-validator")
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn solana-test-validator");

    Some(TestValidator {
        process,
        rpc_url: format!("http://127.0.0.1:{rpc_port}"),
    })
}

pub async fn wait_until_ready(client: &RpcClient) -> Hash {
    // 180 tries * 500ms = 90s — generous because `cargo test` runs every
    // conformance test's own validator concurrently; several real
    // solana-test-validator instances competing for CPU on one machine
    // (confirmed via top: each wants 100%+ on its own) genuinely need
    // more than a lone instance's usual ~5-10s boot time.
    for _ in 0..180 {
        if let Ok(hash) = client.get_latest_blockhash().await {
            return hash;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    panic!("solana-test-validator did not become ready in time");
}

pub async fn airdrop_and_confirm(client: &RpcClient, to: &Pubkey, lamports: u64) {
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

pub async fn submit(
    client: &RpcClient,
    payer: &Keypair,
    instructions: &[Instruction],
    extra_signers: &[&Keypair],
) -> String {
    let blockhash = client.get_latest_blockhash().await.expect("blockhash");
    let message = Message::new_with_blockhash(instructions, Some(&payer.pubkey()), &blockhash);
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra_signers);
    let transaction = Transaction::new(&signers, message, blockhash);
    client
        .send_and_confirm_transaction(&transaction)
        .await
        .unwrap_or_else(|e| panic!("transaction failed: {e}"))
        .to_string()
}

// --- Hand-rolled Token-2022 base instructions -----------------------------
//
// Not the full `spl-token-2022` crate (its `confidential-transfer`
// extension code fails to build standalone at the version this workspace
// would otherwise pull in — a real, verified compile failure, not a
// hypothetical one) — these three base instructions (stable, unchanged
// across the whole SPL Token / Token-2022 ecosystem for years) are simple
// enough to hand-encode directly, matching this whole workspace's own
// established preference for avoiding a heavy dependency over a narrow,
// well-specified wire format.

fn initialize_mint2_ix(mint: &Pubkey, mint_authority: &Pubkey, decimals: u8) -> Instruction {
    let mut data = vec![20u8]; // InitializeMint2
    data.push(decimals);
    data.extend_from_slice(mint_authority.as_ref());
    data.push(0); // freeze_authority: COption::None
    Instruction {
        program_id: TOKEN_2022_PROGRAM_ID,
        accounts: vec![AccountMeta::new(*mint, false)],
        data,
    }
}

fn initialize_account3_ix(account: &Pubkey, mint: &Pubkey, owner: &Pubkey) -> Instruction {
    let mut data = vec![18u8]; // InitializeAccount3
    data.extend_from_slice(owner.as_ref());
    Instruction {
        program_id: TOKEN_2022_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*account, false),
            AccountMeta::new_readonly(*mint, false),
        ],
        data,
    }
}

fn mint_to_ix(mint: &Pubkey, destination: &Pubkey, authority: &Pubkey, amount: u64) -> Instruction {
    let mut data = vec![7u8]; // MintTo
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: TOKEN_2022_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*mint, false),
            AccountMeta::new(*destination, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

const MINT_SPACE: u64 = 82;
const TOKEN_ACCOUNT_SPACE: u64 = 165;

/// Creates a fresh Token-2022 mint with `payer` as mint authority —
/// unlike the real devnet OPEN mint, this process can mint into it
/// freely. Returns the mint's keypair (its pubkey is the mint address).
pub async fn create_test_mint(client: &RpcClient, payer: &Keypair, decimals: u8) -> Keypair {
    let mint = Keypair::new();
    let rent = client
        .get_minimum_balance_for_rent_exemption(MINT_SPACE as usize)
        .await
        .expect("rent lookup failed");
    let create_account = solana_system_interface::instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent,
        MINT_SPACE,
        &TOKEN_2022_PROGRAM_ID,
    );
    let init = initialize_mint2_ix(&mint.pubkey(), &payer.pubkey(), decimals);
    submit(client, payer, &[create_account, init], &[&mint]).await;
    mint
}

/// Creates a plain (non-associated) Token-2022 token account for `mint`,
/// owned by `owner`, and mints `amount` into it from `mint_authority`
/// (must be the same key `create_test_mint` used). Returns the new
/// token account's own keypair.
pub async fn create_and_fund_token_account(
    client: &RpcClient,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
    mint_authority: &Keypair,
    amount: u64,
) -> Keypair {
    let account = Keypair::new();
    let rent = client
        .get_minimum_balance_for_rent_exemption(TOKEN_ACCOUNT_SPACE as usize)
        .await
        .expect("rent lookup failed");
    let create_account = solana_system_interface::instruction::create_account(
        &payer.pubkey(),
        &account.pubkey(),
        rent,
        TOKEN_ACCOUNT_SPACE,
        &TOKEN_2022_PROGRAM_ID,
    );
    let init = initialize_account3_ix(&account.pubkey(), mint, owner);
    submit(client, payer, &[create_account, init], &[&account]).await;

    if amount > 0 {
        let mint_to = mint_to_ix(mint, &account.pubkey(), &mint_authority.pubkey(), amount);
        if mint_authority.pubkey() == payer.pubkey() {
            submit(client, payer, &[mint_to], &[]).await;
        } else {
            submit(client, payer, &[mint_to], &[mint_authority]).await;
        }
    }
    account
}

/// Real off-chain node in `RpcConnected` mode, pointed at the given
/// validator's RPC URL, with `staking_program_id` wired so
/// `poll_vote_verifications` (Phase 6) can genuinely verify a
/// governance vote's on-chain stake. Returns `(http_base_url, RpcHandle)`.
pub async fn spawn_node_with_chain(rpc_url: &str) -> (String, RpcHandle) {
    let network = NetworkConfig {
        chain_mode: NodeChainMode::RpcConnected {
            rpc_urls: vec![rpc_url.to_string()],
            ws_url: None,
        },
        staking_program_id: Some(STAKING_PROGRAM_ID.to_string()),
        ..NetworkConfig::for_test()
    };
    let rpc_handle = openfiat_rpc::spawn_actor(MemoryStore::new, network);
    let metrics = std::sync::Arc::new(openfiat_metrics::MetricsRegistry::new());
    let router = openfiat_rpc::router(rpc_handle.clone(), metrics).merge(openfiat_api::router());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind an ephemeral port");
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (format!("http://{addr}"), rpc_handle)
}

/// Each integration test file is its own crate, so every one of them compiles
/// this module in full and warns about whatever it happens not to call. The
/// allow covers the binaries that do not use this helper rather than the
/// helper being unused outright.
#[allow(dead_code)]
pub fn commitment_confirmed() -> CommitmentConfig {
    CommitmentConfig::confirmed()
}
