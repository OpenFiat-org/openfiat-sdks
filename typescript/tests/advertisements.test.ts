import * as ed from "@noble/ed25519";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../src/client.js";
import { generateKeypair, peerIdFromPublicKey } from "../src/crypto.js";
import {
  sendAdvertisementDisable,
  sendAdvertisementPriceUpdate,
} from "../src/methods/advertisements.js";
import { toBytes, type AdvertisementDisable, type AdvertisementPriceUpdate } from "../src/types.js";

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
