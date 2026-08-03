import {
  Address,
  Contract,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

export { nativeToScVal, scValToNative };

/* ─────────────────────────────────────────────────────────────────────────
 * Contract error code → human message mapping
 *
 * These maps let the UI translate the numeric `ContractError(#N)` codes
 * that Soroban surfaces in release WASM into user-facing explanations.
 * Both `TokenError` and `VestingError` use `#[repr(u32)]` so their numeric
 * values are stable across debug and release builds.
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Human-readable messages for every variant in the token contract's
 * `TokenError` enum.
 */
export const TokenErrorMessages: Record<number, string> = {
  1: "Transfer rejected by compliance rules.",
  2: "Compliance node is unavailable or misconfigured.",
  3: "Invalid compliance node address (probe failed).",
  4: "Token contract is already initialized.",
  5: "Contract is locked (admin was revoked).",
  6: "Contract is paused — no state-changing operations allowed.",
  7: "Amount must be positive.",
  8: "Insufficient balance.",
  9: "Insufficient allowance.",
  10: "Account is frozen — cannot send tokens.",
  11: "Recipient is not an authorized holder.",
  12: "Authorization is not revocable for this token.",
  13: "Mint would exceed the maximum supply cap.",
  14: "WASM hash cannot be all zeros.",
  15: "Expiration ledger must be in the future.",
  16: "Transfer would exceed the per-account balance cap.",
  17: "No pending admin proposal to accept.",
  18: "Initial supply exceeds the maximum supply cap.",
  19: "Decimal value must be 18 or less.",
  20: "Batch recipient and amount lists have different lengths.",
  21: "Batch size exceeds the maximum of 100 entries.",
  22: "Contract URI has not been set yet.",
  23: "Contract has not been initialized yet.",
};

/**
 * Human-readable messages for every variant in the vesting contract's
 * `VestingError` enum.
 */
export const VestingErrorMessages: Record<number, string> = {
  1: "Vesting contract is already initialized.",
  2: "Contract has not been initialized yet.",
  3: "Vesting contract is paused.",
  4: "Amount must be positive.",
  5: "End ledger must be after cliff ledger.",
  6: "No pending admin proposal to accept.",
  7: "Schedule has been revoked — no further releases.",
  8: "Schedule was already revoked.",
  9: "No tokens available to release at this time.",
  10: "No schedule found for the given recipient.",
  11: "Schedule index is out of bounds.",
  12: "Batch schedules list is empty.",
  13: "Batch size exceeds the maximum of 50 entries.",
  14: "Cliff has already passed — cannot extend.",
  15: "New cliff must be later than the current cliff.",
  16: "New cliff must be before the end ledger.",
  17: "Recipient is not tracked by this contract.",
};

/**
 * Look up the user-facing message for a Soroban contract error.
 *
 * Parse an error string like `"Error(Contract, #7)"` or return a fallback
 * when the code is unknown or the error is not a contract error.
 */
export function describeContractError(
  err: unknown,
  errorMap: Record<number, string> = TokenErrorMessages,
): string {
  if (typeof err === "string") {
    const match = err.match(/Error\(Contract,\s*#(\d+)\)/);
    if (match) {
      const code = parseInt(match[1], 10);
      return errorMap[code] ?? `Unknown contract error (code ${code}).`;
    }
  }
  if (err instanceof Error) {
    const match = err.message.match(/Error\(Contract,\s*#(\d+)\)/);
    if (match) {
      const code = parseInt(match[1], 10);
      return errorMap[code] ?? `Unknown contract error (code ${code}).`;
    }
  }
  return "An unexpected error occurred.";
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
