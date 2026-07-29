# openfiat-sdk (Rust)

Official Rust SDK for the OpenFiat protocol: a typed `Client` for a node's
JSON-RPC 2.0 surface (OFS-8200). Part of the
[openfiat-sdks](https://github.com/OpenFiat-org/openfiat-sdks) monorepo — see
the repository root [README](../README.md) for the full monorepo layout.

Domain types (`Advertisement`, `ProposalCreate`, `OracleRecord`, ...) are
reused directly from `openfiat-core` via a pinned git dependency (see
`Cargo.toml`), not redefined here — request/response shapes can't drift
from what a real node actually runs.

```rust
use openfiat_sdk::wallet::Keypair;
use openfiat_sdk::{Client, ClientConfig};

let client = Client::new(ClientConfig::default());
let version = client.get_version().await?;

// sendX methods take the domain's own unsigned event type and a keypair —
// the SDK signs and wire-encodes it, then submits it.
let keypair = Keypair::generate();
// let id = client.send_advertisement_create(create, &keypair).await?;
```

See [`examples/oracle_provider.rs`](examples/oracle_provider.rs) for a
complete, runnable example: registering as an Oracle Provider and
publishing a signed rate.

## Chain bridge (OFS-4300)

`get_chain_status`, `get_latest_blockhash`, and `send_transaction` reach
a node's bridge to the Solana execution layer — identical behavior
whether the node itself has a live Solana RPC connection or only gossip.
This SDK never constructs or signs a Solana transaction on your
behalf: build and sign one with `solana-transaction`/`solana-keypair`
(re-exported transitively; see this crate's own `Cargo.toml` for the
exact versions verified to compile together), then submit it:

```rust
let blockhash = client.get_latest_blockhash().await?.blockhash.parse()?;
// ...build and sign a `solana_transaction::versioned::VersionedTransaction`...
client.send_transaction(&versioned).await?;
```

See [`examples/solana_transaction.rs`](examples/solana_transaction.rs)
for a complete, runnable example.

## On-chain programs (OFS-4200)

`openfiat_sdk::onchain::{escrow, staking, governance}` builds instructions
for the three deployed Anchor programs directly — PDA derivation, account
lists, and Anchor-wire-format instruction data (an 8-byte discriminator
sourced from the real `anchor build` IDL, plus Borsh-encoded args), with no
`anchor-lang`/`anchor-client` dependency:

```rust
use openfiat_sdk::onchain::{Role, staking};

let ix = staking::stake_ix(&owner, Role::Arbitrator, &mint, &from, amount);
// sign and submit with solana-transaction/solana-keypair, same as the chain
// bridge above — this module only builds instructions, it never submits one.
```

See [`examples/stake_and_vote.rs`](examples/stake_and_vote.rs) for a full
stake → propose → vote sequence across all three programs.

Off-chain dispute methods (`get_dispute`, `get_disputes`,
`send_arbitrator_join`, `send_vote_commit`, `send_vote_reveal`) are on
`Client` itself, alongside every other domain — they're gossip protocol
calls (OFS-2400), not on-chain instructions, so they don't live under
`onchain`.

## Errors

Every `Result<T, openfiat_sdk::Error>` distinguishes transport failure
(`Error::Transport`, `Error::Decode`) from a JSON-RPC-level error
(`Error::JsonRpc`, the standard `-32700`/`-32601`/`-32602`/`-32603` codes)
from an application-level failure (`Error::Application`, carrying
OFS-8000's own numeric code and symbolic name).
