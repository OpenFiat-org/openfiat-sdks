/**
 * A complete Oracle Provider (OFS-7000): register with a node's Service
 * Registry, then publish a signed exchange-rate record.
 *
 * Run against a local node with `pnpm tsx examples/oracle_provider.ts`.
 * By default it targets `http://localhost:7080` — start one with
 * `CLI_HTTP_ADDR=127.0.0.1:7080 cargo run -p openfiat-cli` from
 * `openfiat-core`.
 */
import {
  Client,
  generateKeypair,
  oracles,
  peerIdFromPublicKey,
  providers,
  toBytes,
  type OraclePublish,
  type Registration,
} from "../src/index.js";

async function main() {
  const endpoint = process.env.OPENFIAT_NODE_URL ?? "http://localhost:7080";
  const client = new Client({ endpoint, timeoutMs: 30_000 });

  // In production, load a persistent identity instead — see
  // loadWalletFile from "@openfiat/sdk/node" (../src/node.js here).
  const keypair = await generateKeypair();
  const peerId = peerIdFromPublicKey(keypair.publicKey);

  console.log(`registering as an Oracle Provider (${JSON.stringify(toBytes(peerId))})...`);
  const registration: Registration = {
    service_id: "example-oracle-1-ts",
    service_type: { MarketData: "FxOracle" },
    provider: toBytes(peerId),
    provider_public_key: toBytes(keypair.publicKey),
    endpoints: ["/ip4/127.0.0.1/udp/4001/quic-v1"],
    supported_ofs: [1500, 7000],
    region: "Kenya",
    capabilities: ["USDC/KES"],
    pricing: null,
    payout_wallet: null,
    timestamp: Date.now(),
  };
  const serviceId = await providers.sendProviderRegister(client, registration, keypair);
  console.log(`registered as service ${serviceId}`);

  console.log("publishing USDC/KES exchange rate...");
  const now = Date.now();
  const publish: OraclePublish = {
    id: "usdc-kes-ts",
    provider: toBytes(peerId),
    provider_public_key: toBytes(keypair.publicKey),
    data: { ExchangeRate: { base: "USDC", quote: "KES", rate: 129.52 } },
    version: 1,
    timestamp: now,
    expires_at: now + 60_000,
  };
  const oracleId = await oracles.sendOraclePublish(client, publish, keypair);
  console.log(`published oracle record ${oracleId}`);

  const median = await oracles.getMedianExchangeRate(client, "USDC", "KES");
  console.log(`median USDC/KES rate across all providers: ${median}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
