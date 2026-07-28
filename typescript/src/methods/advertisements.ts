import type { Client } from "../client.js";
import { type Keypair, sign } from "../crypto.js";
import {
  toBytes,
  type Advertisement,
  type AdvertisementCreate,
  type SignedAdvertisementCreate,
} from "../types.js";

export async function getAdvertisement(client: Client, id: string): Promise<Advertisement | null> {
  return client.call("getAdvertisement", { id });
}

export async function getAdvertisements(client: Client): Promise<Advertisement[]> {
  return client.call("getAdvertisements", {});
}

/** Signs `create` with `keypair` and submits it. Returns the new advertisement's ID. */
export async function sendAdvertisementCreate(
  client: Client,
  create: AdvertisementCreate,
  keypair: Keypair,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(create));
  const signature = await sign(keypair, bytes);
  const signed: SignedAdvertisementCreate = { create, signature: toBytes(signature) };
  return client.sendSigned("sendAdvertisementCreate", signed);
}
