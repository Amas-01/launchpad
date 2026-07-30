import {
  Address,
  Contract,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

export { nativeToScVal, scValToNative };

/** Soroban ledgers per day, assuming 5-second ledgers. */
export const LEDGERS_PER_DAY = 17280;

export function daysToLedgers(days: number | string, currentLedger?: number): number {
  const ledgers = Math.round(Number(days) * LEDGERS_PER_DAY);
  return currentLedger !== undefined ? currentLedger + ledgers : ledgers;
}

/**
 * Build a Soroban invocation transaction.
 */
export async function buildSorobanCall(params: {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  publicKey: string;
  networkPassphrase: string;
  serverUrl: string;
}) {
  const { contractId, method, args } = params;
  const contract = new Contract(contractId);
  return contract.call(method, ...args);
}

/**
 * Format address for ScVal
 */
export function addressToScVal(addr: string) {
  return new Address(addr).toScVal();
}

/**
 * Format i128 for ScVal
 */
export function i128ToScVal(amount: bigint | number) {
  return nativeToScVal(BigInt(amount), { type: "i128" });
}

/* ─────────────────────────────────────────────────────────────────────────
 * RPC error classification + toast bridge
 *
 * Soroban RPC failures and Horizon timeouts surface as a mix of `fetch`
 * `TypeError`s, AbortErrors, and HTTP `Response`s with status codes like
 * 504 / 503. Hooks across the app re-throw these errors raw, which makes
 * for a noisy debugging experience. `wrapRpcCall` runs an arbitrary
 * promise, classifies any failure, and dispatches a user-friendly toast
 * via the `window.__soropadToast` bridge installed by ToastProvider.
 *
 * The original error is re-thrown so callers keep their existing control
 * flow (retry buttons, error states, etc.) and can opt out of the toast
 * by passing `silent: true` for expected/handled paths.
 * ──────────────────────────────────────────────────────────────────── */

export type RpcErrorKind =
  | "timeout"
  | "network"
  | "rate_limit"
  | "server"
  | "simulation"
  | "unknown";

export interface RpcErrorInfo {
  kind: RpcErrorKind;
  status?: number;
  title: string;
  message: string;
}

interface ToastBridge {
  show: (t: {
    title: string;
    message?: string;
    variant?: "info" | "success" | "warning" | "error";
    duration?: number;
    txHash?: string;
  }) => string;
}

function getToastBridge(): ToastBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __soropadToast?: ToastBridge };
  return w.__soropadToast ?? null;
}

export function classifyRpcError(err: unknown): RpcErrorInfo {
  // Direct Response object (rare; some clients re-throw the response)
  if (typeof Response !== "undefined" && err instanceof Response) {
    return classifyByStatus(err.status);
  }

  // AbortError → timeout
  if (err instanceof DOMException && err.name === "AbortError") {
    return {
      kind: "timeout",
      title: "Request timed out",
      message:
        "The Soroban RPC endpoint took too long to respond. The network may be degraded — please retry shortly.",
    };
  }

  // fetch() throws TypeError for connection failures (DNS, CORS, offline)
  if (err instanceof TypeError) {
    const msg = err.message || "";
    if (/fetch|network|failed/i.test(msg)) {
      return {
        kind: "network",
        title: "Network unreachable",
        message:
          "Could not reach the Soroban RPC endpoint. Check your connection or RPC settings.",
      };
    }
  }

  // Plain Error: scrape the message for status hints
  if (err instanceof Error) {
    const msg = err.message;

    // Status code embedded in message: "504", "HTTP 504", etc.
    const statusMatch = msg.match(/\b(4\d\d|5\d\d)\b/);
    if (statusMatch) {
      return classifyByStatus(parseInt(statusMatch[1], 10), msg);
    }

    if (/timeout|timed out/i.test(msg)) {
      return {
        kind: "timeout",
        title: "Request timed out",
        message: "The Soroban RPC took too long to respond. Please retry.",
      };
    }
    if (/simulation/i.test(msg)) {
      return {
        kind: "simulation",
        title: "Contract simulation failed",
        message: msg,
      };
    }
    if (/network|fetch|connect/i.test(msg)) {
      return {
        kind: "network",
        title: "Network error",
        message: msg,
      };
    }

    return {
      kind: "unknown",
      title: "RPC request failed",
      message: msg,
    };
  }

  return {
    kind: "unknown",
    title: "Unexpected error",
    message: typeof err === "string" ? err : "An unknown error occurred.",
  };
}

function classifyByStatus(status: number, raw?: string): RpcErrorInfo {
  if (status === 504 || status === 408) {
    return {
      kind: "timeout",
      status,
      title: "RPC gateway timeout",
      message:
        "The Soroban RPC endpoint did not respond in time. Testnet may be degraded — please retry in a moment.",
    };
  }
  if (status === 429) {
    return {
      kind: "rate_limit",
      status,
      title: "Rate limited",
      message:
        "Too many requests to the RPC endpoint. Please wait a few seconds and try again.",
    };
  }
  if (status >= 500) {
    return {
      kind: "server",
      status,
      title: `RPC server error (${status})`,
      message:
        raw ??
        "The Soroban RPC server returned an error. Please retry shortly.",
    };
  }
  return {
    kind: "unknown",
    status,
    title: `Request failed (${status})`,
    message: raw ?? "The RPC request failed.",
  };
}

export interface WrapRpcOptions {
  /** Operation label used in the toast title fallback. */
  operation?: string;
  /** Skip the toast (useful when the caller already shows inline error UI). */
  silent?: boolean;
  /** Override the toast title. */
  toastTitle?: string;
  /** Transaction hash for linking in notification history. */
  txHash?: string;
}

/**
 * Run an RPC-bound async call, surface a user-friendly toast on failure,
 * and re-throw the original error so callers preserve their control flow.
 */
export async function wrapRpcCall<T>(
  fn: () => Promise<T>,
  options: WrapRpcOptions = {},
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const info = classifyRpcError(err);

    if (!options.silent) {
      const bridge = getToastBridge();
      bridge?.show({
        title: options.toastTitle ?? info.title,
        message: options.operation
          ? `${options.operation}: ${info.message}`
          : info.message,
        variant:
          info.kind === "timeout" || info.kind === "network"
            ? "warning"
            : "error",
        txHash: options.txHash,
      });
    }

    if (process.env.NODE_ENV !== "test") {
      console.error(
        `[RPC] ${options.operation ?? "call"} failed (${info.kind}):`,
        err,
      );
    }
    throw err;
  }
}
