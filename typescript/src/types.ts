import { encodeBase58 } from "./base58.js";
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

/**
 * A 64-byte Ed25519 signature, base58-encoded.
 *
 * These three were `number[]` until a node started rendering them as
 * base58. That was not only a display change: an array of 32 integers is
 * shaped exactly like an Ed25519 *private* key, so a reader could not tell
 * a published public key from a leaked secret, and a peer id in that form
 * could not be pasted into an `--entrypoint`.
 *
 * Build them with {@link toBase58}. Writing one as an array of numbers
 * produces a payload whose transcript the node will not reproduce, so the
 * signature fails to verify rather than failing to parse.
 */
export type Base58Signature = string;
/** A 32-byte Ed25519 public key, base58-encoded. See {@link Base58Signature}. */
export type Base58PublicKey = string;
/** A libp2p PeerId in its `12D3Koo…` form. See {@link Base58Signature}. */
export type Base58PeerId = string;
/** Milliseconds since the Unix epoch — `openfiat_types::Timestamp`'s JSON shape (a bare number). */
export type TimestampMs = number;

export interface Amount {
  base_units: number;
  decimals: number;
}

/**
 * Encode a key, peer id or signature for a payload field. Re-exported
 * here because every call site that used the old `toBytes` needs exactly
 * this instead.
 */
export function toBase58(bytes: Uint8Array): string {
  return encodeBase58(bytes);
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
  | {
      PaymentInfrastructure: {
        rail: string;
        available: boolean;
        note: string | null;
      };
    }
  | {
      RegionalMetadata: {
        country: string;
        supported_fiat: string[];
        payment_methods: string[];
      };
    };

export interface OraclePublish {
  id: string;
  provider: Base58PeerId;
  provider_public_key: Base58PublicKey;
  data: OracleData;
  version: number;
  timestamp: TimestampMs;
  expires_at: TimestampMs;
}

export interface SignedOraclePublish {
  publish: OraclePublish;
  signature: Base58Signature;
}

export interface OracleRecord {
  id: string;
  provider: Base58PeerId;
  provider_public_key: Base58PublicKey;
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

/**
 * What a service says it is called and looks like (OFS-1500 §9).
 *
 * Every field is self-asserted. A registration is signed by the key that
 * made it and by nobody else, which proves the record was not altered in
 * transit and proves nothing about whether the name is the signer's to
 * use — anyone can register a service called "Binance". Render all of it
 * as a claim, beside the Service ID rather than instead of it.
 *
 * A node bounds these on the way in (64 characters of name, 280 of
 * description, 256 of website; `http`/`https` only; no control or
 * bidirectional-override characters) and refuses the whole registration
 * otherwise, so a value that would misrender never reaches storage.
 */
export interface ServiceBranding {
  /** A human name for the service — "AllenHark EU", not a legal entity.
   *  Not unique: two providers may deliberately declare the same one. */
  name: string | null;
  description: string | null;
  /**
   * A logo, as an IPFS CID — never a URL. A URL would let the operator
   * change the image after publication and would make every viewer of a
   * provider directory issue a request to a server the provider
   * controls, which is a tracking beacon. A CID names one image and is
   * served by the node the viewer already chose to talk to, over its own
   * `GET /ipfs/{cid}`.
   */
  logo: string | null;
  /** A website for whoever runs the service. Deliberately not `url`: a
   *  registration already carries `endpoints`, which is where the
   *  *service* is. This is the one a reader clicks. */
  website: string | null;
}

/**
 * Field order is not cosmetic. `SignedRegistration` is verified against a
 * re-serialization of this object on the node, so the JSON key order
 * `JSON.stringify` produces must match the Rust declaration order — and
 * `branding` sits between `capabilities` and `pricing`. Move it, or omit
 * it, and the bytes the node hashes differ from the bytes signed here,
 * which surfaces as `INVALID_SIGNATURE` rather than as a missing field.
 */
export interface Registration {
  service_id: string;
  service_type: ServiceType;
  provider: Base58PeerId;
  provider_public_key: Base58PublicKey;
  endpoints: string[];
  supported_ofs: number[];
  region: string | null;
  capabilities: string[];
  /** Name, description, logo and website as declared, or `null` when the
   *  provider declared nothing — which most do. */
  branding: ServiceBranding | null;
  pricing: ServicePricing | null;
  /** Base58 Solana address earnings are payable to. Required whenever
   *  `pricing` is set — a node rejects a price with nowhere to be paid. */
  payout_wallet: string | null;
  timestamp: TimestampMs;
}

export interface SignedRegistration {
  registration: Registration;
  signature: Base58Signature;
}

export type HealthState = "Online" | "Maintenance" | "Degraded" | "Offline";

/**
 * OFS-1500 §11. Carries no public key: a node verifies it against whichever
 * key the registry already holds for this Service ID, not a self-asserted one.
 */
export interface HealthUpdate {
  service_id: string;
  provider: Base58PeerId;
  state: HealthState;
  timestamp: TimestampMs;
}

export interface SignedHealthUpdate {
  update: HealthUpdate;
  signature: Base58Signature;
}

/** OFS-1500 §17. Verified the same way as a health update. */
export interface Withdrawal {
  service_id: string;
  provider: Base58PeerId;
  timestamp: TimestampMs;
}

export interface SignedWithdrawal {
  withdrawal: Withdrawal;
  signature: Base58Signature;
}

export interface ServiceRecord {
  service_id: string;
  service_type: ServiceType;
  provider: Base58PeerId;
  provider_public_key: Base58PublicKey;
  endpoints: string[];
  supported_ofs: number[];
  region: string | null;
  capabilities: string[];
  /** As declared at registration, or `null`. Self-asserted — a signature
   *  proves the record was not altered, never that the name is the
   *  signer's to use. See {@link ServiceBranding}. */
  branding: ServiceBranding | null;
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
  | {
      Floating: {
        oracle_provider: string;
        premium_bps: number;
        price_decimals: number;
      };
    };

export type AdvertisementStatus =
  "Active" | "Disabled" | "Vacation" | "Deleted";

export interface AdvertisementCreate {
  id: string;
  merchant: Base58PeerId;
  merchant_public_key: Base58PublicKey;
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
  signature: Base58Signature;
}

/** §18/§21: a merchant taking their own ad down — the only lifecycle
 *  transition besides creation and repricing a merchant can trigger. */
/** §16/§18/§21: a merchant moving their advertisement between the states
 *  in {@link AdvertisementStatus} — pausing it, taking it down, deleting
 *  it, or putting it back up.
 *
 *  This replaced an `AdvertisementDisable` that could only reach one of
 *  the four. An advertisement automatically disabled when its liquidity
 *  ran out could never be reactivated, however much liquidity the
 *  merchant added afterwards.
 *
 *  Two rules the node enforces: `Deleted` is permanent, and an
 *  advertisement with no liquidity cannot be set `Active`, since the next
 *  reservation would disable it again. */
export interface AdvertisementStatusSet {
  id: string;
  merchant: Base58PeerId;
  status: AdvertisementStatus;
  timestamp: TimestampMs;
}

export interface SignedAdvertisementStatusSet {
  set: AdvertisementStatusSet;
  signature: Base58Signature;
}

/** §6: trade limits and payment methods, changed in place.
 *
 *  Every field is the new value in full, never a delta — a partial update
 *  would make "unchanged" and "cleared" identical for `payment_methods`.
 *  The advertisement keeps its id, which is the point: republishing under
 *  a new one orphans every reservation, settlement and review that named
 *  the old. */
export interface AdvertisementTermsUpdate {
  id: string;
  merchant: Base58PeerId;
  /** Denominated in the asset, like the record's own limits. */
  min_trade: Amount;
  max_trade: Amount;
  payment_methods: string[];
  timestamp: TimestampMs;
}

export interface SignedAdvertisementTermsUpdate {
  update: AdvertisementTermsUpdate;
  signature: Base58Signature;
}

/** §17's "Price changes" refresh trigger: repricing an existing ad in
 *  place instead of disabling and recreating it. */
export interface AdvertisementPriceUpdate {
  id: string;
  merchant: Base58PeerId;
  pricing: PricingModel;
  timestamp: TimestampMs;
}

export interface SignedAdvertisementPriceUpdate {
  update: AdvertisementPriceUpdate;
  signature: Base58Signature;
}

/** The replicated advertisement record, exactly as it is signed, gossiped
 *  and stored. What a *reader* gets back is {@link AdvertisementView}. */
export interface Advertisement {
  id: string;
  merchant: Base58PeerId;
  merchant_public_key: Base58PublicKey;
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

/** Why an advertisement has no price at the instant it was asked.
 *
 *  These are three different situations and a caller that collapses them
 *  tells a user the wrong thing: `NoOracleData` means nobody prices this
 *  pair at all, `StaleOracleData` means the feed existed and lapsed, and
 *  `PriceOutOfRange` means the merchant's own premium puts the result
 *  outside what an {@link Amount} can hold. Only the middle one is likely
 *  to fix itself. */
export type UnpriceableReason =
  "NoOracleData" | "StaleOracleData" | "PriceOutOfRange";

/**
 * An advertisement's price at one instant, or the reason it has none.
 *
 * **Note the tag.** Unlike {@link PricingModel}, which is externally
 * tagged (`{ Fixed: { … } }`), this arrives internally tagged on a `kind`
 * discriminant. The two sit next to each other on the same response and do
 * not share a shape, so reaching for the wrong one silently yields
 * `undefined` rather than a type error at the boundary.
 *
 * A discriminated union rather than a nullable price, because the three
 * cases are three different promises and a caller has to be made to
 * choose:
 *
 * - `Fixed` is a merchant-set number. It cannot fail to resolve, and moves
 *   only when the merchant signs a new one.
 * - `Floating` is an oracle mid plus the merchant's premium. It is good
 *   only until `mid_expires_at` and may move before then.
 * - `Unpriceable` is an advertisement that exists and currently has no
 *   price. It still carries `premium_bps`, so a client can show the ad's
 *   terms while being explicit that there is no number today.
 *
 * Reading `price` off a bare object would let `Unpriceable` be rendered as
 * free, and would let a floating quote be held as though it were fixed —
 * which is exactly the stale-price bug that a reservation's signed
 * `agreed_price` exists to catch one layer down. `mid_expires_at` is what
 * makes a floating quote safe to display and unsafe to keep.
 */
export type PriceQuote =
  | { kind: "Fixed"; price: Amount }
  | {
      kind: "Floating";
      price: Amount;
      mid_rate: number;
      premium_bps: number;
      /** When the mid behind this number lapses — how long a caller may
       *  treat the quote as live. Past this, re-read; do not re-use. */
      mid_expires_at: TimestampMs;
    }
  | { kind: "Unpriceable"; reason: UnpriceableReason; premium_bps: number };

/**
 * An advertisement as a reader gets it: the record above, plus the name
 * the node resolved for its mint and the price it resolved at read time.
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
  /**
   * The price this advertisement resolves to right now, resolved by the
   * node when it answered — not stored on the record, and not the same
   * thing as `pricing`.
   *
   * `pricing` is the merchant's standing instruction ("oracle mid plus 150
   * bps"); this is what that instruction produced against the oracle
   * reading the node had at the moment of the call. A floating ad's
   * `pricing` never changes while its `quote` moves all day.
   */
  quote: PriceQuote;
}

/**
 * What a trader actually chooses by, sent to the node rather than applied
 * here.
 *
 * Every field is optional and absent means "no constraint", so `{}` is the
 * whole active book. Narrowing belongs in the request and not in the
 * caller: the node would otherwise serialize every advertisement on the
 * network on every request, and filtering a page after it arrives shows a
 * short page and — worse — advances the cursor past rows the caller
 * discarded but never saw. There is deliberately no client-side filter
 * helper in this SDK for that reason.
 *
 * Every field is `?: T | undefined` rather than plain `?: T`, and against
 * this package's `exactOptionalPropertyTypes` that is a real difference:
 * `JSON.stringify` drops an explicit `undefined` and an absent key alike,
 * so the two produce the identical request, and a caller threading an
 * optional value through a variable should not have to branch to say
 * "no constraint".
 */
export interface AdvertisementFilter {
  /** The token being traded, by mint address — see {@link MintAddress}.
   *  Matched exactly; a mint is an identity, not a label. */
  asset_mint?: MintAddress | undefined;
  /** Matched case-insensitively: a currency code is a code, and `"kes"`
   *  finds the same offers as `"KES"`. */
  fiat_currency?: string | undefined;
  direction?: Direction | undefined;
  /** Matches an advertisement that lists this among possibly several,
   *  case-insensitively. */
  payment_method?: string | undefined;
  /**
   * Only advertisements that could take a trade of this size — inside
   * `min_trade`/`max_trade` and within remaining liquidity. A buyer with
   * 50 USDC does not want to read about offers starting at 500.
   *
   * **Scale-sensitive, on purpose.** The comparison happens in base units
   * at the advertisement's own scale, and an amount whose `decimals`
   * differ from the advertisement's matches *nothing* rather than being
   * rescaled — `{ base_units: 50, decimals: 0 }` against a book quoted at
   * 6 decimals returns an empty page, not the offers around 50. 10.000000
   * and 10.00 are the same value written two ways and guessing which was
   * meant answers a question the caller did not put. So send the same
   * `decimals` the advertisements use; an unexpectedly empty result here
   * is almost always this.
   */
  amount?: Amount | undefined;
  /**
   * Whose advertisements, by merchant PeerId.
   *
   * The question a merchant console asks, answered at the node. Reading
   * the whole book and keeping the matching rows works and makes the node
   * serialize every advertisement on the network so the caller can
   * discard nearly all of them.
   */
  merchant?: Base58PeerId | undefined;
  /**
   * Which states count. Absent means `["Active"]`.
   *
   * A disabled or deleted advertisement cannot be traded against, so
   * returning one by default would be offering something that is not on
   * offer.
   *
   * A set rather than one value, because the caller that needs something
   * other than the default needs several: a merchant's console shows a
   * paused advertisement beside the live ones, since it is the only
   * screen that can put it back on offer.
   *
   * An empty array asks for nothing and gets nothing — it is not read as
   * "no constraint".
   */
  statuses?: AdvertisementStatus[] | undefined;
}

/** Where to resume from, and how much to take. */
export interface AdvertisementPageRequest {
  /**
   * The `next_cursor` of the previous page, passed back **verbatim**.
   *
   * It is an advertisement id, but do not build one from the last row you
   * received: that requires knowing the node's ordering, and an ordering
   * the two sides disagree about is exactly how a page gets skipped. The
   * cursor travels beside the rows so that neither side has to guess.
   *
   * `null` is accepted alongside `undefined` and means the same thing —
   * start at the beginning — so the last page's `next_cursor` can be
   * assigned straight across without being converted first. "Verbatim"
   * should not require the caller to translate a `null` into an absent
   * key, because that translation is the first step towards deriving the
   * value instead of carrying it.
   */
  after?: string | null | undefined;
  /** Clamped by the node, which owns both the ceiling and the default —
   *  so ask for what you want to display and read the page you get back
   *  rather than assuming the size you asked for. */
  limit?: number | undefined;
}

/** `getAdvertisements`' parameters. Both halves are optional, so `{}` is
 *  the first page of the whole active book. */
export interface AdvertisementQuery {
  filter?: AdvertisementFilter | undefined;
  page?: AdvertisementPageRequest | undefined;
}

/**
 * One page of the order book.
 *
 * This method used to answer with a bare array. It returned *every*
 * advertisement on the network with no parameters, which is a response
 * that grows without bound and a book a buyer cannot search — so code
 * reading `result.length` was already reading something that could not
 * survive real volume, and now reads `undefined`.
 */
export interface AdvertisementPage {
  advertisements: AdvertisementView[];
  /** Pass back as `page.after` to continue. `null` means this was the
   *  last page. */
  next_cursor: string | null;
}

// --- Reservations (OFS-2200) ---

export type ReservationState = "EscrowLocked" | "Cancelled" | "Expired";

export interface ReservationRequest {
  id: string;
  advertisement_id: string;
  requester: Base58PeerId;
  requester_public_key: Base58PublicKey;
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
  signature: Base58Signature;
}

/**
 * A taker giving up a reservation before its validation window runs out,
 * returning the merchant's liquidity to the advertisement immediately.
 *
 * Only the requester may send one, and the node checks that against the
 * stored reservation rather than against this payload: `requester` must
 * equal the reservation's own requester, and the signature must verify
 * under the public key that reservation already carries. Nothing here
 * supplies a key, which is the point — a cancellation that named its own
 * verifying key would let anyone who can name a reservation cancel it.
 *
 * Legal only from `EscrowLocked`. There is no merchant-side counterpart:
 * a merchant who wants their liquidity back waits out the window.
 */
export interface ReservationCancel {
  id: string;
  requester: Base58PeerId;
  timestamp: TimestampMs;
}

export interface SignedReservationCancel {
  cancel: ReservationCancel;
  signature: Base58Signature;
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
  requester: Base58PeerId;
  requester_public_key: Base58PublicKey;
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
  buyer: Base58PeerId;
  buyer_public_key: Base58PublicKey;
  seller: Base58PeerId;
  seller_public_key: Base58PublicKey;
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
 * The merchant's "I cannot find this payment" — the other half of an
 * approval, and the alternative to opening a dispute over it.
 *
 * Legal only from `PaymentSubmitted` and only under the seller on file.
 * Both fields describing the problem are required and they are not
 * redundant: `reason` is prose for a human reading the trade, and
 * `discrepancy` is the one reputation counts. Reaching for `Other` when a
 * named kind applies costs the counterparty a legible record.
 *
 * A rejection is a claim, not an adjudication. A buyer who really did pay
 * can still open a dispute afterwards — `Rejected` is not a state the
 * dispute path refuses.
 */
export interface SettlementRejected {
  settlement_id: string;
  seller: Base58PeerId;
  /** Free text for a human. Never parsed. */
  reason: string;
  discrepancy: PaymentDiscrepancy;
  timestamp: TimestampMs;
}

export interface SignedSettlementRejected {
  action: SettlementRejected;
  signature: Base58Signature;
}

/**
 * Either party walking away from a settlement, before any payment is
 * declared.
 *
 * `canceller` must be the settlement's own buyer or seller — the node
 * picks which public key to verify against by matching that field against
 * the stored record, so a third party naming themselves canceller is
 * refused before any signature is examined.
 *
 * Legal only from `AwaitingPayment`, and that restriction is the security
 * property: once the buyer has declared payment a merchant cannot make
 * the settlement disappear. The gap it cannot close is between a buyer
 * wiring fiat and that buyer declaring it, so declare first.
 */
export interface SettlementCancelled {
  settlement_id: string;
  canceller: Base58PeerId;
  timestamp: TimestampMs;
}

export interface SignedSettlementCancelled {
  action: SettlementCancelled;
  signature: Base58Signature;
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
export type Resolution =
  "BuyerWins" | "MerchantWins" | "MutualSettlement" | "Invalid";

/** One arbitrator's vote — no `MutualSettlement`, which is a party-agreed
 *  outcome that bypasses arbitration entirely. */
export type Vote = "BuyerWins" | "MerchantWins" | "Invalid";

export interface ArbitratorCommitment {
  arbitrator: Base58PeerId;
  /** The 32-byte commitment hash, as the JSON number array `serde` produces. */
  commitment: number[];
}

export interface ArbitratorReveal {
  arbitrator: Base58PeerId;
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
  buyer: Base58PeerId;
  buyer_public_key: Base58PublicKey;
  seller: Base58PeerId;
  seller_public_key: Base58PublicKey;
  opener: Base58PeerId;
  /** Free text written by whoever opened the case. */
  reason: string;
  status: DisputeStatus;
  required_arbitrators: number;
  arbitrators: Base58PeerId[];
  arbitrator_keys: [Base58PeerId, Base58PublicKey][];
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
  "Email" | "Telegram" | "Sms" | "Push" | "Webhook";

export type NotificationCategory =
  "Trading" | "Marketplace" | "Disputes" | "Governance" | "Infrastructure";

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
  "Queued" | "Sent" | "Delivered" | "Read" | "Failed" | "Retried" | "Expired";

/**
 * A destination sealed to the gateway that will deliver it
 * (`openfiat-notifications`' `SubscriptionDestination`).
 *
 * The address is a ciphertext because subscriptions replicate to every
 * node: in plaintext, a wallet's email address or phone number would be
 * readable by every node operator on the network. Only the bound gateway
 * can open it.
 *
 * Build one with {@link seal}, addressing the gateway's
 * `provider_public_key` from its `ServiceRecord`.
 *
 * The three fields are `number[]`, not `Uint8Array`, and the distinction is
 * load-bearing rather than stylistic: `JSON.stringify` renders a
 * `Uint8Array` as an *object* with numeric keys (`{"0":1,"1":2}`), which
 * `serde` cannot decode into `[u8; 32]`. Every byte field in this SDK is a
 * plain array for that reason.
 */
export interface SealedBox {
  ephemeral_public: number[];
  nonce: number[];
  ciphertext: number[];
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
  wallet: Base58PeerId;
  wallet_public_key: Base58PublicKey;
  enabled_categories: NotificationCategory[];
  destinations: SubscriptionDestination[];
  timestamp: TimestampMs;
}

export interface SignedSubscriptionUpdate {
  update: SubscriptionUpdate;
  signature: Base58Signature;
}

export interface Subscription {
  wallet: Base58PeerId;
  wallet_public_key: Base58PublicKey;
  enabled_categories: NotificationCategory[];
  updated_at: TimestampMs;
}

export interface DeliveryReport {
  notification_id: string;
  service_id: string;
  provider: Base58PeerId;
  provider_public_key: Base58PublicKey;
  recipient_wallet: Base58PeerId;
  trigger: NotificationTrigger;
  status: DeliveryStatus;
  timestamp: TimestampMs;
}

export interface SignedDeliveryReport {
  report: DeliveryReport;
  signature: Base58Signature;
}

export interface DeliveryReceipt {
  notification_id: string;
  service_id: string;
  recipient_wallet: Base58PeerId;
  trigger: NotificationTrigger;
  status: DeliveryStatus;
  updated_at: TimestampMs;
}

// --- Reference data ---

/**
 * Which kind of rail a payment method is, so a long list can be grouped
 * into something a person can read.
 *
 * These are the Rust enum's variant names verbatim, not display strings:
 * `serde` writes `MobileMoney`, and an interface that wants "Mobile
 * Money" on screen formats it there.
 */
export type PaymentMethodCategory = "MobileMoney" | "BankTransfer" | "Fintech" | "Cash";

export interface ReferenceCurrency {
  /** Three-letter, uppercase — normalised by the node before it is sent. */
  code: string;
  name: string;
  /**
   * The symbol as written locally ("KSh", "₦", "£"). Not unique — eleven
   * of these are "$" — so it is decoration beside a code, never a key.
   */
  symbol: string;
}

export interface ReferenceCountry {
  /**
   * ISO 3166-1 alpha-2 where one exists, or a stable pseudo-code (`XNC`,
   * `XTR`) for a territory that has none. Do not assume two characters.
   */
  code: string;
  name: string;
  /** The currency most trade here is denominated in. */
  currency: string;
  /**
   * Other currencies in genuine everyday circulation, most-used first,
   * and empty for most countries. A picker that offers only `currency`
   * hides the USD book in a dollarised economy, which is frequently the
   * larger of the two.
   */
  alt_currencies: string[];
}

export interface ReferencePaymentMethod {
  /** Shown to a user, and stored on an advertisement verbatim. */
  name: string;
  category: PaymentMethodCategory;
  /** Lowercase spellings a person might type when they mean this method. Never shown. */
  aliases: string[];
}

export interface ReferenceMint {
  /** Base58 mint address. The only field that identifies anything. */
  mint: string;
  /**
   * What people call it: `wSOL`, `USDC`, `tUSDC`. A nickname, not a
   * key — cluster-dependent, not unique, and carried on no record this
   * protocol defines. Look a mint up by address; a client matching on the
   * ticker it expected is how a market page for `SOL` came to be one that
   * could never show an advertisement.
   */
  symbol: string;
  /**
   * Base-unit exponent, carried beside the symbol so a client cannot know
   * what to call a mint while guessing how to scale it. wSOL is 9 and the
   * stablecoins are 6.
   */
  decimals: number;
}

/**
 * The countries, fiat currencies, payment methods and token mints a node
 * suggests an interface offer — see {@link getReferenceData}, which explains why this
 * is a suggestion list and never a validation gate.
 */
export interface ReferenceData {
  /**
   * A digest of the four lists, changing when and only when they do.
   *
   * Two uses a version number cannot serve: cache on it across node
   * releases that did not touch the table, and compare two nodes for
   * agreement by one short string rather than diffing five hundred rows.
   */
  revision: string;
  currencies: ReferenceCurrency[];
  countries: ReferenceCountry[];
  payment_methods: ReferencePaymentMethod[];
  /**
   * Mints this node can put a name to.
   *
   * NOT the settlement allowlist. That lives on chain in the escrow
   * program’s `FeeConfig` and governance can change it; this is a
   * phrasebook for turning an address into a name, and the two sets are
   * not guaranteed equal in either direction.
   */
  mints: ReferenceMint[];
}
