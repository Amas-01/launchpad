import { useState, useEffect, useRef } from "react";
import * as StellarSdk from "@stellar/stellar-sdk";
import { useNetwork } from "@/app/providers/NetworkProvider";
import {
  type ActivitySource,
  type TokenActivityInfo,
  decodeActivityEvent,
  readEventId,
  readEventLedger,
  readEventTimestamp,
  readEventTopics,
  readEventTxHash,
} from "@/lib/stellar";

interface UseContractEventsOptions {
  intervalMs?: number;
  /** Ledger of the newest event already loaded by the paged activity feed. */
  startLedger?: number;
  /** Delay polling until the paged activity feed has completed its first load. */
  enabled?: boolean;
  /**
   * Vesting contract to poll alongside the token, when the token has one.
   * Its events are decoded as vesting events and typed `vesting:*`.
   */
  vestingContractId?: string;
}

interface RpcEvent {
  id?: string;
  pagingToken?: string;
  contractId?: string;
  ledger?: number;
  ledgerClosedAt?: string;
  topic?: string[];
  value?: string;
  txHash?: string;
}

interface RpcEventPage {
  events?: RpcEvent[];
}

type GetEvents = (request: unknown) => Promise<RpcEventPage>;

/** Drain event pages without advancing past a saturated page. */
export async function collectContractEventPages(
  getEvents: GetEvents,
  rpc: unknown,
  startLedger: number,
  filters: unknown[],
  initialCursor?: string,
  maxPages = 20,
): Promise<{ events: RpcEvent[]; nextCursor?: string }> {
  const events: RpcEvent[] = [];
  let cursor = initialCursor;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await getEvents.call(rpc, {
      startLedger,
      filters,
      pagination: { limit: 100, ...(cursor ? { cursor } : {}) },
    });
    const pageEvents = response?.events ?? [];
    events.push(...pageEvents);

    if (pageEvents.length < 100) return { events };

    const nextCursor = pageEvents.at(-1)?.pagingToken;
    if (!nextCursor || nextCursor === cursor) {
      throw new Error("Saturated getEvents page did not advance its cursor");
    }
    cursor = nextCursor;
  }

  return { events, nextCursor: cursor };
}

/**
 * Poll a token contract — and optionally the vesting contract holding its
 * tokens — for new events.
 *
 * Both are polled in one subscription so the feed stays a single ordered
 * stream. Each event is decoded against the contract that emitted it, because
 * `init`, `pause`, `unpause`, `prop_adm`, `revoked` and `upgrade` are emitted
 * by both with identical topic tuples.
 */
export function useContractEvents(
  contractId: string,
  options?: UseContractEventsOptions,
) {
  const { networkConfig } = useNetwork();
  const [events, setEvents] = useState<TokenActivityInfo[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [droppedEventCount, setDroppedEventCount] = useState(0);

  const vestingContractId = options?.vestingContractId;
  const startLedgerRef = useRef<number | null>(null);
  const cursorRef = useRef<string | undefined>(undefined);
  const intervalMs = options?.intervalMs ?? 10000;
  const initialStartLedger = options?.startLedger;
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled || !contractId || !networkConfig?.rpcUrl) return;

    startLedgerRef.current = initialStartLedger ?? null;
    cursorRef.current = undefined;
    setEvents([]);
    setDroppedEventCount(0);

    /** Which contract an event came from, so the decoder can disambiguate. */
    const sourceOf = (id: string | undefined): ActivitySource =>
      vestingContractId && id === vestingContractId ? "vesting" : "token";

    const watchedIds = vestingContractId
      ? [contractId, vestingContractId]
      : [contractId];

    const rpc = new StellarSdk.rpc.Server(networkConfig.rpcUrl);
    const getEvents = (
      rpc as unknown as {
        getEvents?: GetEvents;
      }
    ).getEvents;

    if (!getEvents) {
      console.warn("getEvents is not available on this RPC server instance");
      return;
    }

    let isMounted = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isPolling = false;

    const poll = async () => {
      if (!isMounted || isPolling) return;
      isPolling = true;

      try {
        if (startLedgerRef.current === null) {
          const { sequence } = await rpc.getLatestLedger();
          startLedgerRef.current = sequence;
        }

        const pageResult = await collectContractEventPages(
          getEvents,
          rpc,
          startLedgerRef.current,
          [{ type: "contract", contractIds: watchedIds }],
          cursorRef.current,
        );
        const rawEvents = pageResult.events;

        if (!isMounted) return;

        const newRecords: TokenActivityInfo[] = [];
        let dropped = 0;
        let maxLedgerSeen = startLedgerRef.current;

        for (const evt of rawEvents) {
          const evtLedger = readEventLedger(evt) || startLedgerRef.current;
          if (evtLedger > maxLedgerSeen) maxLedgerSeen = evtLedger;

          const topics = readEventTopics(evt);
          if (topics.length === 0) {
            dropped += 1;
            continue;
          }

          const rawValue =
            (evt as { value?: unknown; data?: unknown }).value ??
            (evt as { data?: unknown }).data;

          // One decoder, shared with lib/stellar.ts. The duplicate switch that
          // used to live here is how the two drifted apart in the first place.
          const record = decodeActivityEvent(
            topics,
            rawValue as string | undefined,
            {
              id: readEventId(evt, `${readEventTxHash(evt)}-${evtLedger}`),
              txHash: readEventTxHash(evt),
              ledger: evtLedger,
              timestamp: readEventTimestamp(evt),
            },
            sourceOf(evt.contractId),
          );
          if (!record || record.type === "other") {
            dropped += 1;
            continue;
          }

          record.pagingToken = evt.pagingToken ?? "";

          newRecords.push(record);
        }

        cursorRef.current = pageResult.nextCursor;
        if (!pageResult.nextCursor && maxLedgerSeen >= startLedgerRef.current) {
          startLedgerRef.current = maxLedgerSeen + 1;
        }

        if (dropped > 0) setDroppedEventCount((count) => count + dropped);

        if (newRecords.length > 0) {
          setEvents((prev: TokenActivityInfo[]) => {
            const addedIds = new Set(prev.map((p: TokenActivityInfo) => p.id));
            const uniqueNew = newRecords.filter(
              (r: TokenActivityInfo) => !addedIds.has(r.id),
            );
            if (uniqueNew.length === 0) return prev;
            return [...uniqueNew, ...prev].sort(
              (a, b) =>
                (b.ledger ?? 0) - (a.ledger ?? 0) ||
                Date.parse(b.timestamp) - Date.parse(a.timestamp) ||
                b.id.localeCompare(a.id),
            );
          });
        }

        setError(null);
      } catch (err) {
        if (isMounted)
          setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        isPolling = false;
      }
    };

    poll();
    timerId = setInterval(poll, intervalMs);

    return () => {
      isMounted = false;
      if (timerId) clearInterval(timerId);
    };
  }, [contractId, vestingContractId, networkConfig, intervalMs, initialStartLedger, enabled]);

  return { events, error, droppedEventCount };
}
