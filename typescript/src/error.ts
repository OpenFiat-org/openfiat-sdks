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
    /**
     * The node's report of OFS-8000 §16's judgement for this code: whether
     * the identical request sent again can reach a different outcome.
     *
     * Read it, do not obey it. This SDK never retries anything on its own,
     * and a `true` here is not an instruction to loop — it is the node
     * saying a caller who *wants* to try again is not wasting the attempt.
     * `false` is the load-bearing direction: it means stop asking.
     *
     * `undefined` when the node predates the field, which is the whole
     * reason it is optional. Treat that as "not stated" rather than as
     * `false`, or an older node turns every transient failure permanent.
     */
    public readonly ofsRetryable?: boolean,
  ) {
    super(ofsErrorName ? `${ofsErrorName}: ${message}` : message);
    this.name = "ApplicationError";
  }
}
