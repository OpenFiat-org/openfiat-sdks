import type { Client } from "../client.js";
import { type Keypair, sign } from "../crypto.js";
import {
  toBytes,
  type PublicReservation,
  type Reservation,
  type ReservationRequest,
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
  const signed: SignedReservationRequest = { request, signature: toBytes(signature) };
  return client.sendSigned("sendReservationRequest", signed);
}
