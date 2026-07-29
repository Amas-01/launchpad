"use client";

import { useCallback, useEffect, useState } from "react";
import { addressToScVal } from "@/lib/soroban";

/**
 * Read `is_frozen` for a list of holders so the table can show frozen state
 * directly, instead of forcing the admin to probe one address at a time.
 *
 * Each address needs its own simulation, so calls run in small batches to
 * avoid opening a connection per holder on a large table. Failures degrade to
 * "not frozen" rather than blocking the table from rendering.
 */

/** Concurrent `is_frozen` simulations in flight at once. */
const BATCH_SIZE = 8;

type ReadFn = (method: string, args?: ReturnType<typeof addressToScVal>[]) => Promise<unknown>;

export function useFrozenAccounts(
  read: ReadFn,
  addresses: string[],
  /** Skip the reads entirely — e.g. for non-admin viewers. */
  enabled = true,
) {
  const [frozen, setFrozen] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  // Addresses arrive as a new array each render; key off the contents.
  const addressKey = addresses.join(",");

  const refresh = useCallback(async () => {
    const list = addressKey ? addressKey.split(",") : [];
    if (!enabled || list.length === 0) {
      setFrozen(new Set());
      return;
    }

    setIsLoading(true);
    try {
      const found = new Set<string>();
      for (let i = 0; i < list.length; i += BATCH_SIZE) {
        const batch = list.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map((address) => read("is_frozen", [addressToScVal(address)])),
        );
        results.forEach((value, index) => {
          if (value === true) found.add(batch[index]);
        });
      }
      setFrozen(found);
    } catch {
      // Best effort — an unreadable getter just means no badges.
    } finally {
      setIsLoading(false);
    }
  }, [addressKey, enabled, read]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { frozen, isLoading, refresh };
}
