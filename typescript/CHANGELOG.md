# Changelog

All notable changes to `@openfiat/sdk` (TypeScript) will be documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0-rc.1] - 2026-08-10

First pre-release of the 0.2.0 line (published to npm under the `next`
dist-tag). Audit-gated / devnet-only: on-chain programs are not on mainnet.

### Added

- **`debridge.buildDeliverContributionHook` — deBridge DLN Solana Hook
  calldata for cross-chain presale contributions (SP-B).** Builds the
  `{ type: "solana_serialized_instructions", data: { instructions: "0x..." } }`
  hook the DLN `create-tx` API's `dlnHook` parameter accepts (per the
  live `create-tx` Swagger spec — flagged for live confirmation before
  it's used to place a real order, see the module doc), wrapping an Anchor
  `presale::deliver_contribution` call in deBridge's own
  `ExternalInstruction` binary layout (implemented directly against
  deBridge's public Solidity reference serializer and checked
  byte-for-byte against a worked example from deBridge's own docs —
  see `src/debridge/hook.ts`'s module doc for the full sourcing and the
  format assumptions still needing live-deBridge validation). The
  executor-provided `payer`/`source_usdc` accounts are written as
  deBridge's own `AUTHORITY_PLACEHOLDER`/`WALLET_PLACEHOLDER`, never
  accepted as parameters. New: `src/debridge/hook.ts`, exported as
  `debridge` from the package root alongside `onchain`.

### Breaking

- **Domain-separated signing preimages for every client-signed wire event
  (F-01).** Every method that signs and submits an event —
  advertisements (create, status set, terms update, price update),
  reservations (request, cancel), settlement (initiate, payment submitted,
  payment reversed, rejected, cancelled), provider registry (registration,
  health update, withdrawal), oracle publish, and notifications
  (subscription update, delivery report) — now signs
  `preimage(tag, payload) = len(tag):u32be ‖ utf8(tag) ‖ json(payload)`
  instead of bare `json(payload)`. The JSON body itself is unchanged; only
  a length-prefixed, type-specific tag is now prepended before signing.
  This closes a class of signature-replay collisions where two event types
  with the same field shape shared a preimage and one signature validated
  for the other.

  New: `src/domain.ts` (`preimage`, `preimageOf`) and `src/tags.ts` (the
  per-type tag literals this SDK signs, byte-identical to
  `openfiat-core`'s `crates/serialization/src/domain.rs`). Conformance
  against the Rust side is proven by
  `tests/conformance_vectors.test.ts` against vendored vectors in
  `tests/vectors/client_signed_v1.json`.

  **A node built before F-01 landed (`openfiat-core` commit `451e52e` /
  the domain-separation series through `6b252db`) rejects every signed
  event this version of the SDK sends, and this version of the SDK
  rejects — by construction, since it never produces them — the
  un-tagged signatures an older SDK build would have accepted. Upgrade
  the node and every signer (Rust SDK, TypeScript SDK, app) together;
  there is no dual-accept window.** The challenge/auth flows in
  `methods/wallet.ts` and `earningsChallengeBytes` in `methods/providers.ts`
  are unaffected — they use a separate, pre-existing domain scheme and were
  not touched.

## [0.1.0]

Initial developer preview.
