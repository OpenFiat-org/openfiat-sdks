/**
 * The wallet-proof trade reads, asserted at the wire.
 *
 * `getMySettlements`, `getMyReservations`, `getMyDisputes` and
 * `getMyTrades` are gated by
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
import { encodeBase58 } from "../src/base58.js";
import { Client } from "../src/client.js";
import { generateKeypair, peerIdFromPublicKey, type Keypair } from "../src/crypto.js";
import { getMyDisputes } from "../src/methods/disputes.js";
import { getMyReservations } from "../src/methods/reservations.js";
import { getMySettlements } from "../src/methods/settlement.js";
import { getMyTrades, tradeStatus } from "../src/methods/trade.js";
import { getWalletChallenge, walletChallengeBytes } from "../src/methods/wallet.js";
import type { Reservation, ReservationState, Settlement, Trade } from "../src/types.js";

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

  it("signs getMyTrades under the trades domain", async () => {
    const { calls, client } = stubNode();
    const keypair = await generateKeypair();

    await expect(getMyTrades(client, keypair)).resolves.toEqual([]);
    await expectProofExchange(calls, keypair, "getMyTrades", "openfiat-my-trades");
  });

  // The property the four separate domains exist for. Collapse them into
  // one constant and every test above still passes.
  it("does not produce a proof that opens another surface", async () => {
    const { calls, client } = stubNode();
    const keypair = await generateKeypair();
    await getMySettlements(client, keypair);

    const signature = new Uint8Array(
      Buffer.from(calls[1]?.params.signature as string, "base64"),
    );
    const wallet = walletOf(keypair);
    for (const other of [
      "openfiat-my-reservations",
      "openfiat-my-disputes",
      "openfiat-my-trades",
    ]) {
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

/**
 * `getMyTrades` answers with the joined record, which carries no derived
 * status — the node computes that on the public view only. So a party
 * reading their own trade is the one caller who has to derive it, and
 * `tradeStatus` is that derivation. These pin the two collapses that are
 * not obvious from the type; the live-node suite pins the whole thing
 * against the node's own answer for a real trade.
 */
describe("the trade status a party has to derive for themselves", () => {
  // A party identifier as the node writes it: base58, not an array of
  // integers. These reads redact the real parties anyway.
  const zeros = encodeBase58(new Uint8Array(32));

  const reservation = (state: ReservationState): Reservation => ({
    id: "r-1",
    advertisement_id: "ad-1",
    requester: zeros,
    requester_public_key: zeros,
    amount: { base_units: 5_000, decimals: 2 },
    agreed_price: { base_units: 12_950, decimals: 2 },
    agreed_mid: null,
    state,
    requested_at: 1_785_326_039_513,
    updated_at: 1_785_326_039_513,
    expires_at: 1_785_326_339_513,
  });

  const settled = (state: Settlement["state"]): Trade => ({
    reservation: reservation("EscrowLocked"),
    settlement: {
      id: "s-1",
      reservation_id: "r-1",
      buyer: zeros,
      buyer_public_key: zeros,
      seller: zeros,
      seller_public_key: zeros,
      amount: { base_units: 5_000, decimals: 2 },
      state,
      payment_reference: null,
      escrow_release_signature: null,
      payment_submitted_at: null,
      merchant_responded_at: null,
      payment_discrepancy: null,
      created_at: 1_785_326_039_513,
      updated_at: 1_785_326_039_513,
    },
  });

  it("is EscrowLocked while no settlement has started", () => {
    expect(tradeStatus({ reservation: reservation("EscrowLocked"), settlement: null })).toBe(
      "EscrowLocked",
    );
  });

  // An expired reservation and a cancelled one are the same thing to
  // someone looking at a trade: it is not happening.
  it("reads an expired reservation as cancelled", () => {
    for (const state of ["Cancelled", "Expired"] as const) {
      expect(tradeStatus({ reservation: reservation(state), settlement: null })).toBe("Cancelled");
    }
  });

  // `Approved` is the merchant saying yes; `Completed` is the on-chain
  // release confirming. One value for both, because a status line has
  // nothing different to say — `escrow_release_signature` is where the
  // distinction lives for a caller who needs it.
  it("collapses Approved and Completed", () => {
    expect(tradeStatus(settled("Approved"))).toBe("Completed");
    expect(tradeStatus(settled("Completed"))).toBe("Completed");
  });

  it("otherwise reads through to the settlement's own state", () => {
    for (const state of ["AwaitingPayment", "PaymentSubmitted", "Rejected", "Disputed"] as const) {
      expect(tradeStatus(settled(state))).toBe(state);
    }
  });
});
