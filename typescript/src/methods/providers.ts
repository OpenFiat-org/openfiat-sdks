import type { Client } from "../client.js";
import { type Keypair, sign } from "../crypto.js";
import {
  toBase58,
  type EarningsChallenge,
  type HealthUpdate,
  type ProviderEarnings,
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
  const signed: SignedRegistration = { registration, signature: toBase58(signature) };
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
  const signed: SignedHealthUpdate = { update, signature: toBase58(signature) };
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
  const signed: SignedWithdrawal = { withdrawal, signature: toBase58(signature) };
  return client.sendSigned("sendProviderWithdraw", signed);
}

/**
 * Ask for a single-use challenge to read a service's earnings
 * (OFS-4100 §9.5).
 *
 * Prefer {@link getProviderEarnings}, which performs both steps. This is
 * exposed separately for callers whose signing key lives somewhere the SDK
 * cannot reach — a browser wallet's `signMessage`, for instance.
 */
export async function getProviderEarningsChallenge(
  client: Client,
  id: string,
): Promise<EarningsChallenge> {
  return client.call("getProviderEarningsChallenge", { id });
}

/** The exact bytes a provider signs to answer a challenge. */
export function earningsChallengeBytes(challenge: EarningsChallenge): Uint8Array {
  return new TextEncoder().encode(
    `openfiat-earnings:${challenge.service_id}:${challenge.nonce}`,
  );
}

/**
 * Read a service's earnings statement, proving control of it by signing a
 * freshly issued challenge. `keypair` must be the key the service was
 * registered with.
 *
 * Statements are empty for every service today. Per OFS-4100 §9.5:
 * notification delivery is the one billable trigger and is not yet metered;
 * risk intelligence is open; and **oracle reads and snapshot downloads are
 * free by decision**, so those two will never accrue here. Charging for
 * either would work against the protocol — a priced rate feed is consulted
 * less and the median it feeds gets easier to move, and a priced snapshot
 * slows the thing that lets a new node join at all.
 *
 * If you run a standalone oracle or snapshot provider, this reads zero
 * permanently: those roles earn no protocol reward and charge nothing. They
 * are normally run alongside a node, where compensation comes from the node
 * reward pool instead.
 */
export async function getProviderEarnings(
  client: Client,
  id: string,
  keypair: Keypair,
): Promise<ProviderEarnings> {
  const challenge = await getProviderEarningsChallenge(client, id);
  const signature = await sign(keypair, earningsChallengeBytes(challenge));
  return client.call("getProviderEarnings", {
    id,
    nonce: challenge.nonce,
    signature: Buffer.from(signature).toString("base64"),
  });
}
