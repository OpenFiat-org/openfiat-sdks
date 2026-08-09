# F-01 domain separation — TypeScript SDK

Branch: `sdd/f01-domain-separation`, repo `openfiat-sdks`.

## Sign site -> tag mapping

| File | Function | Payload var | Tag |
|---|---|---|---|
| `src/methods/advertisements.ts` | `sendAdvertisementCreate` | `create` | `tags.AdvertisementCreate` |
| | `sendAdvertisementStatusSet` | `set` | `tags.AdvertisementStatusSet` |
| | `sendAdvertisementTermsUpdate` | `update` | `tags.AdvertisementTermsUpdate` |
| | `sendAdvertisementPriceUpdate` | `update` | `tags.AdvertisementPriceUpdate` |
| `src/methods/reservations.ts` | `sendReservationRequest` | `request` | `tags.ReservationRequest` |
| | `sendReservationCancel` | `cancel` | `tags.ReservationCancel` |
| `src/methods/providers.ts` | `sendProviderRegister` | `registration` | `tags.Registration` |
| | `sendProviderHealthUpdate` | `update` | `tags.HealthUpdate` |
| | `sendProviderWithdraw` | `withdrawal` | `tags.Withdrawal` |
| `src/methods/settlement.ts` | `sendSettlementInitiate` | `initiate` | `tags.SettlementInitiate` |
| | `sendPaymentSubmitted` | `payment` | `tags.PaymentSubmitted` |
| | `sendPaymentReversed` | `reversed` | `tags.PaymentReversed` |
| | `sendSettlementRejected` | `rejected` | `tags.SettlementRejected` |
| | `sendSettlementCancelled` | `cancelled` | `tags.SettlementCancelled` |
| `src/methods/oracles.ts` | `sendOraclePublish` | `publish` | `tags.OraclePublish` |
| `src/methods/notifications.ts` | `sendSubscriptionUpdate` | `update` | `tags.SubscriptionUpdate` |
| | `sendDeliveryReport` | `report` | `tags.DeliveryReport` |

Left alone (separate, pre-existing challenge/auth domain scheme, per spec):
`methods/wallet.ts` (`walletChallengeBytes`/`walletProof`) and
`earningsChallengeBytes` in `methods/providers.ts`.

### Ambiguous / flagged mapping

- **`SettlementApproved` has no TS sign site.** The spec's settlement map
  lists `approved→SettlementApproved`, but `src/methods/settlement.ts` has
  no `sendSettlementApproved`/equivalent function — grepping the whole
  `methods/` tree for `sign(keypair` + `JSON.stringify` turns up exactly
  five settlement sign sites (initiate, payment, reversed, rejected,
  cancelled), and nothing approval-shaped. I kept `SettlementApproved` in
  `src/tags.ts` for forward compatibility (matches the Rust tag exactly,
  costs nothing) but there was no call site to wire it into. If the TS SDK
  is meant to have a `sendSettlementApproved`, that method does not exist
  yet and is out of scope for this domain-separation pass — flagging for
  the controller rather than inventing a new method.

## Files added

- `typescript/src/domain.ts` — `preimage(tag, body)` and
  `preimageOf(tag, payload)`. Big-endian `u32` length prefix via
  `DataView.setUint32(0, n, false)`.
- `typescript/src/tags.ts` — `tags` const object, one entry per sign site
  above, literals copied verbatim from
  `/OpenFiat/openfiat-core/crates/serialization/src/domain.rs`'s `tag`
  module (only the subset this SDK signs; the rest of that module's tags
  — sessions, disputes, governance, identity, content, tradechannel,
  reviews, risk, snapshot — are not reproduced since the TS SDK never
  constructs those payloads).
- Both re-exported from `typescript/src/index.ts` (`preimage`, `preimageOf`,
  `tags`), matching how `walletChallengeBytes`/`earningsChallengeBytes` are
  already exported for callers whose signing key lives outside this SDK
  (e.g. a browser wallet's `signMessage`).

## Conformance test

`typescript/tests/conformance_vectors.test.ts`: loads
`typescript/tests/vectors/client_signed_v1.json` (37 vectors, already
vendored in the repo before this task started), and for every row asserts
`toHex(preimage(row.tag, utf8(row.payload_json))) === row.preimage_hex`.
**Result: 38/38 passed** (37 per-vector cases + 1 non-empty-vectors guard).
This proves the TS header framing (length prefix + tag + body) is
byte-identical to `openfiat-core`'s `preimage_raw`, independent of JSON
body serialization (each vector's `payload_json` is treated as opaque
bytes, exactly as `preimage_raw` treats `body`).

## Version bump + CHANGELOG

- `typescript/package.json`: `0.1.0` -> `0.2.0`.
- `typescript/CHANGELOG.md` created (did not exist before), `## [0.2.0]`
  with a `### Breaking` entry naming the mechanism, the full list of
  affected send methods, the new `domain.ts`/`tags.ts` files, the
  conformance test, and the hard-cutover warning (node built before
  `openfiat-core` commit `451e52e`/`6b252db` rejects this SDK's
  signatures; this SDK never produces the un-tagged signatures an older
  node expects). Mirrors the wording and structure of
  `openfiat-core/CHANGELOG.md`'s `[Unreleased] > Security` F-01 entry.

## Existing unit tests updated (not just added)

Two pre-existing test files asserted signatures over bare
`JSON.stringify(payload)` and would have failed once the sign sites
changed — updated both to assert over `preimageOf(tags.X, payload)`
instead, keeping their actual intent (own-key vs. impostor-key signature
verification) unchanged:

- `typescript/tests/advertisements.test.ts` — `AdvertisementStatusSet` (2
  assertions), `AdvertisementPriceUpdate` (2), `AdvertisementTermsUpdate`
  (1).
- `typescript/tests/providers.test.ts` — `HealthUpdate` (1),
  `Withdrawal` (2). The provider-earnings challenge tests in this file
  were left untouched (separate scheme, out of scope).

No other test file asserted over bare-JSON signed bytes for an in-scope
payload type (`client.test.ts`, `reference.test.ts`, `trade_reads.test.ts`
use `JSON.stringify` only for the JSON-RPC envelope/mock responses;
`live_node.test.ts` uses it only for a substring assertion on redacted
output, unrelated to signing).

## Test results

```
pnpm build   -> clean (tsup, ESM + CJS, both entry points)
pnpm typecheck -> clean (tsc --noEmit)
pnpm lint    -> clean (eslint .)
pnpm test    -> 13 files passed, 1 skipped (live_node.test.ts, no running node)
                159 tests passed, 13 skipped
                conformance_vectors.test.ts: 38/38 passed
```

`live_node.test.ts` skipped as expected (no running new-core node in this
environment) — controller runs the live-node integration separately per
the task brief.

## Concerns

- The `SettlementApproved` gap above — confirm with the controller whether
  a `sendSettlementApproved` method is expected to exist in the TS SDK at
  all, or whether settlement approval is purely a node-side state
  transition inferred from other signed events (e.g. no explicit signed
  "approve" object today).
- `typescript/tests/vectors/client_signed_v1.json` was already present
  (untracked) in the working tree before this task started; not modified,
  only consumed.
