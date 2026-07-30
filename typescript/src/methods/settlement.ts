/** Settlement methods (OFS-2300). */
import type { Client } from "../client.js";
import type { Keypair } from "../crypto.js";
import type { PublicSettlement, Settlement } from "../types.js";
import { walletProof } from "./wallet.js";

/**
 * Domain separator for `getMySettlements`, transcribed from
 * `openfiat-rpc`'s `methods::settlement::CHALLENGE_DOMAIN`. A signature
 * collected on another gated surface can never be presented here, even
 * though both draw their nonces from the same ledger.
 */
export const CHALLENGE_DOMAIN = "openfiat-my-settlements";

/**
 * Read one settlement as a stranger sees it — no parties, no payment
 * reference. See {@link PublicSettlement} for why that is a different
 * type rather than the same one with holes in it, and
 * {@link getMySettlements} for the unredacted read.
 */
export async function getSettlement(
  client: Client,
  id: string,
): Promise<PublicSettlement | null> {
  return client.call("getSettlement", { id });
}

/** Every settlement on the network, redacted — the public volume and
 *  state view an explorer wants. */
export async function getSettlements(client: Client): Promise<PublicSettlement[]> {
  return client.call("getSettlements", {});
}

/**
 * Every settlement `keypair`'s wallet is the buyer or the seller of, in
 * full, proved by signing a freshly issued wallet challenge.
 *
 * Nothing is disclosed here that the caller was not already party to:
 * they know who they traded with, and withholding it would protect
 * nobody while breaking the trade room.
 */
export async function getMySettlements(client: Client, keypair: Keypair): Promise<Settlement[]> {
  return client.call("getMySettlements", await walletProof(client, keypair, CHALLENGE_DOMAIN));
}
