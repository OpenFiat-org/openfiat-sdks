import * as ed from "@noble/ed25519";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../src/client.js";
import { generateKeypair, peerIdFromPublicKey } from "../src/crypto.js";
import { sendProviderHealthUpdate, sendProviderWithdraw } from "../src/methods/providers.js";
import { toBytes, type HealthUpdate, type Withdrawal } from "../src/types.js";

/**
 * These two methods are what let a provider prove liveness and leave. A node
 * expires services it has not seen a health update for, so the payload has to
 * match what the registry verifies byte for byte — the signature covers the
 * JSON of the inner struct, and the node checks it against the key it already
 * holds for that Service ID. A mismatch here would be rejected on chain-side
 * verification rather than caught by types, so the tests decode the real
 * request body and verify the real signature.
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
  return { calls, client: new Client({ endpoint: "http://localhost:7080" }) };
}

function decodePayload(call: CapturedCall): Record<string, unknown> {
  return JSON.parse(Buffer.from(call.params.data, "base64").toString("utf8"));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider lifecycle methods", () => {
  it("sends a health update whose signature verifies over the update JSON", async () => {
    const { calls, client } = stubTransport();
    const keypair = await generateKeypair();
    const update: HealthUpdate = {
      service_id: "svc-1",
      provider: toBytes(peerIdFromPublicKey(keypair.publicKey)),
      state: "Online",
      timestamp: 1_785_326_039_513,
    };

    await sendProviderHealthUpdate(client, update, keypair);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("sendProviderHealthUpdate");

    const payload = decodePayload(calls[0]) as {
      update: HealthUpdate;
      signature: number[];
    };
    expect(payload.update).toEqual(update);

    // The node verifies over the JSON of the inner struct, not the envelope.
    const signedBytes = new TextEncoder().encode(JSON.stringify(update));
    await expect(
      ed.verifyAsync(Uint8Array.from(payload.signature), signedBytes, keypair.publicKey),
    ).resolves.toBe(true);
  });

  it("sends a withdrawal whose signature verifies over the withdrawal JSON", async () => {
    const { calls, client } = stubTransport();
    const keypair = await generateKeypair();
    const withdrawal: Withdrawal = {
      service_id: "svc-1",
      provider: toBytes(peerIdFromPublicKey(keypair.publicKey)),
      timestamp: 1_785_326_039_513,
    };

    await sendProviderWithdraw(client, withdrawal, keypair);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("sendProviderWithdraw");

    const payload = decodePayload(calls[0]) as {
      withdrawal: Withdrawal;
      signature: number[];
    };
    expect(payload.withdrawal).toEqual(withdrawal);

    const signedBytes = new TextEncoder().encode(JSON.stringify(withdrawal));
    await expect(
      ed.verifyAsync(Uint8Array.from(payload.signature), signedBytes, keypair.publicKey),
    ).resolves.toBe(true);
  });

  it("signs with the caller's key, so another provider's signature will not verify", async () => {
    const { calls, client } = stubTransport();
    const owner = await generateKeypair();
    const impostor = await generateKeypair();
    const withdrawal: Withdrawal = {
      service_id: "svc-1",
      provider: toBytes(peerIdFromPublicKey(owner.publicKey)),
      timestamp: 1_785_326_039_513,
    };

    // The impostor names the real provider but can only sign with its own key.
    await sendProviderWithdraw(client, withdrawal, impostor);

    const payload = decodePayload(calls[0]) as { signature: number[] };
    const signedBytes = new TextEncoder().encode(JSON.stringify(withdrawal));
    await expect(
      ed.verifyAsync(Uint8Array.from(payload.signature), signedBytes, owner.publicKey),
    ).resolves.toBe(false);
  });
});
