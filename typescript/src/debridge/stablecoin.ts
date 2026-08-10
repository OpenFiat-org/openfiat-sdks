/**
 * deBridge DLN `create-tx` order builders for non-custodial USDC/USDT
 * deposit and withdraw (SP-C, stablecoin bridge).
 *
 * Unlike {@link "./hook.js" | hook.ts}'s `buildDeliverContributionHook`
 * (SP-B), the orders built here are **plain value transfers**: a user
 * moves their own USDC/USDT between their own wallet on another chain and
 * their own Solana wallet, with no OpenFiat program instruction attached.
 * The two builders below therefore never set `dlnHook` — carrying one
 * would silently turn a plain transfer into SP-B's auto-deliver mechanism,
 * which is exactly the bug this module's tests guard against.
 *
 * # What's reused from SP-B's `debridge/` module
 *
 * - `ASSOCIATED_TOKEN_PROGRAM_ID` from `./hook.js`, for deriving the
 *   Solana recipient's associated token account the same way
 *   `hook.ts`'s own (unexported) `recipientOpenAta` does.
 * - `SolanaHookData`'s shape from `./hook.js` for `CreateTxRequest.dlnHook`'s
 *   type — the same nested `{ type, data: { instructions } }` envelope
 *   `hook.ts` validated against deBridge's live `create-tx` Swagger spec
 *   (see that module's doc comment). This module's `CreateTxRequest` is a
 *   new type (SP-B built no generic `create-tx` request type — only the
 *   hook payload itself), but it reuses that envelope type for the one
 *   field the two modules share.
 * - `SOLANA_DST_CHAIN_ID` (`7_565_164`) and the `srcChainId`/`dstChainId`
 *   convention (`docs.debridge.com`'s DLN fee table: an EVM chain's
 *   internal id is its real EVM chain id; Solana and TRON get deBridge's
 *   own synthetic ids) match the values `openfiat-app/lib/debridge-order.ts`
 *   already established and shipped for SP-B's `ethereum`/`bsc`/`tron`
 *   entries — carried forward here rather than re-derived, and extended to
 *   the rest of "EVM majors" using the same real-chain-id rule.
 *
 * # Token address sourcing (fetched live while writing this module)
 *
 * `CHAIN_STABLECOIN_TOKENS` is a best-effort reference table, not read
 * from deBridge's own token-list API (unreachable from this environment —
 * same "pre-mainnet, live-API" gate `hook.ts` and
 * `openfiat-app/lib/debridge-order.ts` both flag). Each address below was
 * cross-checked against a public block explorer or the issuer's own site
 * while writing this module:
 *
 * - Ethereum, BSC, Polygon, Arbitrum, Optimism, Avalanche, Base USDC:
 *   Circle's own multi-chain USDC address list (`circle.com/multi-chain-usdc`).
 * - Ethereum/BSC/Polygon/Arbitrum/Optimism/Avalanche USDT: each chain's
 *   official Tether contract, per Etherscan/BscScan/PolygonScan/Arbiscan/
 *   Optimistic Etherscan/Snowtrace listings.
 * - TRON USDT: `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, Tether's official TRC20
 *   contract (tronscan.org).
 * - TRON USDC: `TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8`, Circle's TRC20
 *   contract — included for completeness, but Circle has publicly announced
 *   it is discontinuing USDC support on TRON; do not route new volume here
 *   without checking deBridge still lists it.
 * - Base has no official Tether-issued USDT contract as of this writing
 *   (only third-party bridged tokens Tether itself disclaims) — omitted
 *   rather than guessed. `buildStablecoinWithdrawOrder`'s `dstToken` is a
 *   required, caller-supplied parameter for exactly this reason: the SDK
 *   never silently substitutes one of these reference addresses for a
 *   caller who didn't check it.
 *
 * As with SP-B, none of this has been confirmed against a live `create-tx`
 * call — that remains the pre-mainnet integration gate.
 */

import { PublicKey } from "@solana/web3.js";

import { ASSOCIATED_TOKEN_PROGRAM_ID } from "./hook.js";
import type { SolanaHookData } from "./hook.js";

// ---------------------------------------------------------------------------
// deBridge DLN chain ids.
// ---------------------------------------------------------------------------

/**
 * deBridge's own "Internal Chain ID" values. For an EVM chain this is just
 * its real EVM chain id; Solana and TRON are not EVM chains, so deBridge
 * assigns each a synthetic id instead (source: `docs.debridge.com`'s DLN
 * fee table — see this module's doc comment for what's freshly sourced vs.
 * carried over from SP-B).
 */
export const DEBRIDGE_CHAIN_IDS = {
  ethereum: 1,
  bsc: 56,
  polygon: 137,
  optimism: 10,
  base: 8_453,
  arbitrum: 42_161,
  avalanche: 43_114,
  tron: 100_000_026,
  solana: 7_565_164,
} as const;

export type DebridgeChainKey = keyof typeof DEBRIDGE_CHAIN_IDS;

/** Solana's deBridge internal chain id — also its real, only chain id. Reused from SP-B (`openfiat-app/lib/debridge-order.ts`'s `SOLANA_DST_CHAIN_ID`, and `hook.ts`'s own doc comment). */
export const SOLANA_CHAIN_ID = DEBRIDGE_CHAIN_IDS.solana;

// ---------------------------------------------------------------------------
// Stablecoins.
// ---------------------------------------------------------------------------

export type StablecoinSymbol = "USDC" | "USDT";

/** Both USDC and USDT use 6 decimals everywhere deBridge routes them. */
export const STABLECOIN_DECIMALS = 6;

/** The SPL Token program (legacy) — same address on every cluster. Solana's USDC/USDT mints both live under this program, not Token-2022. */
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** The Token-2022 program — exported for callers building a `devnet` mint override table for a Token-2022 test mint. */
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export interface SolanaMintInfo {
  mint: PublicKey;
  /** The SPL token program this mint moves under — `TOKEN_PROGRAM_ID` for both mainnet mints; a `devnet` override may use `TOKEN_2022_PROGRAM_ID` or a custom program instead. */
  tokenProgram: PublicKey;
}

/** Canonical mainnet Solana USDC/USDT mints. */
export const MAINNET_SOLANA_STABLECOIN_MINTS: Readonly<Record<StablecoinSymbol, SolanaMintInfo>> = {
  USDC: { mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), tokenProgram: TOKEN_PROGRAM_ID },
  USDT: { mint: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"), tokenProgram: TOKEN_PROGRAM_ID },
};

/**
 * `mainnet` is fixed (the canonical mints above); `devnet` starts empty and
 * is a plain mutable object an app wires up from its own cluster config
 * (devnet USDC/USDT are test mints with no single canonical address) —
 * assign into it, or pass a `solanaMints` override directly to the
 * builders below, whichever fits the caller's config flow better.
 */
export const SOLANA_STABLECOIN_MINTS: {
  mainnet: Readonly<Record<StablecoinSymbol, SolanaMintInfo>>;
  devnet: Partial<Record<StablecoinSymbol, SolanaMintInfo>>;
} = {
  mainnet: MAINNET_SOLANA_STABLECOIN_MINTS,
  devnet: {},
};

function resolveSolanaMint(
  stablecoin: StablecoinSymbol,
  mints: Readonly<Partial<Record<StablecoinSymbol, SolanaMintInfo>>>,
): SolanaMintInfo {
  const info = mints[stablecoin];
  if (!info) {
    throw new Error(`buildStablecoinOrder: no Solana mint configured for ${stablecoin}`);
  }
  return info;
}

/**
 * Reference EVM/BSC/Tron USDC/USDT contract addresses — see this module's
 * doc comment for sourcing and the Base-USDT/TRON-USDC caveats. A
 * convenience lookup only: `buildStablecoinDepositOrder`/
 * `buildStablecoinWithdrawOrder` always take the source/destination token
 * address as an explicit, caller-supplied parameter and never read this
 * table themselves, so a stale or wrong entry here can't silently steer a
 * real transfer.
 */
export const CHAIN_STABLECOIN_TOKENS: Readonly<
  Record<Exclude<DebridgeChainKey, "solana">, Partial<Record<StablecoinSymbol, string>>>
> = {
  ethereum: { USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
  bsc: { USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", USDT: "0x55d398326f99059fF775485246999027B3197955" },
  polygon: { USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
  arbitrum: { USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" },
  optimism: { USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58" },
  avalanche: { USDC: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", USDT: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7" },
  base: { USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, // no official Tether USDT on Base — see module doc
  tron: { USDC: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", USDT: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
};

// ---------------------------------------------------------------------------
// Solana ATA derivation — same formula as `hook.ts`'s `recipientOpenAta`,
// reusing its `ASSOCIATED_TOKEN_PROGRAM_ID` rather than redefining it.
// ---------------------------------------------------------------------------

function toPublicKey(value: PublicKey | string): PublicKey {
  return value instanceof PublicKey ? value : new PublicKey(value);
}

/** Derives `owner`'s associated token account for `mint`, under `tokenProgram`. */
export function deriveAssociatedTokenAddress(
  owner: PublicKey | string,
  mint: PublicKey,
  tokenProgram: PublicKey,
): PublicKey {
  const ownerKey = toPublicKey(owner);
  const [ata] = PublicKey.findProgramAddressSync(
    [ownerKey.toBytes(), tokenProgram.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

// ---------------------------------------------------------------------------
// The `create-tx` order request.
// ---------------------------------------------------------------------------

/**
 * The DLN `create-tx` GET endpoint's query parameters, per
 * `docs.debridge.com`'s "API Parameters" page — the same fields
 * `openfiat-app/lib/debridge-order.ts`'s `CrossChainOrderRequest` already
 * ships for SP-B, minus the two order-authority fields that request always
 * sets (this module's plain transfers have no on-Solana hook authority to
 * assign) and with `dlnHook` optional rather than required, since the two
 * builders below never set it.
 */
export interface CreateTxRequest {
  srcChainId: string;
  srcChainTokenIn: string;
  srcChainTokenInAmount: string;
  dstChainId: string;
  dstChainTokenOut: string;
  dstChainTokenOutAmount: "auto";
  dstChainTokenOutRecipient: string;
  /**
   * The order's authority on each side — required by the live `create-tx`
   * endpoint, but not always knowable to a pure builder (see each
   * builder's own doc comment for which side it can and can't fill in).
   * Optional here rather than defaulted to `""`: a caller that forgets to
   * fill in a genuinely-unknown authority gets a missing key it can check
   * for, not a silently-wrong empty string sent to deBridge.
   */
  srcChainOrderAuthorityAddress?: string;
  dstChainOrderAuthorityAddress?: string;
  /**
   * Never set by `buildStablecoinDepositOrder`/`buildStablecoinWithdrawOrder`
   * — a plain USDC/USDT transfer has no on-Solana instruction to run on
   * fill. Typed here (reusing `hook.ts`'s `SolanaHookData` envelope) only
   * so `CreateTxRequest` can describe the general `create-tx` shape;
   * present at all is what this module's "no hook" tests assert against.
   */
  dlnHook?: SolanaHookData;
}

export interface StablecoinDepositParams {
  /** The source chain's deBridge internal chain id — e.g. `DEBRIDGE_CHAIN_IDS.ethereum`. */
  srcChainId: number;
  /** The stablecoin's contract address on the source chain (e.g. `CHAIN_STABLECOIN_TOKENS.ethereum.USDC`). */
  srcToken: string;
  /** Base units of `srcToken` (respecting its own decimals on the source chain), as a `bigint` — never `number`, to avoid precision loss on large transfers. */
  amount: bigint;
  stablecoin: StablecoinSymbol;
  /** The user's own Solana wallet — funds land in its ATA for the chosen stablecoin, never anywhere else. */
  solanaRecipient: PublicKey | string;
  /** Overrides `SOLANA_STABLECOIN_MINTS.mainnet` — pass `SOLANA_STABLECOIN_MINTS.devnet` (or a custom table) for non-mainnet clusters. */
  solanaMints?: Readonly<Partial<Record<StablecoinSymbol, SolanaMintInfo>>>;
}

/**
 * Builds a deBridge DLN `create-tx` request that bridges USDC/USDT from
 * another chain into the caller's own Solana wallet — a plain value
 * transfer, **no `dlnHook`**. `dstChainOrderAuthorityAddress` is set to
 * `solanaRecipient` itself (only the recipient can cancel/manage the order
 * on the Solana side; the SDK never assigns that to anything else), and
 * `srcChainOrderAuthorityAddress` defaults to the same value the caller
 * will actually sign the source-chain transaction with — set by the
 * caller once it has the connected source wallet's address, via the
 * returned request's field (see the field's own doc for why the SDK can't
 * fill it in here).
 */
export function buildStablecoinDepositOrder(params: StablecoinDepositParams): CreateTxRequest {
  if (params.amount <= 0n) {
    throw new Error("buildStablecoinDepositOrder: amount must be a positive bigint");
  }
  const mints = params.solanaMints ?? SOLANA_STABLECOIN_MINTS.mainnet;
  const mintInfo = resolveSolanaMint(params.stablecoin, mints);
  const recipient = toPublicKey(params.solanaRecipient);
  const recipientAta = deriveAssociatedTokenAddress(recipient, mintInfo.mint, mintInfo.tokenProgram);

  return {
    srcChainId: String(params.srcChainId),
    srcChainTokenIn: params.srcToken,
    srcChainTokenInAmount: params.amount.toString(),
    dstChainId: String(SOLANA_CHAIN_ID),
    dstChainTokenOut: mintInfo.mint.toBase58(),
    dstChainTokenOutAmount: "auto",
    dstChainTokenOutRecipient: recipientAta.toBase58(),
    // The source wallet isn't known to this pure builder — callers fill
    // `srcChainOrderAuthorityAddress` in with the connected source-chain
    // wallet's address before submitting to `create-tx`, same division of
    // responsibility as `openfiat-app/lib/debridge-order.ts`'s
    // `buildCrossChainOrderRequest`. Left unset (not `""`) so that's a
    // missing key, not a silently-wrong empty string.
    dstChainOrderAuthorityAddress: recipient.toBase58(),
  };
}

export interface StablecoinWithdrawParams {
  /** The Solana wallet the caller will actually sign the withdraw transaction with — also the DLN order's Solana-side authority. */
  solanaOwner: PublicKey | string;
  /** Base units of the Solana USDC/USDT mint (6 decimals), as a `bigint`. */
  amount: bigint;
  stablecoin: StablecoinSymbol;
  /** The destination chain's deBridge internal chain id — e.g. `DEBRIDGE_CHAIN_IDS.tron`. */
  dstChainId: number;
  /** The stablecoin's contract/token address on the destination chain. */
  dstToken: string;
  /** The destination-chain wallet that receives the withdrawn funds. */
  dstRecipient: string;
  /** Overrides `SOLANA_STABLECOIN_MINTS.mainnet` — see {@link StablecoinDepositParams.solanaMints}. */
  solanaMints?: Readonly<Partial<Record<StablecoinSymbol, SolanaMintInfo>>>;
}

/**
 * Builds a deBridge DLN `create-tx` request that bridges USDC/USDT out of
 * the caller's own Solana wallet to another chain — a plain value
 * transfer, **no `dlnHook`**. The source token is always the Solana
 * USDC/USDT mint (never caller-supplied — there is exactly one canonical
 * address per cluster, see `SOLANA_STABLECOIN_MINTS`).
 */
export function buildStablecoinWithdrawOrder(params: StablecoinWithdrawParams): CreateTxRequest {
  if (params.amount <= 0n) {
    throw new Error("buildStablecoinWithdrawOrder: amount must be a positive bigint");
  }
  const mints = params.solanaMints ?? SOLANA_STABLECOIN_MINTS.mainnet;
  const mintInfo = resolveSolanaMint(params.stablecoin, mints);
  const owner = toPublicKey(params.solanaOwner);

  return {
    srcChainId: String(SOLANA_CHAIN_ID),
    srcChainTokenIn: mintInfo.mint.toBase58(),
    srcChainTokenInAmount: params.amount.toString(),
    dstChainId: String(params.dstChainId),
    dstChainTokenOut: params.dstToken,
    dstChainTokenOutAmount: "auto",
    dstChainTokenOutRecipient: params.dstRecipient,
    srcChainOrderAuthorityAddress: owner.toBase58(),
    // The destination-chain authority has no meaning for a non-Solana
    // destination in the same way `dstChainOrderAuthorityAddress` does for
    // a Solana destination (deposit's case) — deBridge's own `create-tx`
    // docs describe it as required regardless, so it's set to the
    // recipient itself, the only address on that chain the caller has
    // told this builder about.
    dstChainOrderAuthorityAddress: params.dstRecipient,
  };
}
