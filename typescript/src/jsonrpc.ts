/** The JSON-RPC 2.0 envelope OFS-8200 §4 defines. */

export interface JsonRpcRequest<P> {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: P;
}

export interface JsonRpcResponseError {
  code: number;
  message: string;
  data?: {
    ofsErrorCode?: number;
    ofsErrorName?: string;
    /** OFS-8000 §16's retryability judgement, as the node reports it. */
    ofsRetryable?: boolean;
  };
}

export interface JsonRpcResponse<R> {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: R;
  error?: JsonRpcResponseError;
}

export const APPLICATION_ERROR = -32000;
