//! Building, signing, and submitting a real Solana transaction through
//! an OpenFiat node (OFS-4300): fetch the current blockhash, construct
//! and sign a transaction entirely client-side, then submit it via
//! `sendTransaction` — the node never sees an unsigned instruction or a
//! private key.
//!
//! Run against a local node with `cargo run --example solana_transaction`.
//! By default it targets `http://localhost:8080` — start one with
//! `CLI_HTTP_ADDR=127.0.0.1:8080 cargo run -p openfiat-cli` from
//! `openfiat-core`.
//!
//! A freshly started node has no `RpcConnected` mode configured and no
//! peer has announced a blockhash yet, so `getLatestBlockhash` returns
//! `ChainUnavailable` until one of those exists. This example falls back
//! to a locally-generated blockhash so it can still demonstrate the
//! sign-and-submit flow end to end — real usage should retry
//! `getLatestBlockhash` (or point at an `RpcConnected` node) instead.

use openfiat_sdk::{Client, ClientConfig};
use solana_hash::Hash;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction::versioned::VersionedTransaction;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let endpoint =
        std::env::var("OPENFIAT_NODE_URL").unwrap_or_else(|_| "http://localhost:8080".to_string());
    let client = Client::new(ClientConfig {
        endpoint,
        ..ClientConfig::default()
    });

    let status = client.get_chain_status().await?;
    println!("node chain mode: {}", status.mode);

    let blockhash = match client.get_latest_blockhash().await {
        Ok(latest) => {
            println!("using the node's own blockhash (slot {})", latest.slot);
            latest.blockhash.parse::<Hash>()?
        }
        Err(_) => {
            println!(
                "node has no blockhash yet (see this example's own doc comment) — using a local one"
            );
            Hash::new_unique()
        }
    };

    let payer = Keypair::new();
    let recipient = Pubkey::new_unique();
    let instruction: Instruction =
        solana_system_interface::instruction::transfer(&payer.pubkey(), &recipient, 1_000);
    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let transaction = Transaction::new(&[&payer], message, blockhash);
    let versioned: VersionedTransaction = transaction.into();

    client.send_transaction(&versioned).await?;
    println!("submitted — signature: {}", versioned.signatures[0]);
    Ok(())
}
