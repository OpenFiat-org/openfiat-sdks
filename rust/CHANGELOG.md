# Changelog

All notable changes to `openfiat-sdk` (Rust) are documented here. This project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html); pre-1.0,
a breaking change bumps the minor.

## [0.2.0] - 2026-08-09

### Security

- **BREAKING — domain-separated signing preimages (F-01).** Client-signed wire
  events are now signed over `domain::preimage(tag, payload)` (a per-type `/v1`
  tag with a length-prefixed header) instead of the bare JSON body, binding the
  event's type into the signature. This SDK reuses openfiat-core's `Signed*`
  constructors, so the change is inherited by re-pinning to the F-01 core commit
  (`6b252db`). **A node must be running openfiat-core with F-01 for these
  signatures to verify, and older nodes reject them — upgrade node, SDKs, and
  app in lockstep (hard cutover).** The cross-language preimage layout is frozen
  by openfiat-core's `crates/serialization/tests/vectors/client_signed_v1.json`.

## [0.1.0]

- Initial pre-release.
