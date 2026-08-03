/** Settlement methods (OFS-2300). */
import type { Client } from "../client.js";
import { type Keypair, sign } from "../crypto.js";
import {
  toBase58,
  type PaymentReversed,
  type PaymentSubmitted,
  type PublicSettlement,
  type Settlement,
  type SettlementCancelled,
  type SettlementInitiate,
  type SettlementRejected,
  type SignedPaymentReversed,
  type SignedPaymentSubmitted,
  type SignedSettlementCancelled,
  type SignedSettlementInitiate,
  type SignedSettlementRejected,
} from "../types.js";
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

/**
 * Signs `initiate` with `keypair` and submits it, opening a settlement
 * against a reservation the taker already holds. Returns the new
 * settlement's ID.
 *
 * `keypair` must be the buyer named in `initiate` — the event is
 * self-consistency verified, so a `buyer` that is not the peer id
 * `buyer_public_key` derives to is refused before the signature is even
 * checked.
 *
 * Get `seller_public_key` right. Every later event on this settlement is
 * verified against the keys stored by this one, so a wrong seller key
 * leaves a settlement the merchant can never approve, reject or cancel.
 */
export async function sendSettlementInitiate(
  client: Client,
  initiate: SettlementInitiate,
  keypair: Keypair,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(initiate));
  const signature = await sign(keypair, bytes);
  const signed: SignedSettlementInitiate = { initiate, signature: toBase58(signature) };
  return client.sendSigned("sendSettlementInitiate", signed);
}

/**
 * Signs `payment` with `keypair` and submits it — the buyer's "I paid".
 *
 * `keypair` must be the settlement's buyer, and the settlement must be in
 * `AwaitingPayment`.
 *
 * Send this *before* the money leaves, not after it lands. The
 * declaration is what stops either party cancelling the settlement, and
 * the interval between a real transfer and its declaration is the one
 * window nothing in the protocol can protect. It costs a buyer nothing to
 * declare early and can cost them the whole transfer to declare late.
 */
export async function sendPaymentSubmitted(
  client: Client,
  payment: PaymentSubmitted,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(payment));
  const signature = await sign(keypair, bytes);
  const signed: SignedPaymentSubmitted = { action: payment, signature: toBase58(signature) };
  return client.sendSigned("sendPaymentSubmitted", signed);
}

/**
 * Signs `reversed` with `keypair` and submits it — the buyer taking "I
 * paid" back, for a declaration made in error.
 *
 * `keypair` must be the settlement's buyer, and the settlement must still
 * be in `PaymentSubmitted`: once the merchant has approved or rejected,
 * this is refused, so it can never be used to escape a decision already
 * taken. It returns the settlement to `AwaitingPayment` and clears both
 * `payment_reference` and `payment_submitted_at`, so the buyer is not
 * credited with a payment they withdrew and the merchant is not faulted
 * for failing to answer it.
 *
 * Confirm with the user before calling this. Returning to
 * `AwaitingPayment` re-arms {@link sendSettlementCancelled} for either
 * party, so a buyer whose fiat has genuinely left their account and who
 * reverses anyway has handed the merchant a window to cancel the trade
 * out from under the money. Reverse a mis-click; for a real payment, open
 * a dispute.
 */
export async function sendPaymentReversed(
  client: Client,
  reversed: PaymentReversed,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(reversed));
  const signature = await sign(keypair, bytes);
  const signed: SignedPaymentReversed = { action: reversed, signature: toBase58(signature) };
  return client.sendSigned("sendPaymentReversed", signed);
}

/**
 * Signs `rejected` with `keypair` and submits it — the merchant refusing
 * a payment they cannot find, without opening a dispute over it.
 *
 * `keypair` must be the settlement's seller, and the settlement must be
 * in `PaymentSubmitted`: there is nothing to reject before the buyer has
 * declared payment, and a buyer cannot reject their own settlement.
 *
 * This is the merchant's claim, recorded and gossiped — not a ruling. A
 * buyer who really did pay can still open a dispute afterwards, so the
 * effect of rejecting is to move the cost of escalating onto whichever
 * party is actually wrong instead of charging the merchant a filing fee
 * to say no.
 *
 * Set `discrepancy` to the kind that actually applies rather than
 * `"Other"`: it is the field reputation reads, and `reason` is prose
 * nothing parses.
 */
export async function sendSettlementRejected(
  client: Client,
  rejected: SettlementRejected,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(rejected));
  const signature = await sign(keypair, bytes);
  const signed: SignedSettlementRejected = { action: rejected, signature: toBase58(signature) };
  return client.sendSigned("sendSettlementRejected", signed);
}

/**
 * Signs `cancelled` with `keypair` and submits it — either party walking
 * away from a settlement before any payment is declared.
 *
 * `cancelled.canceller` must be the settlement's own buyer or seller and
 * must be the wallet `keypair` belongs to; the node picks the verifying
 * key by matching that field against the stored settlement, so naming
 * someone else fails either the party check or the signature check.
 *
 * Legal only from `AwaitingPayment`. Once the buyer has sent
 * `sendPaymentSubmitted` this returns an invalid-state error, and that is
 * deliberate — it is what stops a merchant cancelling a settlement out
 * from under a payment that has already been made.
 *
 * Which leaves one window nothing in the protocol can close: between a
 * buyer wiring fiat and that buyer declaring it. Declare first. The
 * declaration costs a buyer nothing and the window costs them the whole
 * transfer.
 */
export async function sendSettlementCancelled(
  client: Client,
  cancelled: SettlementCancelled,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(cancelled));
  const signature = await sign(keypair, bytes);
  const signed: SignedSettlementCancelled = { action: cancelled, signature: toBase58(signature) };
  return client.sendSigned("sendSettlementCancelled", signed);
}
