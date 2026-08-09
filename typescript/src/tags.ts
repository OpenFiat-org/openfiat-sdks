/**
 * Domain tags for the client-signed wire events this SDK signs (F-01).
 *
 * Each literal must be byte-identical to its counterpart in
 * `openfiat-core`'s `crates/serialization/src/domain.rs` (the `tag`
 * module) and to the app's own tag table — this is a cross-repo contract,
 * not a local convention. `tests/conformance_vectors.test.ts` proves the
 * header these tags feed into matches the Rust side byte for byte, using
 * vectors vendored from that crate.
 *
 * This is deliberately a subset: only the payload types this SDK actually
 * signs appear here. The full canonical list lives in `openfiat-core`;
 * types the TS SDK never constructs (sessions, disputes, governance,
 * identity, content, tradechannel, reviews, risk, snapshot) are not
 * reproduced here to avoid a tag going stale from disuse.
 */
export const tags = {
  // advertisements
  AdvertisementCreate: "openfiat/advertisements/AdvertisementCreate/v1",
  AdvertisementStatusSet: "openfiat/advertisements/AdvertisementStatusSet/v1",
  AdvertisementTermsUpdate: "openfiat/advertisements/AdvertisementTermsUpdate/v1",
  AdvertisementPriceUpdate: "openfiat/advertisements/AdvertisementPriceUpdate/v1",

  // reservations
  ReservationRequest: "openfiat/reservations/ReservationRequest/v1",
  ReservationCancel: "openfiat/reservations/ReservationCancel/v1",

  // settlement
  SettlementInitiate: "openfiat/settlement/SettlementInitiate/v1",
  PaymentSubmitted: "openfiat/settlement/PaymentSubmitted/v1",
  PaymentReversed: "openfiat/settlement/PaymentReversed/v1",
  SettlementApproved: "openfiat/settlement/SettlementApproved/v1",
  SettlementRejected: "openfiat/settlement/SettlementRejected/v1",
  SettlementCancelled: "openfiat/settlement/SettlementCancelled/v1",

  // registry
  Registration: "openfiat/registry/Registration/v1",
  HealthUpdate: "openfiat/registry/HealthUpdate/v1",
  Withdrawal: "openfiat/registry/Withdrawal/v1",

  // oracles
  OraclePublish: "openfiat/oracles/OraclePublish/v1",

  // notifications
  SubscriptionUpdate: "openfiat/notifications/SubscriptionUpdate/v1",
  DeliveryReport: "openfiat/notifications/DeliveryReport/v1",
} as const;
