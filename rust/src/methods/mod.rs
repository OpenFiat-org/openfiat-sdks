//! Typed `getX`/`sendX` methods, one module per domain — mirroring
//! `openfiat-core`'s own `crates/rpc/src/methods/` layout so the two
//! stay easy to compare. Each module adds an `impl Client` block; Rust
//! allows an inherent impl to be split across files in the same crate.

pub mod advertisements;
pub mod disputes;
pub mod governance;
pub mod identity;
pub mod node;
pub mod notifications;
pub mod oracles;
pub mod providers;
pub mod reputation;
pub mod reservations;
pub mod risk;
pub mod sessions;
pub mod settlement;
pub mod snapshot;
pub mod trade;
