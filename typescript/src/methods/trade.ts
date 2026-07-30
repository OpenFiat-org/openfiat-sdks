/**
 * Trade methods (OFS-2000) — a read-only join over a reservation and the
 * settlement it became, so there is no `send*` method here at all.
 */
import type { Client } from "../client.js";
import type { Keypair } from "../crypto.js";
import type { PublicTrade, Trade, TradeStatus } from "../types.js";
import { walletProof } from "./wallet.js";

/** Domain separator for `getMyTrades`, transcribed from `openfiat-rpc`'s
 *  `methods::trade::CHALLENGE_DOMAIN`. */
export const CHALLENGE_DOMAIN = "openfiat-my-trades";

/**
 * Read one trade, by its reservation id, as a stranger sees it: amounts,
 * states and timing, with neither party named.
 *
 * This read used to answer with both records whole, which made it the way
 * around the redaction of `getReservation`, `getSettlement` and
 * `getDispute` — a trade embeds the two records it joins, so closing them
 * and leaving this open left the same graph one method along. See
 * {@link getMyTrades} for the unredacted read.
 */
export async function getTrade(client: Client, reservationId: string): Promise<PublicTrade | null> {
  return client.call("getTrade", { id: reservationId });
}

/** Every trade on the network, redacted. */
export async function getTrades(client: Client): Promise<PublicTrade[]> {
  return client.call("getTrades", {});
}

/**
 * Every trade `keypair`'s wallet is party to, in full, proved by signing
 * a freshly issued wallet challenge.
 *
 * Party means the reservation's requester or either side of the
 * settlement. Both are checked because a trade exists before a settlement
 * does, and until then the requester is its only party.
 *
 * Note the shape: a {@link Trade} carries no `status`, because the node
 * derives that in the public view rather than storing it on the join.
 * Pass the result to {@link tradeStatus} for the same value the public
 * read hands to strangers.
 */
export async function getMyTrades(client: Client, keypair: Keypair): Promise<Trade[]> {
  return client.call("getMyTrades", await walletProof(client, keypair, CHALLENGE_DOMAIN));
}

/**
 * The aggregate status of a trade you read back through
 * {@link getMyTrades}.
 *
 * Transcribed from the node's `Trade::status`, and computed here only
 * because `getMyTrades` returns the joined record rather than the public
 * view: the derived status travels on {@link PublicTrade} and not on
 * {@link Trade}, so a party would otherwise be the one caller who cannot
 * see it. The live-node test pins this against the node's own derivation
 * of the same trade, so a divergence fails there rather than in a UI.
 */
export function tradeStatus(trade: Trade): TradeStatus {
  if (trade.reservation.state !== "EscrowLocked") {
    // Cancelled and Expired are the same thing to someone looking at a
    // trade: it is not happening, and no settlement followed.
    return "Cancelled";
  }
  if (trade.settlement === null) return "EscrowLocked";
  switch (trade.settlement.state) {
    // `Approved` (the merchant said yes) and `Completed` (the on-chain
    // release confirmed) collapse to one value — a caller who needs the
    // distinction reads `escrow_release_signature`, which is where "has
    // it actually landed" lives.
    case "Approved":
    case "Completed":
      return "Completed";
    default:
      return trade.settlement.state;
  }
}
