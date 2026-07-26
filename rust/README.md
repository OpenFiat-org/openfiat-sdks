# openfiat-sdk (Rust)

Official Rust SDK for the OpenFiat protocol. Part of the
[openfiat-sdks](https://github.com/OpenFiat-org/openfiat-sdks) monorepo — see
the repository root [README](../README.md) for the full monorepo layout.

```rust
use openfiat_sdk::{Client, ClientConfig};

let client = Client::new(ClientConfig::default());
```

See [`examples/basic_client.rs`](examples/basic_client.rs) for a runnable example.
