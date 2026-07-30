import * as ed from "@noble/ed25519";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../src/client.js";
import { generateKeypair, peerIdFromPublicKey } from "../src/crypto.js";
import {
  eachAdvertisement,
  getAdvertisements,
  sendAdvertisementDisable,
  sendAdvertisementPriceUpdate,
} from "../src/methods/advertisements.js";
import {
  toBytes,
  type AdvertisementDisable,
  type AdvertisementPage,
  type AdvertisementPriceUpdate,
  type AdvertisementView,
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
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: null }),
    };
  });
  return { calls, client: new Client({ endpoint: "http://localhost:7080", timeoutMs: 30_000 }) };
}

function onlyCall(calls: CapturedCall[]): CapturedCall {
  const call = calls[0];
  if (!call) throw new Error("expected exactly one captured RPC call, got none");
  return call;
}

function decodePayload(call: CapturedCall): Record<string, unknown> {
  return JSON.parse(Buffer.from(call.params.data, "base64").toString("utf8"));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("advertisement lifecycle methods", () => {
  it("sends a disable whose signature verifies over the disable JSON", async () => {
    const { calls, client } = stubTransport();
    const keypair = await generateKeypair();
    const disable: AdvertisementDisable = {
      id: "ad-1",
      merchant: toBytes(peerIdFromPublicKey(keypair.publicKey)),
      timestamp: 1_785_326_039_513,
    };

    await sendAdvertisementDisable(client, disable, keypair);

    expect(calls).toHaveLength(1);
    expect(onlyCall(calls).method).toBe("sendAdvertisementDisable");

    const payload = decodePayload(onlyCall(calls)) as {
      disable: AdvertisementDisable;
      signature: number[];
    };
    expect(payload.disable).toEqual(disable);

    // The node verifies over the JSON of the inner struct, not the envelope.
    const signedBytes = new TextEncoder().encode(JSON.stringify(disable));
    await expect(
      ed.verifyAsync(Uint8Array.from(payload.signature), signedBytes, keypair.publicKey),
    ).resolves.toBe(true);
  });

  it("signs a disable with the caller's key, so another merchant's signature will not verify", async () => {
    const { calls, client } = stubTransport();
    const owner = await generateKeypair();
    const impostor = await generateKeypair();
    const disable: AdvertisementDisable = {
      id: "ad-1",
      merchant: toBytes(peerIdFromPublicKey(owner.publicKey)),
      timestamp: 1_785_326_039_513,
    };

    // The impostor names the real merchant but can only sign with its own key.
    await sendAdvertisementDisable(client, disable, impostor);

    const payload = decodePayload(onlyCall(calls)) as { signature: number[] };
    const signedBytes = new TextEncoder().encode(JSON.stringify(disable));
    await expect(
      ed.verifyAsync(Uint8Array.from(payload.signature), signedBytes, owner.publicKey),
    ).resolves.toBe(false);
  });

  it("sends a price update whose signature verifies over the update JSON", async () => {
    const { calls, client } = stubTransport();
    const keypair = await generateKeypair();
    const update: AdvertisementPriceUpdate = {
      id: "ad-1",
      merchant: toBytes(peerIdFromPublicKey(keypair.publicKey)),
      pricing: { Fixed: { price: { base_units: 200, decimals: 2 } } },
      timestamp: 1_785_326_039_513,
    };

    await sendAdvertisementPriceUpdate(client, update, keypair);

    expect(calls).toHaveLength(1);
    expect(onlyCall(calls).method).toBe("sendAdvertisementPriceUpdate");

    const payload = decodePayload(onlyCall(calls)) as {
      update: AdvertisementPriceUpdate;
      signature: number[];
    };
    expect(payload.update).toEqual(update);

    const signedBytes = new TextEncoder().encode(JSON.stringify(update));
    await expect(
      ed.verifyAsync(Uint8Array.from(payload.signature), signedBytes, keypair.publicKey),
    ).resolves.toBe(true);
  });

  it("signs a price update with the caller's key, so another merchant's signature will not verify", async () => {
    const { calls, client } = stubTransport();
    const owner = await generateKeypair();
    const impostor = await generateKeypair();
    const update: AdvertisementPriceUpdate = {
      id: "ad-1",
      merchant: toBytes(peerIdFromPublicKey(owner.publicKey)),
      pricing: { Fixed: { price: { base_units: 999_00, decimals: 2 } } },
      timestamp: 1_785_326_039_513,
    };

    await sendAdvertisementPriceUpdate(client, update, impostor);

    const payload = decodePayload(onlyCall(calls)) as { signature: number[] };
    const signedBytes = new TextEncoder().encode(JSON.stringify(update));
    await expect(
      ed.verifyAsync(Uint8Array.from(payload.signature), signedBytes, owner.publicKey),
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
      merchant: toBytes(peerIdFromPublicKey(keypair.publicKey)),
      pricing: { Floating: { oracle_provider: "any", premium_bps: 150, price_decimals: 2 } },
      timestamp: 1_785_326_039_513,
    };

    await sendAdvertisementPriceUpdate(client, update, keypair);

    const payload = decodePayload(onlyCall(calls)) as { update: AdvertisementPriceUpdate };
    expect(payload.update.pricing).toEqual({
      Floating: { oracle_provider: "any", premium_bps: 150, price_decimals: 2 },
    });
    // `pricing` sits between `merchant` and `timestamp`, and the model is
    // externally tagged, because that is how `serde` writes the enum the
    // node reads back. The signature covers these bytes in this order.
    expect(Object.keys(payload.update)).toEqual(["id", "merchant", "pricing", "timestamp"]);
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
function stubPages(pages: AdvertisementPage[]): { calls: CapturedQuery[]; client: Client } {
  const calls: CapturedQuery[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push({ method: body.method, params: body.params });
    const result = pages[calls.length - 1] ?? { advertisements: [], next_cursor: null };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
    };
  });
  return { calls, client: new Client({ endpoint: "http://localhost:7080", timeoutMs: 30_000 }) };
}

function row(id: string): AdvertisementView {
  return {
    id,
    merchant: [],
    merchant_public_key: [],
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
  };
}

describe("reading the order book a page at a time", () => {
  it("asks for the first page of the whole active book when given no query", async () => {
    const { calls, client } = stubPages([{ advertisements: [row("ad-1")], next_cursor: null }]);

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
    const { calls, client } = stubPages([{ advertisements: [], next_cursor: null }]);

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
      { advertisements: [row("ad-1"), row("ad-2")], next_cursor: "opaque-cursor-1" },
      { advertisements: [row("ad-3")], next_cursor: null },
    ]);

    const seen: string[] = [];
    for await (const advertisement of eachAdvertisement(client)) seen.push(advertisement.id);

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
      { filter: { fiat_currency: "KES" }, page: { limit: 1, after: "cursor-1" } },
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
    for await (const advertisement of eachAdvertisement(client)) seen.push(advertisement.id);

    expect(seen).toEqual(["ad-1"]);
    expect(calls).toHaveLength(2);
  });
});
