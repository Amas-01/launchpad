"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * On-chain state the admin console reads on mount and re-reads after the
 * actions that change it.
 *
 * Each of these was previously a ~30-line `useCallback` in `AdminPanel` that
 * built its own `rpc.Server`, its own dummy source account, and its own
 * transaction — five near-identical copies. They now share the one `read`
 * helper from `useAdminAction`.
 *
 * Every field degrades to a safe default when the getter is missing, so tokens
 * deployed against older WASM keep working: unknown lock state means unlocked,
 * unknown pause state means running, unknown flags mean off.
 */

export interface TokenAdminState {
  /** `revoke_admin` has been called — the contract is permanently immutable. */
  locked: boolean;
  /** The circuit breaker is engaged. */
  paused: boolean;
  /** Address of a proposed-but-not-yet-accepted admin. */
  pendingAdmin: string | null;
  /** Whale protection cap, as a percentage of total supply. */
  whaleCap: number | null;
  /** Configured compliance gating contract. */
  complianceNode: string | null;
  refreshPaused: () => Promise<void>;
  refreshPendingAdmin: () => Promise<void>;
  refreshWhaleCap: () => Promise<void>;
  refreshComplianceNode: () => Promise<void>;
  /** Set locally after a successful `revoke_admin`, without a re-read. */
  markLocked: () => void;
  setPaused: (paused: boolean) => void;
}

type ReadFn = (method: string) => Promise<unknown>;

/** Soroban `Option<Address>` decodes to a strkey string or an Address-like. */
function toAddressString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value) {
    return String(value);
  }
  return null;
}

export function useTokenAdminState(read: ReadFn): TokenAdminState {
  const [locked, setLocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pendingAdmin, setPendingAdmin] = useState<string | null>(null);
  const [whaleCap, setWhaleCap] = useState<number | null>(null);
  const [complianceNode, setComplianceNode] = useState<string | null>(null);

  const refreshLocked = useCallback(async () => {
    setLocked((await read("is_locked")) === true);
  }, [read]);

  const refreshPaused = useCallback(async () => {
    setPaused((await read("is_paused")) === true);
  }, [read]);

  const refreshPendingAdmin = useCallback(async () => {
    setPendingAdmin(toAddressString(await read("pending_admin")));
  }, [read]);

  const refreshWhaleCap = useCallback(async () => {
    const value = await read("max_balance_per_account");
    setWhaleCap(typeof value === "number" ? value : null);
  }, [read]);

  const refreshComplianceNode = useCallback(async () => {
    setComplianceNode(toAddressString(await read("compliance_node")));
  }, [read]);

  // Kick off the initial on-chain reads. These are async calls that setState
  // only after an awaited RPC round-trip, so this is a legitimate
  // fetch-on-mount effect rather than a cascading setState-in-effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch-on-mount effect, setState occurs after await
    refreshLocked();
    refreshPaused();
    refreshPendingAdmin();
    refreshWhaleCap();
    refreshComplianceNode();
  }, [
    refreshLocked,
    refreshPaused,
    refreshPendingAdmin,
    refreshWhaleCap,
    refreshComplianceNode,
  ]);

  const markLocked = useCallback(() => setLocked(true), []);

  return {
    locked,
    paused,
    pendingAdmin,
    whaleCap,
    complianceNode,
    refreshPaused,
    refreshPendingAdmin,
    refreshWhaleCap,
    refreshComplianceNode,
    markLocked,
    setPaused,
  };
}
