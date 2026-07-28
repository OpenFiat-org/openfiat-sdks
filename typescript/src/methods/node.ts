import type { Client } from "../client.js";
import type { VersionResult } from "../types.js";

export async function getVersion(client: Client): Promise<string> {
  const result = await client.call<Record<string, never>, VersionResult>("getVersion", {});
  return result.version;
}

export async function getHealth(client: Client): Promise<string> {
  return client.call<Record<string, never>, string>("getHealth", {});
}
