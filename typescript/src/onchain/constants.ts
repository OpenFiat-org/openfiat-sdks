import { PublicKey } from "@solana/web3.js";

/**
 * On-chain program ids (OFS-4200) and well-known Solana addresses used
 * to build instructions for `openfiat-escrow`/`openfiat-staking`/
 * `openfiat-governance`. Values taken directly from each program's own
 * `declare_id!` in its `openfiat-core/programs/programs/<name>/src/lib.rs`.
 */
export const ESCROW_PROGRAM_ID = new PublicKey("HaPpM1QYM3dKp3sX7zhEdft9hB6ncu6xfALAbkyQChQP");
export const STAKING_PROGRAM_ID = new PublicKey("HYEXk8XQukBkZbiYB33JyVefQDxqyCpPudad3wBCyYmx");
export const GOVERNANCE_PROGRAM_ID = new PublicKey("AVJfKUjHsizkGGUy8sdz4Xma2hVgmgvgg8GmUMs8E4eE");

/**
 * The OPEN token mint (Token-2022) — the protocol's own token, and the
 * denomination of every stake account, rewards vault and treasury bucket
 * the staking and governance builders touch.
 *
 * Exported for the same reason the program ids above are.
 * `openfiat-core` pins this in `crates/chain/src/programs.rs` as a
 * compile-time constant so a node operator cannot nominate the token
 * their own stake is denominated in; a caller that has to retype the
 * base58 string to call `staking.stakeIx` reintroduces exactly that, one
 * layer out. A wrong mint does not fail loudly — it derives a real,
 * empty associated token account, and the transaction is rejected for a
 * balance the caller can see in a wallet holding the other token.
 *
 * Not a default anywhere, and specifically not escrow's: a trade settles
 * in whichever mint the advertisement names (wSOL, USDC), which is why
 * the escrow builders take the mint and its token program as parameters.
 * This is the answer only where the protocol itself is the counterparty.
 */
export const OPEN_MINT = new PublicKey("29w8TroBTYoaqrXBDcpv5L54VZRA8Kf7kU5U1cakvFdj");

/**
 * The SPL Token-2022 program.
 *
 * Still the right answer for staking and governance, which deal only in
 * OPEN, and OPEN is a Token-2022 mint. It is **not** automatically the
 * right answer for escrow: since the programs moved to
 * `Interface<TokenInterface>`, a settlement mint may be legacy SPL — wSOL
 * and real USDC both are — so the escrow builders take the program as a
 * parameter. See {@link LEGACY_TOKEN_PROGRAM_ID}.
 */
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
/**
 * The original SPL Token program.
 *
 * Most mints in circulation are still this one, including wSOL and the real
 * USDC and USDT. An escrow transaction naming Token-2022 for one of them is
 * rejected by the runtime before the program ever sees it.
 *
 * Neither constant is a default anywhere. Derive the right one from the
 * mint account's own `owner` and pass it: the SDK cannot know it without an
 * RPC round trip, and a builder that quietly performs network I/O is worse
 * than one that asks.
 */
export const LEGACY_TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const RENT_SYSVAR_ID = new PublicKey("SysvarRent111111111111111111111111111111111");
/**
 * The SlotHashes sysvar — read by the dispute instructions that latch a
 * case's arbitrator-sortition seed (OFS-4100 §4.1). Passed as an account
 * rather than fetched in-program because it is far too large to
 * deserialize there.
 */
export const SLOT_HASHES_SYSVAR_ID = new PublicKey("SysvarS1otHashes111111111111111111111111111");

/**
 * A staked/bonded protocol role (OFS-4200 §2) — `openfiat-staking`'s
 * `StakeAccount` is keyed by `(owner, role)`. Variant order (and
 * therefore each numeric value, since Borsh's enum tag is just the
 * declaration index) must match `openfiat-core/programs/shared/src/
 * lib.rs`'s `Role` exactly.
 */
export enum Role {
  Merchant = 0,
  Arbitrator = 1,
  NodeOperator = 2,
  NotificationProvider = 3,
  OracleProvider = 4,
  RiskIntelligenceProvider = 5,
  SnapshotProvider = 6,
}

/** OFS-4100 §5's 6-category governance taxonomy (OFS-4200 §2). */
export enum ProposalCategory {
  Informational = 0,
  Standards = 1,
  Parameter = 2,
  Treasury = 3,
  ProtocolUpgrade = 4,
  Constitutional = 5,
}

/** A dispute case's resolution outcome (OFS-2400 §17, OFS-4200 §2). */
/** Number of `Role` variants — the length of `StakingConfig`'s per-role
 *  minimum-stake array. Must match `Role::COUNT` in `programs/shared`. */
export const ROLE_COUNT = 7;

export enum DisputeOutcome {
  BuyerWins = 0,
  MerchantWins = 1,
  MutualSettlement = 2,
  InvalidDispute = 3,
}

/**
 * PDA seed for a `governance::BanRecord` (OFS-7100 §12).
 *
 * Lives here rather than in `governance.ts` for the same reason its
 * Rust counterpart lives in `programs/shared` rather than in the
 * `governance` crate: `governance.ts` already imports from
 * `staking.ts`, so a `staking.ts -> governance.ts` import for the ban
 * helper would close a module cycle. `constants.ts` imports nothing, so
 * every builder can reach the gate from here.
 */
export const BAN_SEED = Buffer.from("ban");

/**
 * The canonical ban address for a wallet — `[BAN_SEED, wallet]` under
 * `openfiat-governance`.
 *
 * Every gated instruction re-derives this on-chain from its own
 * signer's key and rejects anything else, so this is not a convenience:
 * an instruction built with any other account in that slot fails with
 * `ConstraintSeeds`. The wallet is banned iff this address is occupied;
 * for an unbanned wallet it names an account that does not exist, which
 * is exactly what the program expects to see.
 */
export function banRecordPda(wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([BAN_SEED, wallet.toBytes()], GOVERNANCE_PROGRAM_ID);
}

/**
 * Grounds for a listing (OFS-7100 §12). Variant order must match
 * `governance::state::BanReason`, since Borsh's enum tag is the
 * declaration index.
 */
export enum BanReason {
  StolenFunds = 0,
  Sanctions = 1,
  Phishing = 2,
  Scam = 3,
  Other = 4,
}
