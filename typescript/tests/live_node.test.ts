/**
 * Proves the SDK's transport, typed methods, and wallet signing against
 * a real running node. Requires `OPENFIAT_NODE_URL` to point at one —
 * see `examples/oracle_provider.ts`'s own doc comment for how to start
 * one locally. Skipped (not failed) when unset, since most local/CI
 * runs of `pnpm test` don't have a node handy; the dedicated CI job that
 * does start one sets this variable (see `.github/workflows/ci.yml`).
 */
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  Client,
  chain,
  generateKeypair,
  node,
  oracles,
  peerIdFromPublicKey,
  providers,
  toBytes,
  type OraclePublish,
  type Registration,
} from "../src/index.js";

const endpoint = process.env.OPENFIAT_NODE_URL;

describe.skipIf(!endpoint)("against a real node", () => {
  const client = new Client({ endpoint: endpoint ?? "", timeoutMs: 10_000 });

  it("round-trips getVersion and getHealth", async () => {
    expect(await node.getVersion(client)).not.toBe("");
    expect(await node.getHealth(client)).toBe("ok");
  });

  it("registers as an oracle provider and publishes a verifiable rate", async () => {
    const keypair = await generateKeypair();
    const peerId = peerIdFromPublicKey(keypair.publicKey);

    const registration: Registration = {
      service_id: "vitest-oracle-1",
      service_type: { MarketData: "FxOracle" },
      provider: toBytes(peerId),
      provider_public_key: toBytes(keypair.publicKey),
      endpoints: ["/ip4/127.0.0.1/udp/4001/quic-v1"],
      supported_ofs: [1500, 7000],
      region: "Kenya",
      capabilities: ["USDC/KES"],
      pricing: null,
      timestamp: Date.now(),
    };
    const serviceId = await providers.sendProviderRegister(client, registration, keypair);
    expect(serviceId).toBe("vitest-oracle-1");

    const record = await providers.getProvider(client, serviceId);
    expect(record?.provider_public_key).toEqual(toBytes(keypair.publicKey));

    const now = Date.now();
    const publish: OraclePublish = {
      id: "vitest-usdc-kes",
      provider: toBytes(peerId),
      provider_public_key: toBytes(keypair.publicKey),
      data: { ExchangeRate: { base: "USDC", quote: "KES", rate: 129.52 } },
      version: 1,
      timestamp: now,
      expires_at: now + 60_000,
    };
    const oracleId = await oracles.sendOraclePublish(client, publish, keypair);
    expect(oracleId).toBe("vitest-usdc-kes");

    const median = await oracles.getMedianExchangeRate(client, "USDC", "KES");
    expect(median).toBe(129.52);
  });

  it("surfaces an unknown method as a JSON-RPC error", async () => {
    await expect(client.call("doesNotExist", {})).rejects.toMatchObject({
      name: "JsonRpcError",
      code: -32601,
    });
  });

  it("reports GossipOnly with no blockhash on a fresh node", async () => {
    const status = await chain.getChainStatus(client);
    expect(status.mode).toBe("GossipOnly");
    expect(status.blockhash).toBeNull();
  });

  it("builds, signs, and submits a real Solana transaction", async () => {
    const payer = Keypair.generate();
    const recipient = Keypair.generate().publicKey;
    // The node has no blockhash to hand out yet (same reason as the
    // status check above) — a syntactically valid stand-in is enough to
    // prove the sign-and-submit round trip, same as the standalone
    // example's own fallback.
    const blockhash = Keypair.generate().publicKey.toBase58();

    const transaction = new Transaction({
      feePayer: payer.publicKey,
      blockhash,
      lastValidBlockHeight: 0,
    }).add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 1_000 }));
    transaction.sign(payer);

    await expect(chain.sendTransaction(client, new Uint8Array(transaction.serialize()))).resolves.toBeUndefined();
  });
});
