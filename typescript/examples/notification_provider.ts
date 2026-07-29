/**
 * A minimal Notification Provider (OFS-6000): register with a node's
 * Service Registry, a wallet subscribes to a category, then the
 * provider reports a delivery.
 *
 * Run against a local node with `pnpm tsx examples/notification_provider.ts`.
 * By default it targets `http://localhost:7080` — start one with
 * `CLI_HTTP_ADDR=127.0.0.1:7080 cargo run -p openfiat-cli` from
 * `openfiat-core`.
 */
import {
  Client,
  generateKeypair,
  notifications,
  peerIdFromPublicKey,
  providers,
  toBytes,
  type DeliveryReport,
  type Registration,
  type SubscriptionUpdate,
} from "../src/index.js";

async function main() {
  const endpoint = process.env.OPENFIAT_NODE_URL ?? "http://localhost:7080";
  const client = new Client({ endpoint, timeoutMs: 30_000 });

  // In production, load a persistent identity instead — see
  // loadWalletFile from "@openfiat/sdk/node" (../src/node.js here).
  const provider = await generateKeypair();
  const wallet = await generateKeypair();
  const providerId = peerIdFromPublicKey(provider.publicKey);
  const walletId = peerIdFromPublicKey(wallet.publicKey);
  const serviceId = "example-notification-provider-1-ts";

  console.log(`registering as a Notification Provider (${JSON.stringify(toBytes(providerId))})...`);
  const registration: Registration = {
    service_id: serviceId,
    service_type: { Notifications: "Webhook" },
    provider: toBytes(providerId),
    provider_public_key: toBytes(provider.publicKey),
    endpoints: ["https://example.invalid/webhook"],
    supported_ofs: [1500, 6000],
    region: null,
    capabilities: ["Webhook"],
    pricing: null,
    timestamp: Date.now(),
  };
  await providers.sendProviderRegister(client, registration, provider);
  console.log(`registered as service ${serviceId}`);

  console.log("subscribing a wallet to Trading notifications...");
  const update: SubscriptionUpdate = {
    wallet: toBytes(walletId),
    wallet_public_key: toBytes(wallet.publicKey),
    enabled_categories: ["Trading"],
    timestamp: Date.now(),
  };
  await notifications.sendSubscriptionUpdate(client, update, wallet);

  console.log("reporting a delivered trade-completed notification...");
  const report: DeliveryReport = {
    notification_id: "example-notification-1-ts",
    service_id: serviceId,
    provider: toBytes(providerId),
    provider_public_key: toBytes(provider.publicKey),
    recipient_wallet: toBytes(walletId),
    trigger: "TradeCompleted",
    status: "Delivered",
    timestamp: Date.now(),
  };
  await notifications.sendDeliveryReport(client, report, provider);

  const receipts = await notifications.getDeliveryReceiptsByWallet(client, walletId);
  console.log(`delivery receipts for this wallet: ${receipts.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
