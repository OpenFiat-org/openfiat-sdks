import type { Client } from "../client.js";
import { type Keypair, sign } from "../crypto.js";
import { toBytes, type OraclePublish, type OracleRecord, type SignedOraclePublish } from "../types.js";

export async function getOracleRecord(client: Client, id: string): Promise<OracleRecord | null> {
  return client.call("getOracleRecord", { id });
}

export async function getOracleRecords(client: Client): Promise<OracleRecord[]> {
  return client.call("getOracleRecords", {});
}

/** OFS-7000 §11: the median exchange rate across every provider for this pair. */
export async function getMedianExchangeRate(
  client: Client,
  base: string,
  quote: string,
): Promise<number | null> {
  return client.call("getMedianExchangeRate", { base, quote });
}

/**
 * Publish a new or updated oracle record under `keypair`'s identity —
 * `keypair` must already be registered as an Oracle Provider (see
 * {@link sendProviderRegister}) or the node will reject it.
 */
export async function sendOraclePublish(
  client: Client,
  publish: OraclePublish,
  keypair: Keypair,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(publish));
  const signature = await sign(keypair, bytes);
  const signed: SignedOraclePublish = { publish, signature: toBytes(signature) };
  return client.sendSigned("sendOraclePublish", signed);
}
