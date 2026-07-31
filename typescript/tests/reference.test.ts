/**
 * The reference read is one call with no parameters, so there is no
 * signing or encoding to get wrong. What can go wrong instead is the
 * *contract*: the whole point of moving countries, currencies and payment
 * methods to the node is that a client stops keeping its own copy, and
 * that only holds if this function talks to the node on every call, sends
 * no filter the node would ignore, and hands back an unreachable node as a
 * failure rather than as an empty list.
 *
 * An empty list is the dangerous shape. A picker handed `[]` renders as
 * "no currencies", which reads to a user as a network with nothing on it
 * rather than as a client that could not reach anything — so the test
 * below pins the thrown-not-swallowed behaviour explicitly.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../src/client.js";
import { getReferenceData } from "../src/methods/reference.js";
import type { ReferenceData } from "../src/types.js";

type CapturedCall = { method: string; params: unknown };

const ANSWER: ReferenceData = {
  revision: "9f2c4a1b7e0d3856",
  currencies: [
    { code: "KES", name: "Kenyan shilling", symbol: "KSh" },
    { code: "USD", name: "United States dollar", symbol: "$" },
  ],
  countries: [
    { code: "KE", name: "Kenya", currency: "KES", alt_currencies: [] },
    { code: "ZW", name: "Zimbabwe", currency: "ZWG", alt_currencies: ["USD", "ZAR"] },
  ],
  payment_methods: [
    { name: "M-Pesa Kenya (Safaricom)", category: "MobileMoney", aliases: ["mpesa", "m-pesa"] },
    { name: "Cash in Person", category: "Cash", aliases: ["cash", "f2f"] },
  ],
  mints: [
    { mint: "So11111111111111111111111111111111111111112", symbol: "wSOL", decimals: 9 },
    { mint: "C4rSGhdxWhSFQuFcAxQti1JvBxriwHJoHtJjfhs5p24Y", symbol: "USDT", decimals: 6 },
  ],
};

function stubNode(result: unknown = ANSWER): { calls: CapturedCall[]; client: Client } {
  const calls: CapturedCall[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push({ method: body.method, params: body.params });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
    };
  });
  return { calls, client: new Client({ endpoint: "http://localhost:7080", timeoutMs: 30_000 }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getReferenceData", () => {
  it("asks the node for the whole table in one unparameterised call", async () => {
    const { calls, client } = stubNode();
    await getReferenceData(client);

    // One call, not three: countries reference currency codes, so a
    // client that assembled them from separate reads could end up holding
    // a country pointing at a currency it never received.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("getReferenceData");
    expect(calls[0]?.params).toEqual({});
  });

  it("returns the node's lists verbatim, including a country's alternate currencies", async () => {
    const { client } = stubNode();
    const data = await getReferenceData(client);

    expect(data.revision).toBe("9f2c4a1b7e0d3856");
    // Zimbabwe is the case that motivated `alt_currencies` existing at
    // all: its USD book is frequently larger than its ZWG one, and an SDK
    // that flattened this field to the primary currency would hide it.
    expect(data.countries.find((c) => c.code === "ZW")?.alt_currencies).toEqual(["USD", "ZAR"]);
    expect(data.payment_methods.map((m) => m.category)).toEqual(["MobileMoney", "Cash"]);
  });

  it("names wrapped SOL the way the node does, not the way a ticker list assumed", async () => {
    const { client } = stubNode();
    const data = await getReferenceData(client);

    // The mismatch that put mints on this method: an app carrying its own
    // `["USDT","USDC","USD1","SOL"]` matched the book on `"SOL"`, the node
    // answers `wSOL`, and the resulting market page could never show an
    // advertisement — which looks exactly like an empty market.
    const wsol = data.mints.find(
      (m) => m.mint === "So11111111111111111111111111111111111111112",
    );
    expect(wsol?.symbol).toBe("wSOL");
    expect(wsol?.decimals).toBe(9);
  });

  it("propagates an unreachable node instead of answering with empty lists", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection refused");
    });
    const client = new Client({ endpoint: "http://localhost:7080", timeoutMs: 30_000 });

    // If this ever resolved to `{ currencies: [], ... }` a picker would
    // render "no currencies" and a user would read a client-side failure
    // as a fact about the network.
    await expect(getReferenceData(client)).rejects.toThrow();
  });
});
