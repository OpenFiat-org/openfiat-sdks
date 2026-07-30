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
  advertisements,
  chain,
  disputes,
  generateKeypair,
  node,
  notifications,
  oracles,
  peerIdFromPublicKey,
  providers,
  reservations,
  settlement,
  sign,
  toBytes,
  wallet as walletAuth,
  type AdvertisementCreate,
  type DeliveryReport,
  type OraclePublish,
  type PricingModel,
  type Registration,
  type ReservationRequest,
  type SubscriptionUpdate,
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
      payout_wallet: null,
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

  // The same flow examples/trading_bot.ts walks through — this is what
  // keeps that quickstart's code from silently drifting out of date.
  it("locks escrow on a trading bot's reservation against a published advertisement", async () => {
    const merchant = await generateKeypair();
    const bot = await generateKeypair();

    const create: AdvertisementCreate = {
      id: "vitest-trading-bot-ad",
      merchant: toBytes(peerIdFromPublicKey(merchant.publicKey)),
      merchant_public_key: toBytes(merchant.publicKey),
      asset: "USDT",
      direction: "Sell",
      fiat_currency: "KES",
      min_trade: { base_units: 1_000, decimals: 2 },
      max_trade: { base_units: 50_000, decimals: 2 },
      initial_liquidity: { base_units: 200_000, decimals: 2 },
      pricing: { Fixed: { price: { base_units: 12_950, decimals: 2 } } },
      payment_methods: ["M-Pesa"],
      timestamp: Date.now(),
    };
    const adId = await advertisements.sendAdvertisementCreate(client, create, merchant);
    expect(adId).toBe("vitest-trading-bot-ad");

    const request: ReservationRequest = {
      id: "vitest-trading-bot-reservation",
      advertisement_id: adId,
      requester: toBytes(peerIdFromPublicKey(bot.publicKey)),
      requester_public_key: toBytes(bot.publicKey),
      amount: { base_units: 5_000, decimals: 2 },
      timestamp: Date.now(),
    };
    const reservationId = await reservations.sendReservationRequest(client, request, bot);
    expect(reservationId).toBe("vitest-trading-bot-reservation");

    const reservation = await reservations.getReservation(client, reservationId);
    expect(reservation?.state).toBe("EscrowLocked");
  });

  // The trade graph, against a real node: the public reads no longer name
  // a party, and the wallet-proof reads do. Both halves matter — a
  // redaction with no way to read your own trades back is a broken SDK,
  // and a `getMy*` binding that signs the wrong bytes fails as an opaque
  // signature error rather than as anything a caller can act on.
  it("redacts the public reservation read and answers the requester's own in full", async () => {
    const merchant = await generateKeypair();
    const bot = await generateKeypair();
    const botId = toBytes(peerIdFromPublicKey(bot.publicKey));

    const create: AdvertisementCreate = {
      id: "vitest-redaction-ad",
      merchant: toBytes(peerIdFromPublicKey(merchant.publicKey)),
      merchant_public_key: toBytes(merchant.publicKey),
      asset: "USDT",
      direction: "Sell",
      fiat_currency: "KES",
      min_trade: { base_units: 1_000, decimals: 2 },
      max_trade: { base_units: 50_000, decimals: 2 },
      initial_liquidity: { base_units: 200_000, decimals: 2 },
      pricing: { Fixed: { price: { base_units: 12_950, decimals: 2 } } },
      payment_methods: ["M-Pesa"],
      timestamp: Date.now(),
    };
    const adId = await advertisements.sendAdvertisementCreate(client, create, merchant);

    const request: ReservationRequest = {
      id: "vitest-redaction-reservation",
      advertisement_id: adId,
      requester: botId,
      requester_public_key: toBytes(bot.publicKey),
      amount: { base_units: 5_000, decimals: 2 },
      timestamp: Date.now(),
    };
    const reservationId = await reservations.sendReservationRequest(client, request, bot);

    // The public read keeps the offer and drops the requester. Asserted
    // on the raw JSON as well as the typed shape, because the type would
    // happily describe a field the node still sends.
    const publicOne = await reservations.getReservation(client, reservationId);
    expect(publicOne?.advertisement_id).toBe(adId);
    expect(publicOne).not.toHaveProperty("requester");
    const publicAll = await reservations.getReservations(client);
    expect(JSON.stringify(publicAll)).not.toContain("requester");

    // The requester, proving their wallet, reads the same record whole.
    const mine = await reservations.getMyReservations(client, bot);
    const own = mine.find((r) => r.id === reservationId);
    expect(own?.requester).toEqual(botId);

    // A fresh proof each time: the nonce the last call spent is gone, so
    // this also proves the SDK is not caching one.
    await expect(settlement.getMySettlements(client, bot)).resolves.toEqual([]);
    await expect(disputes.getMyDisputes(client, bot)).resolves.toEqual([]);
  });

  it("refuses a wallet proof signed by someone else's key", async () => {
    const bot = await generateKeypair();
    const stranger = await generateKeypair();

    const challenge = await walletAuth.getWalletChallenge(
      client,
      peerIdFromPublicKey(bot.publicKey),
    );
    // The stranger signs honestly, with their own key, and asks about
    // somebody else's wallet. The node refuses rather than quietly
    // narrowing the answer to the stranger's own (empty) history — a
    // filtering implementation looks identical in every passing test
    // until a refactor drops the filter.
    const signature = await sign(
      stranger,
      walletAuth.walletChallengeBytes(challenge, reservations.CHALLENGE_DOMAIN),
    );
    await expect(
      client.call("getMyReservations", {
        wallet: challenge.subject,
        public_key: Buffer.from(stranger.publicKey).toString("base64"),
        nonce: challenge.nonce,
        signature: Buffer.from(signature).toString("base64"),
      }),
    ).rejects.toThrow();
  });

  // The rest of the merchant's own lifecycle, against a real node. The
  // builders for these two were added with only a capturing mock behind
  // them — that proves the bytes are right, but not that a node accepts
  // them, applies them, and refuses the forgery. This is the half a mock
  // structurally cannot cover.
  it("reprices and then retires a published advertisement", async () => {
    const merchant = await generateKeypair();
    const merchantId = toBytes(peerIdFromPublicKey(merchant.publicKey));

    const create: AdvertisementCreate = {
      id: "vitest-lifecycle-ad",
      merchant: merchantId,
      merchant_public_key: toBytes(merchant.publicKey),
      asset: "USDT",
      direction: "Sell",
      fiat_currency: "KES",
      min_trade: { base_units: 1_000, decimals: 2 },
      max_trade: { base_units: 50_000, decimals: 2 },
      initial_liquidity: { base_units: 200_000, decimals: 2 },
      pricing: { Fixed: { price: { base_units: 12_950, decimals: 2 } } },
      payment_methods: ["M-Pesa"],
      timestamp: Date.now(),
    };
    const adId = await advertisements.sendAdvertisementCreate(client, create, merchant);

    const repriced: PricingModel = { Fixed: { price: { base_units: 13_100, decimals: 2 } } };
    await advertisements.sendAdvertisementPriceUpdate(
      client,
      { id: adId, merchant: merchantId, pricing: repriced, timestamp: Date.now() },
      merchant,
    );
    // Repricing keeps the record's identity — same ID, and so every
    // reservation, dispute and reputation entry pointing at it survives.
    // That is the whole reason this is not "disable and recreate".
    const updated = await advertisements.getAdvertisement(client, adId);
    expect(updated?.id).toBe(adId);
    expect(updated?.pricing).toEqual(repriced);
    expect(updated?.status).toBe("Active");

    // Another identity naming this merchant is refused: the node checks the
    // signature against the key on the advertisement, not against the
    // merchant the event claims to be from.
    const impostor = await generateKeypair();
    await expect(
      advertisements.sendAdvertisementDisable(
        client,
        { id: adId, merchant: merchantId, timestamp: Date.now() },
        impostor,
      ),
    ).rejects.toThrow();
    expect((await advertisements.getAdvertisement(client, adId))?.status).toBe("Active");

    await advertisements.sendAdvertisementDisable(
      client,
      { id: adId, merchant: merchantId, timestamp: Date.now() },
      merchant,
    );
    // Disabled, not deleted: still readable, still carrying the price the
    // update put there, so anything already referencing it resolves against
    // a record that exists.
    const disabled = await advertisements.getAdvertisement(client, adId);
    expect(disabled?.status).toBe("Disabled");
    expect(disabled?.pricing).toEqual(repriced);
  });

  // The same flow examples/notification_provider.ts walks through.
  it("reports a notification provider's delivery back for the subscribed wallet", async () => {
    const provider = await generateKeypair();
    const wallet = await generateKeypair();
    const providerId = peerIdFromPublicKey(provider.publicKey);
    const walletId = peerIdFromPublicKey(wallet.publicKey);
    const serviceId = "vitest-notification-provider-1";

    await providers.sendProviderRegister(
      client,
      {
        service_id: serviceId,
        service_type: { Notifications: "Webhook" },
        provider: toBytes(providerId),
        provider_public_key: toBytes(provider.publicKey),
        // Loopback, not `example.invalid`. A node now refuses to register
        // an endpoint in an RFC 2606/6761 reserved domain at all: a signed
        // registration replicates to every node and is offered to users as
        // live infrastructure, so an address that can never resolve is not
        // a harmless placeholder — it is a fabricated service nobody can
        // delete. `.localhost` stays allowed, because it resolves and means
        // exactly what it says.
        endpoints: ["http://localhost:7080/webhook"],
        supported_ofs: [1500, 6000],
        region: null,
        capabilities: ["Webhook"],
        pricing: null,
        payout_wallet: null,
        timestamp: Date.now(),
      },
      provider,
    );

    const update: SubscriptionUpdate = {
      wallet: toBytes(walletId),
      wallet_public_key: toBytes(wallet.publicKey),
      enabled_categories: ["Trading"],
      // Empty, but present. The node verifies the signature against a
      // re-serialization of this struct, so omitting the field makes the
      // bytes it hashes differ from the bytes signed here and the update
      // is rejected as INVALID_SIGNATURE — not as a missing field.
      destinations: [],
      timestamp: Date.now(),
    };
    await notifications.sendSubscriptionUpdate(client, update, wallet);

    // A registered provider, correctly signing, reporting a delivery for
    // a notification this node never dispatched. It is refused, and no
    // receipt is written.
    //
    // This used to succeed, and that was the bug: a provider's report is
    // self-attested, and its reputation and compensation depend on the
    // volume it claims. Accepting an arbitrary id let any registered
    // gateway manufacture evidence of work nobody asked it to do, or
    // report on traffic it was never routed. A report must now correspond
    // to a dispatch the receiving node witnessed itself.
    const report: DeliveryReport = {
      notification_id: "vitest-notification-1",
      service_id: serviceId,
      provider: toBytes(providerId),
      provider_public_key: toBytes(provider.publicKey),
      recipient_wallet: toBytes(walletId),
      trigger: "TradeCompleted",
      status: "Delivered",
      timestamp: Date.now(),
    };
    await expect(
      notifications.sendDeliveryReport(client, report, provider),
    ).rejects.toThrow(/RESOURCE_NOT_FOUND/);

    const receipts = await notifications.getDeliveryReceiptsByWallet(client, walletId);
    expect(receipts).toHaveLength(0);

    // The accepted path is deliberately not exercised here. It needs a
    // real dispatch, which needs a subscription carrying a destination
    // sealed to this gateway — and sealing is not exposed by this SDK
    // yet. Faking it by relaxing the node's check would delete the
    // property this test now protects.
  });
});
