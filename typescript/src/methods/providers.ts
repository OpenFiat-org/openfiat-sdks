import type { Client } from "../client.js";
import { type Keypair, sign } from "../crypto.js";
import {
  toBytes,
  type HealthUpdate,
  type Registration,
  type ServiceRecord,
  type SignedHealthUpdate,
  type SignedRegistration,
  type SignedWithdrawal,
  type Withdrawal,
} from "../types.js";

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

/**
 * Publish a health update (OFS-1500 §11). A node expires services it has not
 * seen an update for, so a long-running provider must call this on an
 * interval to stay in the registry.
 */
export async function sendProviderHealthUpdate(
  client: Client,
  update: HealthUpdate,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(update));
  const signature = await sign(keypair, bytes);
  const signed: SignedHealthUpdate = { update, signature: toBytes(signature) };
  return client.sendSigned("sendProviderHealthUpdate", signed);
}

/**
 * Voluntarily withdraw a service (OFS-1500 §17). Verified against the key
 * already on file, so only the registrant can withdraw it.
 */
export async function sendProviderWithdraw(
  client: Client,
  withdrawal: Withdrawal,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(withdrawal));
  const signature = await sign(keypair, bytes);
  const signed: SignedWithdrawal = { withdrawal, signature: toBytes(signature) };
  return client.sendSigned("sendProviderWithdraw", signed);
}
