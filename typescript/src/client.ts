import { ApplicationError, JsonRpcError, TransportError } from "./error.js";
import { APPLICATION_ERROR, type JsonRpcRequest, type JsonRpcResponse } from "./jsonrpc.js";

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
 * Entry point for the OpenFiat SDK: a JSON-RPC 2.0 client implementing
 * OFS-8200. `call` is the generic primitive every typed method in
 * `src/methods/*.ts` builds on; most callers should use those typed
 * methods instead of `call` directly.
 */
export class Client {
  readonly config: ClientConfig;
  private nextId = 1;

  constructor(config: ClientConfig = defaultClientConfig()) {
    this.config = config;
  }

  /**
   * The generic JSON-RPC call every typed method builds on — see
   * OFS-8200 §4. `method` is a `getX`/`sendX` name; `params` is
   * whatever shape that method expects.
   */
  async call<P, R>(method: string, params: P): Promise<R> {
    const request: JsonRpcRequest<P> = {
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      params,
    };

    const url = `${this.config.endpoint.replace(/\/$/, "")}/rpc`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let text: string;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (err) {
      throw new TransportError(`request to ${url} failed: ${String(err)}`);
    } finally {
      clearTimeout(timeout);
    }

    let body: JsonRpcResponse<R>;
    try {
      body = JSON.parse(text) as JsonRpcResponse<R>;
    } catch (err) {
      throw new TransportError(`failed to parse response as JSON: ${String(err)}`);
    }

    if (body.error) {
      if (body.error.code === APPLICATION_ERROR) {
        throw new ApplicationError(
          body.error.message,
          body.error.data?.ofsErrorCode,
          body.error.data?.ofsErrorName,
          body.error.data?.ofsRetryable,
        );
      }
      throw new JsonRpcError(body.error.code, body.error.message);
    }
    if (body.result === undefined) {
      throw new JsonRpcError(0, "response carried neither a result nor an error");
    }
    return body.result;
  }

  /**
   * Base64-encode an already-signed domain event as JSON and submit it
   * as a `sendX` call — the primitive every `send*` typed method in
   * `src/methods/*.ts` builds on (OFS-8200 §5's "opaque, already-signed
   * JSON payload" write model).
   */
  async sendSigned<T, R>(method: string, signed: T): Promise<R> {
    const json = JSON.stringify(signed);
    const data = Buffer.from(json, "utf8").toString("base64");
    return this.call<{ data: string }, R>(method, { data });
  }
}
