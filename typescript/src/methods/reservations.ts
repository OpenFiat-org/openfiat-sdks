import type { Client } from "../client.js";
import { type Keypair, sign } from "../crypto.js";
import {
  toBase58,
  type PublicReservation,
  type Reservation,
  type ReservationCancel,
  type ReservationRequest,
  type SignedReservationCancel,
  type SignedReservationRequest,
} from "../types.js";
import { walletProof } from "./wallet.js";

/** Domain separator for `getMyReservations`, transcribed from
 *  `openfiat-rpc`'s `methods::reservations::CHALLENGE_DOMAIN`. */
export const CHALLENGE_DOMAIN = "openfiat-my-reservations";

/**
 * Read one reservation as a stranger sees it: the advertisement it was
 * raised against survives, the requester does not. The pairing is the
 * whole leak — an advertisement already names its merchant publicly, so
 * naming the requester alongside it completes an edge of the trade graph
 * even for trades that never settled.
 */
export async function getReservation(
  client: Client,
  id: string,
): Promise<PublicReservation | null> {
  return client.call("getReservation", { id });
}

/** Every reservation on the network, redacted. */
export async function getReservations(client: Client): Promise<PublicReservation[]> {
  return client.call("getReservations", {});
}

/** Every reservation `keypair`'s wallet requested, in full, proved by
 *  signing a freshly issued wallet challenge. */
export async function getMyReservations(client: Client, keypair: Keypair): Promise<Reservation[]> {
  return client.call("getMyReservations", await walletProof(client, keypair, CHALLENGE_DOMAIN));
}

/** Signs `request` with `keypair` and submits it. Returns the new reservation's ID. */
export async function sendReservationRequest(
  client: Client,
  request: ReservationRequest,
  keypair: Keypair,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  const signature = await sign(keypair, bytes);
  const signed: SignedReservationRequest = { request, signature: toBase58(signature) };
  return client.sendSigned("sendReservationRequest", signed);
}

/**
 * Signs `cancel` with `keypair` and submits it — giving up a reservation
 * and returning the merchant's liquidity to their advertisement now,
 * rather than thirty minutes from now when the node's expiry sweep would
 * have done it anyway.
 *
 * `keypair` must be the reservation's own requester; the node verifies
 * against the public key the reservation already carries, not against
 * anything sent here. Legal only from `EscrowLocked` — a reservation
 * already `Cancelled` or `Expired` returns an application error rather
 * than succeeding quietly.
 *
 * This cancels the reservation and nothing else. If a settlement has
 * already been raised against it, cancel that too with
 * `settlement.sendSettlementCancelled` — the two records are not linked,
 * so cancelling one leaves the other running.
 */
export async function sendReservationCancel(
  client: Client,
  cancel: ReservationCancel,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(cancel));
  const signature = await sign(keypair, bytes);
  const signed: SignedReservationCancel = { cancel, signature: toBase58(signature) };
  return client.sendSigned("sendReservationCancel", signed);
}
