import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, defaultClientConfig } from "../src/client.js";
import { ApplicationError } from "../src/error.js";

describe("Client", () => {
  it("uses the default endpoint", () => {
    const client = new Client();
    expect(client.config.endpoint).toBe("https://rpc.openfiat.network");
  });

  it("accepts a custom config", () => {
    const config = { ...defaultClientConfig(), endpoint: "http://localhost:8899" };
    const client = new Client(config);
    expect(client.config.endpoint).toBe("http://localhost:8899");
  });
});

/**
 * Answers a single call with the exact `error` object `openfiat-core`'s
 * `RpcError::Application` renders.
 *
 * Transcribed rather than read off a live node: this suite has no node to
 * spawn, and the point of the assertions below is the wire contract, which
 * is fixed by OFS-8200 §10 rather than by whatever build happens to be
 * listening.
 */
function nodeAnswering(error: Record<string, unknown>) {
  return vi.fn(async () => ({
    text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, error }),
  })) as unknown as typeof fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("an application error the node returns", () => {
  it("carries the OFS-8000 code, name and retryability", async () => {
    vi.stubGlobal(
      "fetch",
      nodeAnswering({
        code: -32000,
        message: "SETTLEMENT_NOT_FOUND",
        data: {
          ofsErrorCode: 5008,
          ofsErrorName: "SETTLEMENT_NOT_FOUND",
          ofsRetryable: false,
        },
      }),
    );

    const client = new Client();
    const err = await client.call("sendSettlementCancelled", {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApplicationError);
    const application = err as ApplicationError;
    expect(application.ofsErrorCode).toBe(5008);
    expect(application.ofsErrorName).toBe("SETTLEMENT_NOT_FOUND");
    expect(application.ofsRetryable).toBe(false);
  });

  /*
   * Both directions, because a `false` hardcoded at the boundary would
   * satisfy the case above and tell every caller to give up on a timeout.
   */
  it("says so when the same request may succeed next time", async () => {
    vi.stubGlobal(
      "fetch",
      nodeAnswering({
        code: -32000,
        message: "CHAIN_UNAVAILABLE",
        data: {
          ofsErrorCode: 1010,
          ofsErrorName: "CHAIN_UNAVAILABLE",
          ofsRetryable: true,
        },
      }),
    );

    const client = new Client();
    const err = (await client
      .call("getLatestBlockhash", {})
      .catch((e: unknown) => e)) as ApplicationError;

    expect(err.ofsRetryable).toBe(true);
  });

  /*
   * A node that predates the field leaves it unstated, and unstated must
   * not read as "do not retry" — otherwise every older node in the network
   * looks permanently broken to a client that backs off on `false`.
   */
  it("leaves retryability undefined when an older node does not state it", async () => {
    vi.stubGlobal(
      "fetch",
      nodeAnswering({
        code: -32000,
        message: "CHAIN_UNAVAILABLE",
        data: { ofsErrorCode: 1010, ofsErrorName: "CHAIN_UNAVAILABLE" },
      }),
    );

    const client = new Client();
    const err = (await client
      .call("getLatestBlockhash", {})
      .catch((e: unknown) => e)) as ApplicationError;

    expect(err.ofsErrorCode).toBe(1010);
    expect(err.ofsRetryable).toBeUndefined();
  });
});
