/**
 * Typed instruction builders for the three on-chain Anchor programs
 * (OFS-4200): `openfiat-escrow`, `openfiat-staking`, `openfiat-governance`.
 * Each submodule derives every PDA account internally — a caller only
 * ever supplies signers, mints, and token accounts it doesn't control
 * itself. See `codec.ts` for the shared Borsh-subset encoder these
 * builders use to match Anchor's own instruction-data wire format.
 */
export * from "./constants.js";
export * as escrow from "./escrow.js";
export * as staking from "./staking.js";
export * as governance from "./governance.js";
