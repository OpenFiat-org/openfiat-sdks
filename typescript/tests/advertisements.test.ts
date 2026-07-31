import * as ed from "@noble/ed25519";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeBase58 } from "../src/base58.js";
import { Client } from "../src/client.js";
import { generateKeypair, peerIdFromPublicKey } from "../src/crypto.js";
import {
  eachAdvertisement,
  getAdvertisements,
  sendAdvertisementStatusSet,
  sendAdvertisementTermsUpdate,
  sendAdvertisementPriceUpdate,
} from "../src/methods/advertisements.js";
import {
  toBase58,
  type AdvertisementStatusSet,
  type AdvertisementTermsUpdate,
  type AdvertisementPage,
  type AdvertisementPriceUpdate,
  type AdvertisementView,
  type PriceQuote,
} from "../src/types.js";

/**
 * These two methods are the ones that were previously unreachable from any
 * client — a merchant could publish an ad but never disable or reprice it.
 * As with the provider lifecycle methods, the node verifies the signature
 * against the JSON of the inner struct, not the envelope, so these tests
 * decode the real request body and verify the real signature rather than
 * trusting the builder's own bookkeeping.
 */

type CapturedCall = { method: string; params: { data: string } };

function stubTransport(): { calls: CapturedCall[]; client: Client } {
  const calls: CapturedCall[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push({ method: body.method, params: body.params });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: null }),
    };
  });
  return {
    calls,
    client: new Client({
      endpoint: "http://localhost:7080",
      timeoutMs: 30_000,
    }),
  };
}

function onlyCall(calls: CapturedCall[]): CapturedCall {
  const call = calls[0];
  if (!call)
    throw new Error("expected exactly one captured RPC call, got none");
  return call;
}

function decodePayload(call: CapturedCall): Record<string, unknown> {
  return JSON.parse(Buffer.from(call.params.data, "base64").toString("utf8"));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("advertisement lifecycle methods", () => {
  it("sends a status set whose signature verifies over its JSON", async () => {
    const { calls, client } = stubTransport();
    const keypair = await generateKeypair();
    const set: AdvertisementStatusSet = {
      id: "ad-1",
      merchant: toBase58(peerIdFromPublicKey(keypair.publicKey)),
      status: "Vacation",
      timestamp: 1_785_326_039_513,
    };

    await sendAdvertisementStatusSet(client, set, keypair);

    expect(calls).toHaveLength(1);
    expect(onlyCall(calls).method).toBe("sendAdvertisementStatusSet");

    const payload = decodePayload(onlyCall(calls)) as {
      set: AdvertisementStatusSet;
      signature: string;
    };
    expect(payload.set).toEqual(set);

    // The node verifies over the JSON of the inner struct, not the envelope.
    const signedBytes = new TextEncoder().encode(JSON.stringify(set));
    await expect(
      ed.verifyAsync(
        decodeBase58(payload.signature),
        signedBytes,
        keypair.publicKey,
      ),
    ).resolves.toBe(true);
  });

  it("signs a status set with the caller's key, so another merchant's signature will not verify", async () => {
    const { calls, client } = stubTransport();
    const owner = await generateKeypair();
    const impostor = await generateKeypair();
    const set: AdvertisementStatusSet = {
      id: "ad-1",
      merchant: toBase58(peerIdFromPublicKey(owner.publicKey)),
      status: "Deleted",
      timestamp: 1_785_326_039_513,
    };

    // The impostor names the real merchant but can only sign with its own key.
    await sendAdvertisementStatusSet(client, set, impostor);

    const payload = decodePayload(onlyCall(calls)) as { signature: string };
    const signedBytes = new TextEncoder().encode(JSON.stringify(set));
    await expect(
      ed.verifyAsync(
        decodeBase58(payload.signature),
        signedBytes,
        owner.publicKey,
      ),
    ).resolves.toBe(false);
  });

  it("sends a price update whose signature verifies over the update JSON", async () => {
    const { calls, client } = stubTransport();
    const keypair = await generateKeypair();
    const update: AdvertisementPriceUpdate = {
      id: "ad-1",
      merchant: toBase58(peerIdFromPublicKey(keypair.publicKey)),
      pricing: { Fixed: { price: { base_units: 200, decimals: 2 } } },
      timestamp: 1_785_326_039_513,
    };

    await sendAdvertisementPriceUpdate(client, update, keypair);

    expect(calls).toHaveLength(1);
    expect(onlyCall(calls).method).toBe("sendAdvertisementPriceUpdate");

    const payload = decodePayload(onlyCall(calls)) as {
      update: AdvertisementPriceUpdate;
      signature: string;
    };
    expect(payload.update).toEqual(update);

    const signedBytes = new TextEncoder().encode(JSON.stringify(update));
    await expect(
      ed.verifyAsync(
        decodeBase58(payload.signature),
        signedBytes,
        keypair.publicKey,
      ),
    ).resolves.toBe(true);
  });

  it("signs a price update with the caller's key, so another merchant's signature will not verify", async () => {
    const { calls, client } = stubTransport();
    const owner = await generateKeypair();
    const impostor = await generateKeypair();
    const update: AdvertisementPriceUpdate = {
      id: "ad-1",
      merchant: toBase58(peerIdFromPublicKey(owner.publicKey)),
      pricing: { Fixed: { price: { base_units: 999_00, decimals: 2 } } },
      timestamp: 1_785_326_039_513,
    };

    await sendAdvertisementPriceUpdate(client, update, impostor);

    const payload = decodePayload(onlyCall(calls)) as { signature: string };
    const signedBytes = new TextEncoder().encode(JSON.stringify(update));
    await expect(
      ed.verifyAsync(
        decodeBase58(payload.signature),
        signedBytes,
        owner.publicKey,
      ),
    ).resolves.toBe(false);
  });

  /**
   * Switching a listing onto a floating model is the case this SDK could
   * not express at all: `PricingModel.Floating` was missing
   * `price_decimals`, so the payload decoded into nothing on the node and
   * came back as an invalid-params failure naming the event rather than the
   * field. Pinned here in the shape a node re-serializes and hashes, since
   * nothing in the fixed case hints the field exists.
   */
  it("carries price_decimals when repricing onto a floating model", async () => {
    const { calls, client } = stubTransport();
    const keypair = await generateKeypair();
    const update: AdvertisementPriceUpdate = {
      id: "ad-1",
      merchant: toBase58(peerIdFromPublicKey(keypair.publicKey)),
      pricing: {
        Floating: {
          oracle_provider: "any",
          premium_bps: 150,
          price_decimals: 2,
        },
      },
      timestamp: 1_785_326_039_513,
    };

    await sendAdvertisementPriceUpdate(client, update, keypair);

    const payload = decodePayload(onlyCall(calls)) as {
      update: AdvertisementPriceUpdate;
    };
    expect(payload.update.pricing).toEqual({
      Floating: { oracle_provider: "any", premium_bps: 150, price_decimals: 2 },
    });
    // `pricing` sits between `merchant` and `timestamp`, and the model is
    // externally tagged, because that is how `serde` writes the enum the
    // node reads back. The signature covers these bytes in this order.
    expect(Object.keys(payload.update)).toEqual([
      "id",
      "merchant",
      "pricing",
      "timestamp",
    ]);
  });
});

/**
 * The order book read, which changed shape: it answered with a bare array
 * of every advertisement on the network and now answers with one page and
 * a cursor.
 *
 * What these check is the contract that shape exists to enforce — that the
 * narrowing goes out in the request, and that the resume point comes back
 * from the node and is handed back untouched. Both are properties of what
 * the SDK *sends*, so a stubbed transport that records request bodies is
 * the right instrument; that a real node honours them is proved in
 * `live_node.test.ts`.
 */

type CapturedQuery = { method: string; params: Record<string, unknown> };

/** Answers each call with the next scripted page, recording every request. */
function stubPages(pages: AdvertisementPage[]): {
  calls: CapturedQuery[];
  client: Client;
} {
  const calls: CapturedQuery[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push({ method: body.method, params: body.params });
    const result = pages[calls.length - 1] ?? {
      advertisements: [],
      next_cursor: null,
    };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
    };
  });
  return {
    calls,
    client: new Client({
      endpoint: "http://localhost:7080",
      timeoutMs: 30_000,
    }),
  };
}

function row(id: string): AdvertisementView {
  return {
    id,
    merchant: "12D3KooWK9hQ7TwbfvFiaAxUbRFCkdhS7iEpAJDnewNL1anyREQ1",
    merchant_public_key: "ALLENLMtV1zEAHT3xpVryqcbdPCB8c9JhM1Jdbe5XHg5",
    asset_mint: "2bHPi5hA4zrmPAfrvLmEexg3KJjpTjNkUcxWnzUPeRRU",
    direction: "Sell",
    fiat_currency: "KES",
    min_trade: { base_units: 1_000, decimals: 2 },
    max_trade: { base_units: 50_000, decimals: 2 },
    available_liquidity: { base_units: 200_000, decimals: 2 },
    pricing: { Fixed: { price: { base_units: 12_950, decimals: 2 } } },
    payment_methods: ["M-Pesa"],
    status: "Active",
    created_at: 1_785_326_039_513,
    updated_at: 1_785_326_039_513,
    asset_symbol: "USDC",
    // A fixed advertisement, so the quote is the merchant's own number and
    // no oracle is consulted. Note the discriminant: `quote` is tagged on
    // `kind` while `pricing` directly above is externally tagged — the two
    // travel on the same row and do not share a shape.
    quote: { kind: "Fixed", price: { base_units: 12_950, decimals: 2 } },
  };
}

describe("reading the order book a page at a time", () => {
  it("asks for the first page of the whole active book when given no query", async () => {
    const { calls, client } = stubPages([
      { advertisements: [row("ad-1")], next_cursor: null },
    ]);

    const page = await getAdvertisements(client);

    expect(calls[0]?.method).toBe("getAdvertisements");
    // `{}`, not an omitted params key: the node reads both halves with
    // `#[serde(default)]`, and this is the call that existed before
    // filtering did.
    expect(calls[0]?.params).toEqual({});
    expect(page.advertisements.map((a) => a.id)).toEqual(["ad-1"]);
    expect(page.next_cursor).toBeNull();
  });

  it("sends the filter to the node instead of applying it to the reply", async () => {
    const { calls, client } = stubPages([
      { advertisements: [], next_cursor: null },
    ]);

    await getAdvertisements(client, {
      filter: {
        asset_mint: "2bHPi5hA4zrmPAfrvLmEexg3KJjpTjNkUcxWnzUPeRRU",
        fiat_currency: "kes",
        direction: "Sell",
        payment_method: "M-Pesa",
        amount: { base_units: 5_000, decimals: 2 },
      },
      page: { limit: 2 },
    });

    // Verbatim, `decimals` included. The node compares the amount at the
    // advertisement's own scale and matches nothing at another one, so an
    // SDK quietly restating it would turn a caller's mistake into an empty
    // book they could not explain.
    expect(calls[0]?.params).toEqual({
      filter: {
        asset_mint: "2bHPi5hA4zrmPAfrvLmEexg3KJjpTjNkUcxWnzUPeRRU",
        fiat_currency: "kes",
        direction: "Sell",
        payment_method: "M-Pesa",
        amount: { base_units: 5_000, decimals: 2 },
      },
      page: { limit: 2 },
    });
  });

  it("resumes from the cursor the node returned, verbatim", async () => {
    // The second page's rows sort *before* the first page's cursor, which
    // no id-derived resume point would ever produce. If the helper ever
    // starts computing its own `after` from the last row it saw, this
    // stops matching.
    const { calls, client } = stubPages([
      {
        advertisements: [row("ad-1"), row("ad-2")],
        next_cursor: "opaque-cursor-1",
      },
      { advertisements: [row("ad-3")], next_cursor: null },
    ]);

    const seen: string[] = [];
    for await (const advertisement of eachAdvertisement(client))
      seen.push(advertisement.id);

    expect(seen).toEqual(["ad-1", "ad-2", "ad-3"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.params).toEqual({ page: {} });
    expect(calls[1]?.params).toEqual({ page: { after: "opaque-cursor-1" } });
  });

  it("carries the filter and the limit onto every page", async () => {
    // A filter that travelled only on the first request would let the rest
    // of the book back in halfway down the scroll.
    const { calls, client } = stubPages([
      { advertisements: [row("ad-1")], next_cursor: "cursor-1" },
      { advertisements: [row("ad-2")], next_cursor: null },
    ]);

    const seen: string[] = [];
    for await (const advertisement of eachAdvertisement(client, {
      filter: { fiat_currency: "KES" },
      page: { limit: 1 },
    })) {
      seen.push(advertisement.id);
    }

    expect(seen).toEqual(["ad-1", "ad-2"]);
    expect(calls.map((c) => c.params)).toEqual([
      { filter: { fiat_currency: "KES" }, page: { limit: 1 } },
      {
        filter: { fiat_currency: "KES" },
        page: { limit: 1, after: "cursor-1" },
      },
    ]);
  });

  it("stops on a null cursor rather than on an empty page", async () => {
    // A full page does not prove another exists, so the node may hand back
    // a cursor with nothing behind it. Stopping on emptiness instead of on
    // the cursor would either loop forever here or, with the opposite
    // mistake, end the walk one page early.
    const { calls, client } = stubPages([
      { advertisements: [row("ad-1")], next_cursor: "cursor-1" },
      { advertisements: [], next_cursor: null },
    ]);

    const seen: string[] = [];
    for await (const advertisement of eachAdvertisement(client))
      seen.push(advertisement.id);

    expect(seen).toEqual(["ad-1"]);
    expect(calls).toHaveLength(2);
  });
});

describe("the price quote a node attaches to every advertisement", () => {
  /** What a client would render. Deliberately exhaustive with no default
   *  branch, so adding a fourth quote variant fails to compile here rather
   *  than falling through to whatever the last case happened to be. */
  function describeQuote(quote: PriceQuote): string {
    switch (quote.kind) {
      case "Fixed":
        return `${quote.price.base_units} fixed`;
      case "Floating":
        return `${quote.price.base_units} until ${quote.mid_expires_at}`;
      case "Unpriceable":
        return `no price: ${quote.reason}`;
    }
  }

  it("distinguishes a fixed price from a floating one that expires", async () => {
    // The distinction the tagging exists for. Both carry a `price` and a
    // client reading only that cannot tell which of the two promises it is
    // looking at — one holds until the merchant signs a new one, the other
    // may have moved by the time the reader commits to it.
    const floating: AdvertisementView = {
      ...row("ad-floating"),
      quote: {
        kind: "Floating",
        price: { base_units: 13_100, decimals: 2 },
        mid_rate: 129.5,
        premium_bps: 150,
        mid_expires_at: 1_785_326_099_513,
      },
    };
    const { client } = stubPages([
      { advertisements: [row("ad-fixed"), floating], next_cursor: null },
    ]);

    const page = await getAdvertisements(client, {});

    expect(page.advertisements.map((a) => describeQuote(a.quote))).toEqual([
      "12950 fixed",
      "13100 until 1785326099513",
    ]);
  });

  it("carries an unpriceable advertisement through with its reason, not as a zero", async () => {
    // An ad whose oracle feed has lapsed still exists and still has terms.
    // Reporting it as a price of zero would advertise it as free; dropping
    // it would hide a merchant's book from them. `premium_bps` survives so
    // the terms remain displayable while the number is honestly absent.
    const lapsed: AdvertisementView = {
      ...row("ad-lapsed"),
      quote: {
        kind: "Unpriceable",
        reason: "StaleOracleData",
        premium_bps: 150,
      },
    };
    const { client } = stubPages([
      { advertisements: [lapsed], next_cursor: null },
    ]);

    const page = await getAdvertisements(client, {});
    const only = page.advertisements[0];
    if (!only)
      throw new Error("the stubbed page carries exactly one advertisement");
    const quote = only.quote;

    expect(describeQuote(quote)).toBe("no price: StaleOracleData");
    // The type is what stops a caller reading `price` off this at all:
    // narrowing is required before the field exists.
    expect("price" in quote).toBe(false);
  });

  it("sends a terms update whose payment methods survive the round trip in order", async () => {
    // Order matters: the merchant signed a specific array, and a builder
    // that sorted or deduplicated it would change what the node verifies.
    const { calls, client } = stubTransport();
    const keypair = await generateKeypair();
    const update: AdvertisementTermsUpdate = {
      id: "ad-1",
      merchant: toBase58(peerIdFromPublicKey(keypair.publicKey)),
      min_trade: { base_units: 5_000_000, decimals: 6 },
      max_trade: { base_units: 500_000_000, decimals: 6 },
      payment_methods: ["M-Pesa", "Bank Transfer"],
      timestamp: 1_785_326_039_513,
    };

    await sendAdvertisementTermsUpdate(client, update, keypair);

    expect(onlyCall(calls).method).toBe("sendAdvertisementTermsUpdate");
    const payload = decodePayload(onlyCall(calls)) as {
      update: AdvertisementTermsUpdate;
      signature: string;
    };
    expect(payload.update).toEqual(update);

    const signedBytes = new TextEncoder().encode(JSON.stringify(update));
    await expect(
      ed.verifyAsync(
        decodeBase58(payload.signature),
        signedBytes,
        keypair.publicKey,
      ),
    ).resolves.toBe(true);
  });
});
