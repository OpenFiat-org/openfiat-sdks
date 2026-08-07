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
  toBase58,
  trade,
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

/**
 * The devnet USDT mint, which the node's display table names — so an
 * advertisement created with it comes back carrying `asset_symbol:
 * "USDT"` and the assertions below can tell resolution working from
 * resolution silently returning null for everything.
 */
const USDT_MINT = "C4rSGhdxWhSFQuFcAxQti1JvBxriwHJoHtJjfhs5p24Y";

/**
 * A real address (base58, 32 bytes) that no build names: Circle's own
 * devnet USDC, which this deployment deliberately does not settle in. It
 * is here to prove the null case is an address with no nickname rather
 * than a rejection.
 */
const UNNAMED_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

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
      provider: toBase58(peerId),
      provider_public_key: toBase58(keypair.publicKey),
      endpoints: ["/ip4/127.0.0.1/udp/4001/quic-v1"],
      supported_ofs: [1500, 7000],
      region: "Kenya",
      capabilities: ["USDC/KES"],
      branding: null,
      pricing: null,
      payout_wallet: null,
      timestamp: Date.now(),
    };
    const serviceId = await providers.sendProviderRegister(client, registration, keypair);
    expect(serviceId).toBe("vitest-oracle-1");

    const record = await providers.getProvider(client, serviceId);
    expect(record?.provider_public_key).toEqual(toBase58(keypair.publicKey));

    const now = Date.now();
    const publish: OraclePublish = {
      id: "vitest-usdc-kes",
      provider: toBase58(peerId),
      provider_public_key: toBase58(keypair.publicKey),
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
      merchant: toBase58(peerIdFromPublicKey(merchant.publicKey)),
      merchant_public_key: toBase58(merchant.publicKey),
      asset_mint: USDT_MINT,
      direction: "Sell",
      fiat_currency: "KES",
      min_trade: { base_units: 1_000, decimals: 2 },
      max_trade: { base_units: 50_000, decimals: 2 },
      initial_liquidity: { base_units: 200_000, decimals: 2 },
      pricing: { Fixed: { price: { base_units: 12_950, decimals: 2 } } },
      payment_methods: ["builtin:mpesa-kenya"],
      timestamp: Date.now(),
    };
    const adId = await advertisements.sendAdvertisementCreate(client, create, merchant);
    expect(adId).toBe("vitest-trading-bot-ad");

    const request: ReservationRequest = {
      id: "vitest-trading-bot-reservation",
      advertisement_id: adId,
      requester: toBase58(peerIdFromPublicKey(bot.publicKey)),
      requester_public_key: toBase58(bot.publicKey),
      amount: { base_units: 5_000, decimals: 2 },
      // The advertised fixed price, exactly. A reservation records the
      // number the taker agreed to, and the node refuses one that does not
      // follow from what the merchant signed rather than quietly
      // substituting its own.
      agreed_price: { base_units: 12_950, decimals: 2 },
      // Fixed pricing derives from no oracle, and a mid supplied here
      // would be refused alongside it.
      agreed_mid: null,
      timestamp: Date.now(),
    };
    const reservationId = await reservations.sendReservationRequest(client, request, bot);
    expect(reservationId).toBe("vitest-trading-bot-reservation");

    const reservation = await reservations.getReservation(client, reservationId);
    expect(reservation?.state).toBe("EscrowLocked");
  });

  // What replaced `asset: "USDT"`. The record carries the mint the buyer
  // will actually be paid in, and the name comes back from the node
  // beside it — never from the merchant, and never from a table in this
  // SDK, which is why there is no assertion here that any local lookup
  // agrees with anything.
  it("names an advertisement's asset by mint and reads the symbol back from the node", async () => {
    const merchant = await generateKeypair();
    const merchantId = toBase58(peerIdFromPublicKey(merchant.publicKey));

    const create = (id: string, mint: string): AdvertisementCreate => ({
      id,
      merchant: merchantId,
      merchant_public_key: toBase58(merchant.publicKey),
      asset_mint: mint,
      direction: "Sell",
      fiat_currency: "KES",
      min_trade: { base_units: 1_000, decimals: 2 },
      max_trade: { base_units: 50_000, decimals: 2 },
      initial_liquidity: { base_units: 200_000, decimals: 2 },
      pricing: { Fixed: { price: { base_units: 12_950, decimals: 2 } } },
      payment_methods: ["builtin:mpesa-kenya"],
      timestamp: Date.now(),
    });

    const namedId = await advertisements.sendAdvertisementCreate(
      client,
      create("vitest-mint-named-ad", USDT_MINT),
      merchant,
    );
    const named = await advertisements.getAdvertisement(client, namedId);
    expect(named?.asset_mint).toBe(USDT_MINT);
    expect(named?.asset_symbol).toBe("USDT");

    // An address nobody has named is not an error. It comes back whole,
    // with no nickname, and a caller shows the address — which is
    // unhelpful and true rather than helpful and false.
    const unnamedId = await advertisements.sendAdvertisementCreate(
      client,
      create("vitest-mint-unnamed-ad", UNNAMED_MINT),
      merchant,
    );
    const unnamed = await advertisements.getAdvertisement(client, unnamedId);
    expect(unnamed?.asset_mint).toBe(UNNAMED_MINT);
    expect(unnamed?.asset_symbol).toBeNull();

    // A ticker is not an address, and the node refuses it at decode
    // rather than storing it and letting a buyer read it. This is the
    // exact value the old `asset` field accepted from anyone.
    await expect(
      advertisements.sendAdvertisementCreate(
        client,
        create("vitest-mint-ticker-ad", "USDT"),
        merchant,
      ),
    ).rejects.toThrow();
    expect(await advertisements.getAdvertisement(client, "vitest-mint-ticker-ad")).toBeNull();
  });

  // The trade graph, against a real node: the public reads no longer name
  // a party, and the wallet-proof reads do. Both halves matter — a
  // redaction with no way to read your own trades back is a broken SDK,
  // and a `getMy*` binding that signs the wrong bytes fails as an opaque
  // signature error rather than as anything a caller can act on.
  it("redacts the public reservation read and answers the requester's own in full", async () => {
    const merchant = await generateKeypair();
    const bot = await generateKeypair();
    const botId = toBase58(peerIdFromPublicKey(bot.publicKey));

    const create: AdvertisementCreate = {
      id: "vitest-redaction-ad",
      merchant: toBase58(peerIdFromPublicKey(merchant.publicKey)),
      merchant_public_key: toBase58(merchant.publicKey),
      asset_mint: USDT_MINT,
      direction: "Sell",
      fiat_currency: "KES",
      min_trade: { base_units: 1_000, decimals: 2 },
      max_trade: { base_units: 50_000, decimals: 2 },
      initial_liquidity: { base_units: 200_000, decimals: 2 },
      pricing: { Fixed: { price: { base_units: 12_950, decimals: 2 } } },
      payment_methods: ["builtin:mpesa-kenya"],
      timestamp: Date.now(),
    };
    const adId = await advertisements.sendAdvertisementCreate(client, create, merchant);

    const request: ReservationRequest = {
      id: "vitest-redaction-reservation",
      advertisement_id: adId,
      requester: botId,
      requester_public_key: toBase58(bot.publicKey),
      amount: { base_units: 5_000, decimals: 2 },
      // The advertised fixed price, exactly. A reservation records the
      // number the taker agreed to, and the node refuses one that does not
      // follow from what the merchant signed rather than quietly
      // substituting its own.
      agreed_price: { base_units: 12_950, decimals: 2 },
      // Fixed pricing derives from no oracle, and a mid supplied here
      // would be refused alongside it.
      agreed_mid: null,
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

  // The join, which was the way around all of the above: a trade embeds
  // the reservation and the settlement whole, so a redaction that stopped
  // at the three underlying reads left the same graph one method along.
  it("redacts the trade join and answers the requester's own trades in full", async () => {
    const merchant = await generateKeypair();
    const bot = await generateKeypair();
    const botId = toBase58(peerIdFromPublicKey(bot.publicKey));

    const adId = await advertisements.sendAdvertisementCreate(
      client,
      {
        id: "vitest-trade-redaction-ad",
        merchant: toBase58(peerIdFromPublicKey(merchant.publicKey)),
        merchant_public_key: toBase58(merchant.publicKey),
        asset_mint: USDT_MINT,
        direction: "Sell",
        fiat_currency: "KES",
        min_trade: { base_units: 1_000, decimals: 2 },
        max_trade: { base_units: 50_000, decimals: 2 },
        initial_liquidity: { base_units: 200_000, decimals: 2 },
        pricing: { Fixed: { price: { base_units: 12_950, decimals: 2 } } },
        payment_methods: ["builtin:mpesa-kenya"],
        timestamp: Date.now(),
      },
      merchant,
    );
    const reservationId = await reservations.sendReservationRequest(
      client,
      {
        id: "vitest-trade-redaction-reservation",
        advertisement_id: adId,
        requester: botId,
        requester_public_key: toBase58(bot.publicKey),
        amount: { base_units: 5_000, decimals: 2 },
        agreed_price: { base_units: 12_950, decimals: 2 },
        agreed_mid: null,
        timestamp: Date.now(),
      },
      bot,
    );

    // A trade is keyed by its reservation id, and it exists as soon as
    // the reservation does — before any settlement, when the requester
    // is its only party.
    const publicOne = await trade.getTrade(client, reservationId);
    expect(publicOne?.reservation.id).toBe(reservationId);
    expect(publicOne?.settlement).toBeNull();
    expect(publicOne?.status).toBe("EscrowLocked");
    expect(publicOne?.reservation).not.toHaveProperty("requester");
    // Asserted on the raw JSON too: the type would happily fail to
    // mention a field the node still sends, which is exactly how this
    // hole survived being closed everywhere else.
    const publicAll = await trade.getTrades(client);
    expect(publicAll.some((t) => t.reservation.id === reservationId)).toBe(true);
    expect(JSON.stringify(publicAll)).not.toContain("requester");

    // The requester, proving their wallet, reads the join whole.
    const mine = await trade.getMyTrades(client, bot);
    const own = mine.find((t) => t.reservation.id === reservationId);
    expect(own?.reservation.requester).toEqual(botId);

    // The status the public read derives and the one this SDK derives
    // from the party's own copy must be the same value — that is what
    // keeps `tradeStatus` from drifting away from the node's rule, since
    // `getMyTrades` sends no status of its own.
    expect(own && trade.tradeStatus(own)).toBe(publicOne?.status);

    // A proof opens the prover's own trades and nothing else — a wallet
    // with none gets an empty list, not the network's.
    //
    // The merchant is that wallet here, and deliberately so: party means
    // the reservation's requester or a side of the settlement, and a
    // settlement does not exist yet. So the merchant whose liquidity is
    // locked by this very reservation cannot read it back through any
    // authenticated method until settlement starts. That is a gap in the
    // node's filter rather than in this binding — recorded here because a
    // merchant client will hit it, and an empty list looks identical to
    // a working call.
    await expect(trade.getMyTrades(client, merchant)).resolves.toEqual([]);
  });

  // The order book read, against a real node. The stubbed tests prove the
  // SDK sends the right request and hands the cursor back untouched; only
  // a node can prove the other half — that the narrowing actually happens
  // there, and that following its cursor across pages returns every
  // matching row exactly once.
  it("narrows and pages the order book on the node", async () => {
    const merchant = await generateKeypair();
    const merchantId = toBase58(peerIdFromPublicKey(merchant.publicKey));
    // A currency no other test in this file publishes against, so the
    // assertions below are about these three advertisements and not about
    // whatever else this shared node happens to be holding.
    const currency = "UGX";
    const ids = ["vitest-page-ad-1", "vitest-page-ad-2", "vitest-page-ad-3"];

    for (const id of ids) {
      await advertisements.sendAdvertisementCreate(
        client,
        {
          id,
          merchant: merchantId,
          merchant_public_key: toBase58(merchant.publicKey),
          asset_mint: USDT_MINT,
          direction: "Sell",
          fiat_currency: currency,
          min_trade: { base_units: 1_000, decimals: 2 },
          max_trade: { base_units: 50_000, decimals: 2 },
          initial_liquidity: { base_units: 200_000, decimals: 2 },
          pricing: { Fixed: { price: { base_units: 12_950, decimals: 2 } } },
          payment_methods: ["builtin:mpesa-kenya"],
          timestamp: Date.now(),
        },
        merchant,
      );
    }

    // The filter is honoured by the node, not by this SDK: every other
    // advertisement these tests published is quoted in KES and none of
    // them come back.
    const filter = { fiat_currency: currency };
    const first = await advertisements.getAdvertisements(client, { filter, page: { limit: 2 } });
    expect(first.advertisements.map((a) => a.fiat_currency)).toEqual([currency, currency]);
    expect(first.next_cursor).not.toBeNull();

    // The cursor goes back exactly as it arrived — assigned across, not
    // converted, and certainly not derived from the last row. That
    // derivation is the disagreement about ordering the cursor exists to
    // make impossible.
    const second = await advertisements.getAdvertisements(client, {
      filter,
      page: { limit: 2, after: first.next_cursor },
    });
    expect(second.advertisements).toHaveLength(1);
    expect(second.next_cursor).toBeNull();

    const walked = [...first.advertisements, ...second.advertisements].map((a) => a.id);
    expect([...walked].sort()).toEqual([...ids].sort());

    // And the same walk driven by the helper, which must reach the same
    // set — one row twice or one row missing is exactly the failure mode
    // an offset-based page has and this one does not.
    const iterated: string[] = [];
    for await (const advertisement of advertisements.eachAdvertisement(client, {
      filter,
      page: { limit: 2 },
    })) {
      iterated.push(advertisement.id);
    }
    expect(iterated.sort()).toEqual([...ids].sort());

    // An amount inside these advertisements' limits finds them; the same
    // number at another scale finds nothing at all, rather than being
    // rescaled into a question the caller did not ask. A caller who sends
    // "50" against a book quoted in cents gets an empty book, and this is
    // the reason.
    const inRange = await advertisements.getAdvertisements(client, {
      filter: { ...filter, amount: { base_units: 5_000, decimals: 2 } },
    });
    expect(inRange.advertisements.length).toBe(3);
    const wrongScale = await advertisements.getAdvertisements(client, {
      filter: { ...filter, amount: { base_units: 50, decimals: 0 } },
    });
    expect(wrongScale.advertisements).toEqual([]);
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
    const merchantId = toBase58(peerIdFromPublicKey(merchant.publicKey));

    const create: AdvertisementCreate = {
      id: "vitest-lifecycle-ad",
      merchant: merchantId,
      merchant_public_key: toBase58(merchant.publicKey),
      asset_mint: USDT_MINT,
      direction: "Sell",
      fiat_currency: "KES",
      min_trade: { base_units: 1_000, decimals: 2 },
      max_trade: { base_units: 50_000, decimals: 2 },
      initial_liquidity: { base_units: 200_000, decimals: 2 },
      pricing: { Fixed: { price: { base_units: 12_950, decimals: 2 } } },
      payment_methods: ["builtin:mpesa-kenya"],
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
      advertisements.sendAdvertisementStatusSet(
        client,
        { id: adId, merchant: merchantId, status: "Disabled", timestamp: Date.now() },
        impostor,
      ),
    ).rejects.toThrow();
    expect((await advertisements.getAdvertisement(client, adId))?.status).toBe("Active");

    await advertisements.sendAdvertisementStatusSet(
      client,
      { id: adId, merchant: merchantId, status: "Disabled", timestamp: Date.now() },
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
        provider: toBase58(providerId),
        provider_public_key: toBase58(provider.publicKey),
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
        branding: null,
        pricing: null,
        payout_wallet: null,
        timestamp: Date.now(),
      },
      provider,
    );

    const update: SubscriptionUpdate = {
      wallet: toBase58(walletId),
      wallet_public_key: toBase58(wallet.publicKey),
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
      provider: toBase58(providerId),
      provider_public_key: toBase58(provider.publicKey),
      recipient_wallet: toBase58(walletId),
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
