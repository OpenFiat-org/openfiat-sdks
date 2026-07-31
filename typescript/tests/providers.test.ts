import * as ed from "@noble/ed25519";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeBase58 } from "../src/base58.js";
import { Client } from "../src/client.js";
import { generateKeypair, peerIdFromPublicKey } from "../src/crypto.js";
import {
  earningsChallengeBytes,
  getProviderEarnings,
  sendProviderHealthUpdate,
  sendProviderWithdraw,
} from "../src/methods/providers.js";
import { toBase58, type HealthUpdate, type Withdrawal } from "../src/types.js";

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
  return { calls, client: new Client({ endpoint: "http://localhost:7080", timeoutMs: 30_000 }) };
}

/** Reads the single captured call, failing the test if none was made. Keeps
 *  the assertions below free of non-null assertions under
 *  `noUncheckedIndexedAccess`. */
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

describe("provider lifecycle methods", () => {
  it("sends a health update whose signature verifies over the update JSON", async () => {
    const { calls, client } = stubTransport();
    const keypair = await generateKeypair();
    const update: HealthUpdate = {
      service_id: "svc-1",
      provider: toBase58(peerIdFromPublicKey(keypair.publicKey)),
      state: "Online",
      timestamp: 1_785_326_039_513,
    };

    await sendProviderHealthUpdate(client, update, keypair);

    expect(calls).toHaveLength(1);
    expect(onlyCall(calls).method).toBe("sendProviderHealthUpdate");

    const payload = decodePayload(onlyCall(calls)) as {
      update: HealthUpdate;
      signature: string;
    };
    expect(payload.update).toEqual(update);

    // The node verifies over the JSON of the inner struct, not the envelope.
    const signedBytes = new TextEncoder().encode(JSON.stringify(update));
    await expect(
      ed.verifyAsync(decodeBase58(payload.signature), signedBytes, keypair.publicKey),
    ).resolves.toBe(true);
  });

  it("sends a withdrawal whose signature verifies over the withdrawal JSON", async () => {
    const { calls, client } = stubTransport();
    const keypair = await generateKeypair();
    const withdrawal: Withdrawal = {
      service_id: "svc-1",
      provider: toBase58(peerIdFromPublicKey(keypair.publicKey)),
      timestamp: 1_785_326_039_513,
    };

    await sendProviderWithdraw(client, withdrawal, keypair);

    expect(calls).toHaveLength(1);
    expect(onlyCall(calls).method).toBe("sendProviderWithdraw");

    const payload = decodePayload(onlyCall(calls)) as {
      withdrawal: Withdrawal;
      signature: string;
    };
    expect(payload.withdrawal).toEqual(withdrawal);

    const signedBytes = new TextEncoder().encode(JSON.stringify(withdrawal));
    await expect(
      ed.verifyAsync(decodeBase58(payload.signature), signedBytes, keypair.publicKey),
    ).resolves.toBe(true);
  });

  it("signs with the caller's key, so another provider's signature will not verify", async () => {
    const { calls, client } = stubTransport();
    const owner = await generateKeypair();
    const impostor = await generateKeypair();
    const withdrawal: Withdrawal = {
      service_id: "svc-1",
      provider: toBase58(peerIdFromPublicKey(owner.publicKey)),
      timestamp: 1_785_326_039_513,
    };

    // The impostor names the real provider but can only sign with its own key.
    await sendProviderWithdraw(client, withdrawal, impostor);

    const payload = decodePayload(onlyCall(calls)) as { signature: string };
    const signedBytes = new TextEncoder().encode(JSON.stringify(withdrawal));
    await expect(
      ed.verifyAsync(decodeBase58(payload.signature), signedBytes, owner.publicKey),
    ).resolves.toBe(false);
  });
});

/**
 * The earnings read is a two-step exchange, and the bytes signed in step two
 * have to match what the node reconstructs from the challenge it issued —
 * `openfiat-earnings:<service_id>:<nonce>`. A mismatch would be rejected at
 * signature verification rather than caught by types, so these decode the
 * real request and verify the real signature, the same way the health-update
 * tests above do.
 */
describe("provider earnings", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Answers the challenge call, then captures the earnings call. */
  function stubEarningsExchange(challenge: {
    service_id: string;
    nonce: string;
    expires_at: number;
  }): { calls: { method: string; params: Record<string, unknown> }[]; client: Client } {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      calls.push({ method: body.method, params: body.params });
      const result =
        body.method === "getProviderEarningsChallenge"
          ? challenge
          : { service_id: challenge.service_id, payout_wallet: null, entries: [] };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
      };
    });
    return {
      calls,
      client: new Client({ endpoint: "http://localhost:7080", timeoutMs: 30_000 }),
    };
  }

  it("signs the challenge bytes the node will reconstruct", async () => {
    const keypair = await generateKeypair();
    const challenge = { service_id: "svc-1", nonce: "abc123", expires_at: 1_785_326_339_513 };
    const { calls, client } = stubEarningsExchange(challenge);

    const earnings = await getProviderEarnings(client, "svc-1", keypair);
    expect(earnings.entries).toEqual([]);

    expect(calls.map((c) => c.method)).toEqual([
      "getProviderEarningsChallenge",
      "getProviderEarnings",
    ]);

    const read = calls[1];
    if (!read) throw new Error("expected the earnings call to have been made");
    expect(read.params.nonce).toBe("abc123");

    // The signature must verify over exactly the bytes the node rebuilds.
    const signature = Buffer.from(read.params.signature as string, "base64");
    const expected = new TextEncoder().encode("openfiat-earnings:svc-1:abc123");
    expect(earningsChallengeBytes(challenge)).toEqual(expected);
    await expect(
      ed.verifyAsync(new Uint8Array(signature), expected, keypair.publicKey),
    ).resolves.toBe(true);
  });

  it("does not verify against different challenge bytes", async () => {
    const keypair = await generateKeypair();
    const challenge = { service_id: "svc-1", nonce: "abc123", expires_at: 1 };
    const { calls, client } = stubEarningsExchange(challenge);
    await getProviderEarnings(client, "svc-1", keypair);

    const read = calls[1];
    if (!read) throw new Error("expected the earnings call to have been made");
    const signature = Buffer.from(read.params.signature as string, "base64");

    // A nonce the provider never signed must not validate — this is what
    // stops a signature being lifted onto a different challenge.
    await expect(
      ed.verifyAsync(
        new Uint8Array(signature),
        new TextEncoder().encode("openfiat-earnings:svc-1:deadbeef"),
        keypair.publicKey,
      ),
    ).resolves.toBe(false);
  });
});
