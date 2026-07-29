import type { Client } from "../client.js";
import type { ChainStatus, LatestBlockhash } from "../types.js";

export async function getChainStatus(client: Client): Promise<ChainStatus> {
  return client.call("getChainStatus", {});
}

export async function getLatestBlockhash(client: Client): Promise<LatestBlockhash> {
  return client.call("getLatestBlockhash", {});
}

/**
 * Submits an already-signed Solana transaction's own wire bytes
 * (e.g. `transaction.serialize()` from `@solana/web3.js`) — this SDK
 * never constructs or signs a transaction on the caller's behalf,
 * matching every other `sendX` method's contract. Identical behavior
 * whether the node itself has a live Solana RPC connection or only
 * gossip (OFS-4300 §8).
 *
 * `correlation` is optional — `"<domain>:<id>"` (e.g. `"settlement:set-1"`,
 * `"dispute:dsp-1"`), see `openfiat_rpc::methods::chain::
 * SendTransactionParams`'s own doc for the convention. Once the node's
 * `poll_chain` observes this transaction genuinely confirmed (not
 * merely accepted for submission), it routes the matching domain
 * registry's local-bookkeeping update.
 */
export async function sendTransaction(
  client: Client,
  transactionBytes: Uint8Array,
  correlation?: string,
): Promise<void> {
  const data = Buffer.from(transactionBytes).toString("base64");
  await client.call<{ data: string; correlation?: string }, { queued: boolean }>("sendTransaction", {
    data,
    ...(correlation !== undefined ? { correlation } : {}),
  });
}
