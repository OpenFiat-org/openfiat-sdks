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

export interface Registration {
  service_id: string;
  service_type: ServiceType;
  provider: PeerIdBytes;
  provider_public_key: PublicKeyBytes;
  endpoints: string[];
  supported_ofs: number[];
  region: string | null;
  capabilities: string[];
  pricing: string | null;
  timestamp: TimestampMs;
}

export interface SignedRegistration {
  registration: Registration;
  signature: SignatureBytes;
}

export type HealthState = "Online" | "Maintenance" | "Degraded" | "Offline";

export interface ServiceRecord {
  service_id: string;
  service_type: ServiceType;
  provider: PeerIdBytes;
  provider_public_key: PublicKeyBytes;
  endpoints: string[];
  supported_ofs: number[];
  region: string | null;
  capabilities: string[];
  pricing: string | null;
  health: HealthState;
  registered_at: TimestampMs;
  last_health_update: TimestampMs;
}
