import type { Client } from "../client.js";
import { type Keypair, sign } from "../crypto.js";
import {
  toBase58,
  type DeliveryReceipt,
  type DeliveryReport,
  type SignedDeliveryReport,
  type SignedSubscriptionUpdate,
  type Subscription,
  type SubscriptionUpdate,
} from "../types.js";

/** Base64-encodes a peer ID the same way `WalletParams` expects it on the wire. */
function encodePeerId(peerId: Uint8Array): string {
  return Buffer.from(peerId).toString("base64");
}

export async function getSubscription(client: Client, wallet: Uint8Array): Promise<Subscription | null> {
  return client.call("getSubscription", { wallet: encodePeerId(wallet) });
}

export async function getDeliveryReceipt(client: Client, id: string): Promise<DeliveryReceipt | null> {
  return client.call("getDeliveryReceipt", { id });
}

export async function getDeliveryReceiptsByWallet(
  client: Client,
  wallet: Uint8Array,
): Promise<DeliveryReceipt[]> {
  return client.call("getDeliveryReceiptsByWallet", { wallet: encodePeerId(wallet) });
}

/** §11: publish this wallet's own notification subscription preferences. */
export async function sendSubscriptionUpdate(
  client: Client,
  update: SubscriptionUpdate,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(update));
  const signature = await sign(keypair, bytes);
  const signed: SignedSubscriptionUpdate = { update, signature: toBase58(signature) };
  return client.sendSigned("sendSubscriptionUpdate", signed);
}

/**
 * A provider reports the outcome of one delivery attempt — `keypair`
 * must already be registered as a Notification Provider (see
 * {@link providers.sendProviderRegister}) or the node will reject it.
 */
export async function sendDeliveryReport(
  client: Client,
  report: DeliveryReport,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(report));
  const signature = await sign(keypair, bytes);
  const signed: SignedDeliveryReport = { report, signature: toBase58(signature) };
  return client.sendSigned("sendDeliveryReport", signed);
}
