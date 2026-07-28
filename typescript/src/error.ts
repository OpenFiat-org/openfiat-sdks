/** Errors thrown by the OpenFiat SDK — mirrors the Rust SDK's `Error` enum. */

/** The HTTP request itself failed, or the response body wasn't valid JSON. */
export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

/** A standard JSON-RPC 2.0 transport-level error (OFS-8200 §10). */
export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}

/**
 * An application-level failure (OFS-8200 §10's `-32000` error), carrying
 * OFS-8000's own numeric code and symbolic name.
 */
export class ApplicationError extends Error {
  constructor(
    message: string,
    public readonly ofsErrorCode?: number,
    public readonly ofsErrorName?: string,
  ) {
    super(ofsErrorName ? `${ofsErrorName}: ${message}` : message);
    this.name = "ApplicationError";
  }
}
