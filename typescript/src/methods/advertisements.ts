import type { Client } from "../client.js";
import { type Keypair, sign } from "../crypto.js";
import {
  toBytes,
  type Advertisement,
  type AdvertisementCreate,
  type AdvertisementDisable,
  type AdvertisementPriceUpdate,
  type SignedAdvertisementCreate,
  type SignedAdvertisementDisable,
  type SignedAdvertisementPriceUpdate,
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

/** Signs `disable` with `keypair` and submits it. Only a signature from the
 *  ad's original merchant key will be accepted — see `AdvertisementDisable`. */
export async function sendAdvertisementDisable(
  client: Client,
  disable: AdvertisementDisable,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(disable));
  const signature = await sign(keypair, bytes);
  const signed: SignedAdvertisementDisable = { disable, signature: toBytes(signature) };
  return client.sendSigned("sendAdvertisementDisable", signed);
}

/** Signs `update` with `keypair` and submits it — repricing an existing ad
 *  in place rather than disabling and recreating it (§17). */
export async function sendAdvertisementPriceUpdate(
  client: Client,
  update: AdvertisementPriceUpdate,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(update));
  const signature = await sign(keypair, bytes);
  const signed: SignedAdvertisementPriceUpdate = { update, signature: toBytes(signature) };
  return client.sendSigned("sendAdvertisementPriceUpdate", signed);
}
