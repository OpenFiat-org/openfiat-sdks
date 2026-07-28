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

/** Every account these programs custody is a Token-2022 mint (OFS-4200 §1). */
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const RENT_SYSVAR_ID = new PublicKey("SysvarRent111111111111111111111111111111111");

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
export enum DisputeOutcome {
  BuyerWins = 0,
  MerchantWins = 1,
  MutualSettlement = 2,
  InvalidDispute = 3,
}
