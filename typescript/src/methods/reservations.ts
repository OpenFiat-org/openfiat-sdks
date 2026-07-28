import type { Client } from "../client.js";
import { type Keypair, sign } from "../crypto.js";
import {
  toBytes,
  type Reservation,
  type ReservationRequest,
  type SignedReservationRequest,
} from "../types.js";

export async function getReservation(client: Client, id: string): Promise<Reservation | null> {
  return client.call("getReservation", { id });
}

export async function getReservations(client: Client): Promise<Reservation[]> {
  return client.call("getReservations", {});
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
