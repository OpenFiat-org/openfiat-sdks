/**
 * Wire shapes for the domains this SDK has typed bindings for so far
 * (node, oracles, service providers). Field names are deliberately
 * snake_case, not idiomatic TypeScript camelCase: these interfaces
 * describe the exact JSON `serde` produces for the matching Rust struct
 * in `openfiat-core`, and a mismatch here is a wire-compatibility bug,
 * not a style choice.
 *
 * Extending this to another domain (advertisements, reservations, ...)
 * means reading that domain's `events.rs`/`record.rs` in `openfiat-core`
 * and transcribing the same field list — the pattern established here
 * and in `src/methods/` carries over directly.
 *
 * `Amount.base_units` is typed `number`, not `bigint`: values above
 * `Number.MAX_SAFE_INTEGER` (2^53-1) will lose precision. Fine for
 * every amount this workspace's tests actually use; a real trading bot
 * moving amounts anywhere near that range should switch this to
 * `bigint` with a custom JSON reviver.
 */

/** A 64-byte Ed25519 signature, as the JSON number array `serde` produces. */
export type SignatureBytes = number[];
/** A 32-byte Ed25519 public key, as the JSON number array `serde` produces. */
export type PublicKeyBytes = number[];
/** A libp2p PeerId, as the JSON number array `serde` produces — see `peerIdFromPublicKey`. */
export type PeerIdBytes = number[];
/** Milliseconds since the Unix epoch — `openfiat_types::Timestamp`'s JSON shape (a bare number). */
export type TimestampMs = number;

export interface Amount {
  base_units: number;
  decimals: number;
}

export function toBytes(arr: Uint8Array): number[] {
  return Array.from(arr);
}

// --- Node ---

export interface VersionResult {
  version: string;
}

// --- Chain bridge (OFS-4300) ---

export interface ChainStatus {
  mode: "RpcConnected" | "GossipOnly";
  blockhash: string | null;
  slot: number | null;
  age_ms: number | null;
}

export interface LatestBlockhash {
  blockhash: string;
  slot: number;
}

// --- Oracles (OFS-7000) ---

export type OracleData =
  | { ExchangeRate: { base: string; quote: string; rate: number } }
  | {
      StablecoinMetadata: {
        symbol: string;
        name: string;
        decimals: number;
        blockchain: string;
        mint_address: string | null;
        website: string | null;
        status: string;
      };
    }
  | { PaymentInfrastructure: { rail: string; available: boolean; note: string | null } }
  | {
      RegionalMetadata: {
        country: string;
        supported_fiat: string[];
        payment_methods: string[];
      };
    };

export interface OraclePublish {
  id: string;
  provider: PeerIdBytes;
  provider_public_key: PublicKeyBytes;
  data: OracleData;
  version: number;
  timestamp: TimestampMs;
  expires_at: TimestampMs;
}

export interface SignedOraclePublish {
  publish: OraclePublish;
  signature: SignatureBytes;
}

export interface OracleRecord {
  id: string;
  provider: PeerIdBytes;
  provider_public_key: PublicKeyBytes;
  data: OracleData;
  version: number;
  published_at: TimestampMs;
  expires_at: TimestampMs;
}

// --- Service Registry (OFS-1500), backs oracle/notification/risk/snapshot providers ---

export type ServiceType =
  | { Infrastructure: "BootstrapNode" | "SnapshotProvider" | "PublicApiNode" }
  | { Marketplace: "MerchantGateway" | "AnalyticsProvider" }
  | { Notifications: "Email" | "Telegram" | "Sms" | "Push" | "Webhook" }
  | { MarketData: "PriceOracle" | "FxOracle" }
  | { Security: "RiskIntelligenceProvider" | "WalletFlaggingProvider" };

/** What one charge covers (OFS-4100 §9.5). */
export type BillingUnit = "Request" | "Trade" | "Month";

/**
 * A provider's declared price. The mint is the token's identity — a symbol
 * is ambiguous across clusters and spoofable, a mint address is neither.
 *
 * Optional, and meaningfully so: absent pricing already means free, so
 * there is deliberately no "free" sentinel to add. Oracle and snapshot
 * providers leave this unset because their service is free by decision
 * (OFS-4100 §9.5), not by omission.
 */
export interface ServicePricing {
  /** Base58 SPL mint address billed in. */
  token_mint: string;
  amount: Amount;
  unit: BillingUnit;
}

export interface Registration {
  service_id: string;
  service_type: ServiceType;
  provider: PeerIdBytes;
  provider_public_key: PublicKeyBytes;
  endpoints: string[];
  supported_ofs: number[];
  region: string | null;
  capabilities: string[];
  pricing: ServicePricing | null;
  /** Base58 Solana address earnings are payable to. Required whenever
   *  `pricing` is set — a node rejects a price with nowhere to be paid. */
  payout_wallet: string | null;
  timestamp: TimestampMs;
}

export interface SignedRegistration {
  registration: Registration;
  signature: SignatureBytes;
}

export type HealthState = "Online" | "Maintenance" | "Degraded" | "Offline";

/**
 * OFS-1500 §11. Carries no public key: a node verifies it against whichever
 * key the registry already holds for this Service ID, not a self-asserted one.
 */
export interface HealthUpdate {
  service_id: string;
  provider: PeerIdBytes;
  state: HealthState;
  timestamp: TimestampMs;
}

export interface SignedHealthUpdate {
  update: HealthUpdate;
  signature: SignatureBytes;
}

/** OFS-1500 §17. Verified the same way as a health update. */
export interface Withdrawal {
  service_id: string;
  provider: PeerIdBytes;
  timestamp: TimestampMs;
}

export interface SignedWithdrawal {
  withdrawal: Withdrawal;
  signature: SignatureBytes;
}

export interface ServiceRecord {
  service_id: string;
  service_type: ServiceType;
  provider: PeerIdBytes;
  provider_public_key: PublicKeyBytes;
  endpoints: string[];
  supported_ofs: number[];
  region: string | null;
  capabilities: string[];
  pricing: ServicePricing | null;
  payout_wallet: string | null;
  health: HealthState;
  registered_at: TimestampMs;
  last_health_update: TimestampMs;
}

/** A single-use, expiring challenge authorising one earnings read. */
export interface EarningsChallenge {
  service_id: string;
  /** 32 random bytes, hex-encoded. */
  nonce: string;
  expires_at: TimestampMs;
}

/** One credit to a service, in whichever token the provider bills in. */
export interface EarningEntry {
  token_mint: string;
  amount: Amount;
  reference: string;
  credited_at: TimestampMs;
}

/**
 * A service's earnings statement. `entries` is empty for every service
 * today — nothing meters provider work yet, so nothing credits it.
 */
export interface ProviderEarnings {
  service_id: string;
  payout_wallet: string | null;
  entries: EarningEntry[];
}

// --- Advertisements (OFS-2100) ---

export type Direction = "Buy" | "Sell";

/**
 * A base58 Solana mint address — the token a trade is denominated in.
 *
 * This replaced `asset: string`, and the difference is the whole point.
 * A ticker on a record is a label the *merchant* chose, tied to the token
 * the escrow actually moves by nothing at all: an ad could say "USDC" and
 * settle in something else, with every layer agreeing the trade completed,
 * because each did exactly what it was asked. The on-chain settlement
 * allowlist closed the worst version of that — a mint the merchant minted
 * themselves cannot fund an escrow — but it cannot close the gap between a
 * label and an identity, because the program never sees the label.
 *
 * A mint address is an identity. The node rejects anything here that is
 * not base58 decoding to exactly 32 bytes, and rejects it at decode time,
 * so a bad value fails the whole event rather than reaching a buyer's
 * screen.
 */
export type MintAddress = string;

/**
 * `premium_bps` is signed on purpose — a merchant competing for flow may
 * quote below mid — and `price_decimals` is the precision the resolved
 * fiat price is quoted in (2 for KES/NGN/USD, 0 for JPY).
 *
 * Nothing else on an advertisement carries that precision: `min_trade`,
 * `max_trade` and `available_liquidity` are all denominated in the asset,
 * and a floating ad has no fixed price to borrow it from — which is why
 * the merchant declares it rather than the node inferring it from
 * `fiat_currency` off a hardcoded table that silently mis-rounds every
 * currency missing from it. Omitting the field here fails the node's
 * decode of the whole event, not just of the pricing.
 */
export type PricingModel =
  | { Fixed: { price: Amount } }
  | { Floating: { oracle_provider: string; premium_bps: number; price_decimals: number } };

export type AdvertisementStatus = "Active" | "Disabled" | "Vacation" | "Deleted";

export interface AdvertisementCreate {
  id: string;
  merchant: PeerIdBytes;
  merchant_public_key: PublicKeyBytes;
  /** The mint the buyer is paid in — see {@link MintAddress}. There is no
   *  companion symbol field, and that absence is deliberate: the name a
   *  buyer reads is resolved from this by the node, never supplied here. */
  asset_mint: MintAddress;
  direction: Direction;
  fiat_currency: string;
  min_trade: Amount;
  max_trade: Amount;
  initial_liquidity: Amount;
  pricing: PricingModel;
  payment_methods: string[];
  timestamp: TimestampMs;
}

export interface SignedAdvertisementCreate {
  create: AdvertisementCreate;
  signature: SignatureBytes;
}

/** §18/§21: a merchant taking their own ad down — the only lifecycle
 *  transition besides creation and repricing a merchant can trigger. */
export interface AdvertisementDisable {
  id: string;
  merchant: PeerIdBytes;
  timestamp: TimestampMs;
}

export interface SignedAdvertisementDisable {
  disable: AdvertisementDisable;
  signature: SignatureBytes;
}

/** §17's "Price changes" refresh trigger: repricing an existing ad in
 *  place instead of disabling and recreating it. */
export interface AdvertisementPriceUpdate {
  id: string;
  merchant: PeerIdBytes;
  pricing: PricingModel;
  timestamp: TimestampMs;
}

export interface SignedAdvertisementPriceUpdate {
  update: AdvertisementPriceUpdate;
  signature: SignatureBytes;
}

/** The replicated advertisement record, exactly as it is signed, gossiped
 *  and stored. What a *reader* gets back is {@link AdvertisementView}. */
export interface Advertisement {
  id: string;
  merchant: PeerIdBytes;
  merchant_public_key: PublicKeyBytes;
  /** The mint the buyer is paid in — see {@link MintAddress}. */
  asset_mint: MintAddress;
  direction: Direction;
  fiat_currency: string;
  min_trade: Amount;
  max_trade: Amount;
  available_liquidity: Amount;
  pricing: PricingModel;
  payment_methods: string[];
  status: AdvertisementStatus;
  created_at: TimestampMs;
  updated_at: TimestampMs;
}

/**
 * An advertisement as a reader gets it: the record above, plus the name
 * the node resolved for its mint.
 *
 * A separate type rather than a field on {@link Advertisement} because
 * the symbol is not part of the record and must never become part of it.
 * It is derived at the edge, by the node answering the call, from a table
 * every node compiles in identically — so a merchant cannot choose it,
 * and it cannot be signed into a record that then travels claiming a name
 * for a mint it does not have.
 *
 * The SDK deliberately ships **no** mint-to-ticker table of its own. One
 * here would put merchant-independent labelling back one layer out, and
 * would drift from the node's answer the first time governance allowlists
 * a mint — which is the same disagreement between two honest builds that
 * the node's own table exists to avoid.
 */
export interface AdvertisementView extends Advertisement {
  /**
   * What people call `asset_mint`, or `null` if this node knows no name
   * for it. `null` is not an error and not a reason to guess: an unknown
   * mint is an address with no nickname, and the honest thing to show a
   * user is the address itself.
   */
  asset_symbol: string | null;
}

// --- Reservations (OFS-2200) ---

export type ReservationState = "EscrowLocked" | "Cancelled" | "Expired";

export interface ReservationRequest {
  id: string;
  advertisement_id: string;
  requester: PeerIdBytes;
  requester_public_key: PublicKeyBytes;
  amount: Amount;
  /**
   * Fiat per unit of asset, as the requester understood it when they
   * signed — the number the trade is actually for.
   *
   * A floating advertisement publishes a formula, not a price, and two
   * honest nodes resolving it at the same instant can return different
   * numbers. Without this the taker agreed to a figure the protocol
   * recorded nowhere, and a merchant asserting a different rate afterwards
   * was arguing against nothing.
   *
   * The node refuses a reservation whose price does not follow from what
   * the merchant signed — for a fixed ad, an exact match on both
   * `base_units` and `decimals`; for a floating one, the same arithmetic
   * the display path used, recomputed from `agreed_mid`. It refuses rather
   * than substituting its own number, which would bind the taker to a
   * price they never signed.
   */
  agreed_price: Amount;
  /**
   * The oracle mid `agreed_price` was derived from, for a floating
   * advertisement. `null` for a fixed one, where there is nothing to
   * derive — and a mid supplied alongside a fixed price is refused, so
   * this field means one thing rather than two.
   */
  agreed_mid: number | null;
  timestamp: TimestampMs;
}

export interface SignedReservationRequest {
  request: ReservationRequest;
  signature: SignatureBytes;
}

/**
 * A reservation in full, as one of its own parties reads it back through
 * `getMyReservations`.
 *
 * There is no unauthenticated read that returns this shape — see
 * {@link PublicReservation}.
 */
export interface Reservation {
  id: string;
  advertisement_id: string;
  requester: PeerIdBytes;
  requester_public_key: PublicKeyBytes;
  amount: Amount;
  /** The price this reservation was made at. The advertisement's own quote
   *  moves with the oracle and is only ever a display; once a reservation
   *  exists the price is settled and stops moving. */
  agreed_price: Amount;
  agreed_mid: number | null;
  state: ReservationState;
  requested_at: TimestampMs;
  updated_at: TimestampMs;
  expires_at: TimestampMs;
}

/**
 * A reservation with the requester removed — what `getReservation` and
 * `getReservations` answer.
 *
 * `advertisement_id` survives deliberately: an advertisement is a public
 * offer and already carries its merchant's peer id on every order-book
 * row, so it discloses one end of an edge that was never private. The
 * requester is the other end, and the pair is what makes it an edge.
 *
 * This is a separate interface rather than `Reservation` with optional
 * party fields, and that is the point of it: with optional fields a
 * caller writes `reservation.requester`, gets `undefined` forever, and
 * never discovers that `reservations.getMyReservations` would have
 * answered. Here the compiler says so at the call site.
 *
 * `agreed_price` is absent because the node does not send it here, not
 * because this SDK drops it — so the price a public trade was struck at
 * is currently readable only by its own parties.
 */
export interface PublicReservation {
  id: string;
  advertisement_id: string;
  amount: Amount;
  state: ReservationState;
  requested_at: TimestampMs;
  updated_at: TimestampMs;
  expires_at: TimestampMs;
}

// --- Settlements (OFS-2300) ---

export type SettlementState =
  | "AwaitingPayment"
  | "PaymentSubmitted"
  | "Approved"
  | "Completed"
  | "Rejected"
  | "Cancelled"
  | "Disputed";

/** OFS-3000 §14's named payment-discrepancy kinds, set only on rejection. */
export type PaymentDiscrepancy =
  | "IncorrectAmount"
  | "WrongReference"
  | "DuplicatePayment"
  | "IncorrectAccount"
  | "Other";

/**
 * A settlement in full, as one of its own parties reads it back through
 * `getMySettlements`. No unauthenticated read returns this shape — see
 * {@link PublicSettlement}.
 */
export interface Settlement {
  id: string;
  reservation_id: string;
  buyer: PeerIdBytes;
  buyer_public_key: PublicKeyBytes;
  seller: PeerIdBytes;
  seller_public_key: PublicKeyBytes;
  amount: Amount;
  state: SettlementState;
  /** Free text the buyer puts their own bank reference in. */
  payment_reference: string | null;
  escrow_release_signature: string | null;
  payment_submitted_at: TimestampMs | null;
  merchant_responded_at: TimestampMs | null;
  payment_discrepancy: PaymentDiscrepancy | null;
  created_at: TimestampMs;
  updated_at: TimestampMs;
}

/**
 * A settlement with the parties removed — what `getSettlement` and
 * `getSettlements` answer. Volume, state and timing survive, which is
 * every question an explorer actually has about a public network.
 *
 * `payment_reference` goes with the parties and is arguably the worse of
 * the two to have published: it routinely carries a real name or an
 * account number.
 */
export interface PublicSettlement {
  id: string;
  reservation_id: string;
  amount: Amount;
  state: SettlementState;
  /** Kept: it names an on-chain transaction anyone can already read on
   *  Solana, and it is what makes a settlement independently checkable. */
  escrow_release_signature: string | null;
  payment_submitted_at: TimestampMs | null;
  merchant_responded_at: TimestampMs | null;
  payment_discrepancy: PaymentDiscrepancy | null;
  created_at: TimestampMs;
  updated_at: TimestampMs;
}

// --- Trades (OFS-2000) ---

/**
 * The one value a client displaying a trade actually wants, instead of
 * "check the reservation state, then whether a settlement exists, then
 * its state".
 *
 * `Completed` covers both of the settlement's `Approved` and `Completed`
 * — a caller that needs "has the release actually landed on chain" reads
 * the settlement's `escrow_release_signature` instead.
 */
export type TradeStatus =
  | "EscrowLocked"
  | "AwaitingPayment"
  | "PaymentSubmitted"
  | "Completed"
  | "Rejected"
  | "Cancelled"
  | "Disputed";

/**
 * A trade in full, as one of its own parties reads it back through
 * `getMyTrades`. No unauthenticated read returns this shape — see
 * {@link PublicTrade}.
 *
 * A trade is not a record of its own: it is a read-time join of a
 * reservation and the settlement it became, correlated by reservation id,
 * which is why `settlement` is null for a reservation nobody has started
 * settling yet.
 *
 * There is no `status` here, and its absence is the node's, not this
 * SDK's: the derived status is computed by the public view and is not a
 * field of the joined record, so `getMyTrades` does not send one. Callers
 * who want it from their own trades call {@link tradeStatus}.
 */
export interface Trade {
  reservation: Reservation;
  settlement: Settlement | null;
}

/**
 * A trade with both parties removed — what `getTrade` and `getTrades`
 * answer.
 *
 * This read was the way around the redaction of the three underlying
 * ones: a trade embeds a reservation and a settlement whole, so leaving
 * it open left the who-trades-with-whom graph available one method along
 * from where it had just been closed. It is composed of the two public
 * halves rather than redacted separately, so a field added to either
 * cannot appear here without appearing there.
 *
 * `status` survives because it is what a trade view is for and says
 * nothing about who is party to it.
 */
export interface PublicTrade {
  reservation: PublicReservation;
  settlement: PublicSettlement | null;
  status: TradeStatus;
}

// --- Disputes (OFS-2400) ---

export type DisputeStatus = "Open" | "CaseLocked" | "RevealPhase" | "Resolved";

/** §17's resolution outcomes. */
export type Resolution = "BuyerWins" | "MerchantWins" | "MutualSettlement" | "Invalid";

/** One arbitrator's vote — no `MutualSettlement`, which is a party-agreed
 *  outcome that bypasses arbitration entirely. */
export type Vote = "BuyerWins" | "MerchantWins" | "Invalid";

export interface ArbitratorCommitment {
  arbitrator: PeerIdBytes;
  /** The 32-byte commitment hash, as the JSON number array `serde` produces. */
  commitment: number[];
}

export interface ArbitratorReveal {
  arbitrator: PeerIdBytes;
  vote: Vote;
}

/**
 * A dispute in full, as a party or a seated arbitrator reads it back
 * through `getMyDisputes`. No unauthenticated read returns this shape —
 * see {@link PublicDispute}.
 */
export interface Dispute {
  id: string;
  settlement_id: string;
  buyer: PeerIdBytes;
  buyer_public_key: PublicKeyBytes;
  seller: PeerIdBytes;
  seller_public_key: PublicKeyBytes;
  opener: PeerIdBytes;
  /** Free text written by whoever opened the case. */
  reason: string;
  status: DisputeStatus;
  required_arbitrators: number;
  arbitrators: PeerIdBytes[];
  arbitrator_keys: [PeerIdBytes, PublicKeyBytes][];
  commitments: ArbitratorCommitment[];
  reveals: ArbitratorReveal[];
  resolution: Resolution | null;
  buyer_agreed_mutual_settlement: boolean;
  seller_agreed_mutual_settlement: boolean;
  onchain_execution_signature: string | null;
  opened_at: TimestampMs;
  updated_at: TimestampMs;
}

/**
 * A dispute with the parties, the arbitrators and their votes removed —
 * what `getDispute` and `getDisputes` answer.
 *
 * An arbitrator is a registered provider and their identity is not itself
 * a secret, but *which arbitrator drew which case, and how they voted* is
 * exactly the pairing that makes pressuring one worthwhile. Counts
 * survive so a case can be seen progressing; the pairing does not. The
 * mutual-settlement flags go with them — "the seller has agreed and the
 * buyer has not" is a negotiating position.
 */
export interface PublicDispute {
  id: string;
  settlement_id: string;
  status: DisputeStatus;
  required_arbitrators: number;
  /** How many seats are filled, without saying by whom. */
  arbitrators_seated: number;
  commitments: number;
  reveals: number;
  /** The outcome, which is the point of the case and is enforced on chain
   *  where anyone can read it anyway. */
  resolution: Resolution | null;
  onchain_execution_signature: string | null;
  opened_at: TimestampMs;
  updated_at: TimestampMs;
}

// --- Wallet proofs, for the reads that are not everyone's ---

/**
 * A single-use, expiring challenge bound to one wallet, issued by
 * `getWalletChallenge`.
 *
 * `subject` is the node's own canonical base64 spelling of the wallet and
 * is signed verbatim, so a caller echoes it back rather than re-encoding
 * their own peer id: two spellings that decode to the same bytes still
 * produce different signing bytes.
 */
export interface WalletChallenge {
  subject: string;
  /** 32 random bytes, hex-encoded. */
  nonce: string;
  expires_at: TimestampMs;
}

// --- Notifications (OFS-6000) ---

/** `openfiat_types::NotificationChannel` — the channel a gateway
 *  delivers on, matched against its registered service type at routing
 *  time so a destination sealed for one channel cannot be routed to a
 *  gateway that serves another. */
export type NotificationChannel =
  | "Email"
  | "Telegram"
  | "Sms"
  | "Push"
  | "Webhook";

export type NotificationCategory =
  | "Trading"
  | "Marketplace"
  | "Disputes"
  | "Governance"
  | "Infrastructure";

export type NotificationTrigger =
  | "ReservationCreated"
  | "ReservationExpiring"
  | "PaymentSubmitted"
  | "SettlementApproved"
  | "EscrowReleased"
  | "TradeCompleted"
  | "AdvertisementDisabled"
  | "ReputationUpdated"
  | "EvidenceRequested"
  | "ResolutionIssued"
  | "ProposalPublished"
  | "VotingStarted"
  | "ProposalActivated"
  | "SnapshotAvailable"
  | "NodeMaintenance"
  | "ProviderOffline";

export type DeliveryStatus =
  | "Queued"
  | "Sent"
  | "Delivered"
  | "Read"
  | "Failed"
  | "Retried"
  | "Expired";

/**
 * A destination sealed to the gateway that will deliver it
 * (`openfiat-notifications`' `SubscriptionDestination`).
 *
 * The address is a ciphertext because subscriptions replicate to every
 * node: in plaintext, a wallet's email address or phone number would be
 * readable by every node operator on the network. Only the bound gateway
 * can open it. Constructing one needs the sealing primitive itself, which
 * this SDK does not yet expose — until it does, the only value a client
 * can send is an empty list.
 */
export interface SealedBox {
  ephemeral_public: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

export interface SubscriptionDestination {
  service_id: string;
  channel: NotificationChannel;
  sealed: SealedBox;
}

/**
 * Field order matters and is not cosmetic. The signature is verified
 * against a re-serialization of this struct on the node, so the JSON key
 * order this produces must match the Rust declaration order exactly —
 * `destinations` sits between `enabled_categories` and `timestamp`. Omit
 * it and the bytes the node hashes differ from the bytes signed here,
 * which fails as `INVALID_SIGNATURE` rather than as a missing field.
 */
export interface SubscriptionUpdate {
  wallet: PeerIdBytes;
  wallet_public_key: PublicKeyBytes;
  enabled_categories: NotificationCategory[];
  destinations: SubscriptionDestination[];
  timestamp: TimestampMs;
}

export interface SignedSubscriptionUpdate {
  update: SubscriptionUpdate;
  signature: SignatureBytes;
}

export interface Subscription {
  wallet: PeerIdBytes;
  wallet_public_key: PublicKeyBytes;
  enabled_categories: NotificationCategory[];
  updated_at: TimestampMs;
}

export interface DeliveryReport {
  notification_id: string;
  service_id: string;
  provider: PeerIdBytes;
  provider_public_key: PublicKeyBytes;
  recipient_wallet: PeerIdBytes;
  trigger: NotificationTrigger;
  status: DeliveryStatus;
  timestamp: TimestampMs;
}

export interface SignedDeliveryReport {
  report: DeliveryReport;
  signature: SignatureBytes;
}

export interface DeliveryReceipt {
  notification_id: string;
  service_id: string;
  recipient_wallet: PeerIdBytes;
  trigger: NotificationTrigger;
  status: DeliveryStatus;
  updated_at: TimestampMs;
}
