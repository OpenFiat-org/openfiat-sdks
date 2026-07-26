<div align="center">

# openfiat-sdks

**Official OpenFiat SDKs (Rust, TypeScript, Python; additional languages deferred) and shared reference data.**

[![CI](https://github.com/OpenFiat-org/openfiat-sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenFiat-org/openfiat-sdks/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Discussions](https://img.shields.io/github/discussions/OpenFiat-org/openfiat-sdks)](https://github.com/orgs/OpenFiat-org/discussions)

[Website](https://openfiat.org) · [Docs](https://docs.openfiat.org) · [Specs](https://github.com/OpenFiat-org/openfiat-specs) · [Contributing](CONTRIBUTING.md)

</div>

---

## About

`openfiat-sdks` is part of the [OpenFiat](https://github.com/OpenFiat-org)
ecosystem — an open, decentralized peer-to-peer protocol for exchanging
stablecoins for local fiat currency. Solana secures asset settlement through
audited smart contracts; OpenFiat coordinates the peer-to-peer marketplace
layer (discovery, advertisements, reputation, governance, notifications, and
more) without centralized infrastructure.

This repository (SDK) — official openfiat sdks (rust, typescript, python; additional languages deferred) and shared reference data.

For the full protocol motivation and design, see the
[whitepaper](https://github.com/OpenFiat-org/openfiat-specs) and the
[protocol specifications](https://github.com/OpenFiat-org/openfiat-specs/tree/main/Whitepaper/Specifications).

## Repository layout

```
.
├── rust/              # openfiat-sdk crate (Cargo.toml, src/, examples/, tests/)
├── typescript/         # @openfiat/sdk package (package.json, src/, tests/, examples/)
├── python/             # openfiat-sdk package (pyproject.toml, src/, tests/, examples/)
├── go/ swift/ kotlin/ csharp/   # deferred placeholders — see each README.md
├── reference-data/     # countries, currencies, payment methods (+ JSON Schemas, validator)
├── docs/
└── examples/
```

Each language SDK is self-contained with its own manifest — there is no
cross-language build step. See each subdirectory's own quickstart in its
README/source comments.


## Quick start

```bash
# Rust
cd rust && cargo build

# TypeScript
cd typescript && pnpm install && pnpm build

# Python
cd python && pip install -e ".[dev]"
```


## Development

Each SDK is linted/tested independently — see `.github/workflows/ci.yml` for
the exact commands run per language. Go/Swift/Kotlin/C# are deferred; see
their `README.md` files.


## Testing

```bash
(cd rust && cargo test)
(cd typescript && pnpm test)
(cd python && pytest)
(cd reference-data && python validate.py)
```


## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and
our [Code of Conduct](CODE_OF_CONDUCT.md) before opening a pull request.
Security issues should be reported per [SECURITY.md](SECURITY.md), not as
public issues.

See [ROADMAP.md](ROADMAP.md) for current priorities and
[CHANGELOG.md](CHANGELOG.md) for release history.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
