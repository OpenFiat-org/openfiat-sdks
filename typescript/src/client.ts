import { OpenFiatError } from "./error.js";

/** Configuration for a {@link Client}. */
export interface ClientConfig {
  /** Base URL of the node's RPC endpoint. */
  endpoint: string;
  /** Request timeout, in milliseconds. */
  timeoutMs: number;
}

/** Default client configuration, pointing at the public OpenFiat RPC endpoint. */
export function defaultClientConfig(): ClientConfig {
  return {
    endpoint: "https://rpc.openfiat.network",
    timeoutMs: 30_000,
  };
}

/**
 * Entry point for the OpenFiat SDK.
 *
 * This is currently a typed stub: transport wiring will be added once
 * `openfiat-core`'s RPC surface stabilizes.
 */
export class Client {
  readonly config: ClientConfig;

  constructor(config: ClientConfig = defaultClientConfig()) {
    this.config = config;
  }

  /** Placeholder for a future `getNodeInfo` RPC call. */
  async nodeInfo(): Promise<never> {
    throw new OpenFiatError("not implemented yet: nodeInfo");
  }
}
