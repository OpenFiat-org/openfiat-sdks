# Changelog

All notable changes to `openfiat-sdks` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-07

First public developer preview. Targets Solana devnet; APIs are pre-1.0 and
subject to change between 0.x releases.

### Added

- **TypeScript SDK (`@openfiat/sdk`)** published to npm: typed JSON-RPC
  `Client` (OFS-8200), Ed25519 event signing, per-domain typed methods, the
  Solana chain bridge (OFS-4300), and on-chain instruction builders for the
  escrow/staking/governance programs (OFS-4200).
- Tag-driven release workflow (`v*` tags) publishing the npm package with
  build provenance.
- Initial repository scaffold: directory layout, CI, developer tooling,
  and community health files.

### Not yet released

- The Rust SDK (`openfiat-sdk` crate) is built and tested but not yet on
  crates.io: it depends on `openfiat-core` crates that must be published to
  crates.io first.

[Unreleased]: https://github.com/OpenFiat-org/openfiat-sdks/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OpenFiat-org/openfiat-sdks/releases/tag/v0.1.0
