/**
 * The wallet-proof trade reads, asserted at the wire.
 *
 * `getMySettlements`, `getMyReservations` and `getMyDisputes` are gated by
 * a signature over `"<domain>:<subject>:<nonce>"`, and the domain is a
 * bare string constant transcribed from the node's own. Get one character
 * of it wrong and the node answers with a signature failure that never
 * mentions domains, on a surface whose whole purpose is that it refuses
 * rather than explains. Nothing but an assertion on the exact bytes
 * catches that before a user does.
 *
 * So these decode the real request body and verify the real signature —
 * the same thing `providers.test.ts` does for the earnings handshake —
 * rather than trusting the builders' own bookkeeping.
 */
import * as ed from "@noble/ed25519";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../src/client.js";
import { generateKeypair, peerIdFromPublicKey, type Keypair } from "../src/crypto.js";
import { getMyDisputes } from "../src/methods/disputes.js";
import { getMyReservations } from "../src/methods/reservations.js";
import { getMySettlements } from "../src/methods/settlement.js";
import { getWalletChallenge, walletChallengeBytes } from "../src/methods/wallet.js";

/**
 * The nonce the stub issues. Fixed, so the bytes the SDK signs are fully
 * determined and each test can rebuild them independently rather than
 * reading them back out of the request it is checking.
 */
const NONCE = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

type CapturedCall = { method: string; params: Record<string, unknown> };

/**
 * Answers `getWalletChallenge` the way a node does — echoing the wallet
 * back as the canonical `subject` that gets signed verbatim — and answers
 * everything else with an empty list.
 */
function stubNode(): { calls: CapturedCall[]; client: Client } {
  const calls: CapturedCall[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push({ method: body.method, params: body.params });
    const result =
      body.method === "getWalletChallenge"
        ? { subject: body.params.wallet, nonce: NONCE, expires_at: 1_785_326_339_513 }
        : [];
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
    };
  });
  return { calls, client: new Client({ endpoint: "http://localhost:7080", timeoutMs: 30_000 }) };
}

function walletOf(keypair: Keypair): string {
  return Buffer.from(peerIdFromPublicKey(keypair.publicKey)).toString("base64");
}

/**
 * Checks the two-call exchange a `getMy*` method makes: a challenge
 * request for the caller's own wallet, then a proof signed under
 * `domain`.
 */
async function expectProofExchange(
  calls: CapturedCall[],
  keypair: Keypair,
  method: string,
  domain: string,
): Promise<void> {
  expect(calls.map((c) => c.method)).toEqual(["getWalletChallenge", method]);

  const wallet = walletOf(keypair);
  expect(calls[0]?.params).toEqual({ wallet });

  const proof = calls[1]?.params ?? {};
  expect(proof.wallet).toBe(wallet);
  expect(proof.public_key).toBe(Buffer.from(keypair.publicKey).toString("base64"));
  expect(proof.nonce).toBe(NONCE);

  // Rebuilt from the domain literal rather than from the SDK's own
  // constant: a test that asked the SDK what it signed would agree with
  // any typo it made.
  const signed = new TextEncoder().encode(`${domain}:${wallet}:${NONCE}`);
  const signature = new Uint8Array(Buffer.from(proof.signature as string, "base64"));
  await expect(ed.verifyAsync(signature, signed, keypair.publicKey)).resolves.toBe(true);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the wallet-proof trade reads", () => {
  it("asks for a challenge by wallet and nothing else", async () => {
    const { calls, client } = stubNode();
    const keypair = await generateKeypair();

    const challenge = await getWalletChallenge(client, peerIdFromPublicKey(keypair.publicKey));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("getWalletChallenge");
    expect(calls[0]?.params).toEqual({ wallet: walletOf(keypair) });
    // The subject is signed verbatim, so it is the node's spelling that
    // matters, not the caller's.
    expect(challenge.subject).toBe(walletOf(keypair));
    expect(walletChallengeBytes(challenge, "openfiat-my-settlements")).toEqual(
      new TextEncoder().encode(`openfiat-my-settlements:${walletOf(keypair)}:${NONCE}`),
    );
  });

  it("signs getMySettlements under the settlements domain", async () => {
    const { calls, client } = stubNode();
    const keypair = await generateKeypair();

    await expect(getMySettlements(client, keypair)).resolves.toEqual([]);
    await expectProofExchange(calls, keypair, "getMySettlements", "openfiat-my-settlements");
  });

  it("signs getMyReservations under the reservations domain", async () => {
    const { calls, client } = stubNode();
    const keypair = await generateKeypair();

    await expect(getMyReservations(client, keypair)).resolves.toEqual([]);
    await expectProofExchange(calls, keypair, "getMyReservations", "openfiat-my-reservations");
  });

  it("signs getMyDisputes under the disputes domain", async () => {
    const { calls, client } = stubNode();
    const keypair = await generateKeypair();

    await expect(getMyDisputes(client, keypair)).resolves.toEqual([]);
    await expectProofExchange(calls, keypair, "getMyDisputes", "openfiat-my-disputes");
  });

  // The property the three separate domains exist for. Collapse them into
  // one constant and every test above still passes.
  it("does not produce a proof that opens another surface", async () => {
    const { calls, client } = stubNode();
    const keypair = await generateKeypair();
    await getMySettlements(client, keypair);

    const signature = new Uint8Array(
      Buffer.from(calls[1]?.params.signature as string, "base64"),
    );
    const wallet = walletOf(keypair);
    for (const other of ["openfiat-my-reservations", "openfiat-my-disputes"]) {
      await expect(
        ed.verifyAsync(
          signature,
          new TextEncoder().encode(`${other}:${wallet}:${NONCE}`),
          keypair.publicKey,
        ),
      ).resolves.toBe(false);
    }
  });
});
