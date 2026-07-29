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

export type PricingModel =
  | { Fixed: { price: Amount } }
  | { Floating: { oracle_provider: string; premium_bps: number } };

export type AdvertisementStatus = "Active" | "Disabled" | "Vacation";

export interface AdvertisementCreate {
  id: string;
  merchant: PeerIdBytes;
  merchant_public_key: PublicKeyBytes;
  asset: string;
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

export interface Advertisement {
  id: string;
  merchant: PeerIdBytes;
  merchant_public_key: PublicKeyBytes;
  asset: string;
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

// --- Reservations (OFS-2200) ---

export type ReservationState = "EscrowLocked" | "Cancelled" | "Expired";

export interface ReservationRequest {
  id: string;
  advertisement_id: string;
  requester: PeerIdBytes;
  requester_public_key: PublicKeyBytes;
  amount: Amount;
  timestamp: TimestampMs;
}

export interface SignedReservationRequest {
  request: ReservationRequest;
  signature: SignatureBytes;
}

export interface Reservation {
  id: string;
  advertisement_id: string;
  requester: PeerIdBytes;
  requester_public_key: PublicKeyBytes;
  amount: Amount;
  state: ReservationState;
  requested_at: TimestampMs;
  updated_at: TimestampMs;
  expires_at: TimestampMs;
}

// --- Notifications (OFS-6000) ---

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

export interface SubscriptionUpdate {
  wallet: PeerIdBytes;
  wallet_public_key: PublicKeyBytes;
  enabled_categories: NotificationCategory[];
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
