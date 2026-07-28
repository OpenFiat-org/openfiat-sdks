import type { Client } from "../client.js";
import { type Keypair, sign } from "../crypto.js";
import { toBytes, type Registration, type ServiceRecord, type SignedRegistration } from "../types.js";

export async function getProvider(client: Client, id: string): Promise<ServiceRecord | null> {
  return client.call("getProvider", { id });
}

export async function getProviders(client: Client): Promise<ServiceRecord[]> {
  return client.call("getProviders", {});
}

export async function sendProviderRegister(
  client: Client,
  registration: Registration,
  keypair: Keypair,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(registration));
  const signature = await sign(keypair, bytes);
  const signed: SignedRegistration = { registration, signature: toBytes(signature) };
  return client.sendSigned("sendProviderRegister", signed);
}
