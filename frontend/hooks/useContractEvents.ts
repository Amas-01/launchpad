import { useState, useEffect, useRef } from "react";
import * as StellarSdk from "@stellar/stellar-sdk";
import { useNetwork } from "@/app/providers/NetworkProvider";
import {
  type TokenActivityInfo,
  type TokenActivityType,
  toScVal,
  decodeString,
  decodeI128,
  decodeAddress,
  readEventTopics,
  readEventId,
  readEventTxHash,
  readEventLedger,
  readEventTimestamp,
} from "@/lib/stellar";

// All event topic names the hook subscribes to — mirrors TRACKED_EVENT_TOPICS in stellar.ts
const TRACKED_TOPICS = new Set([
  "transfer",
  "mint",
  "burn",
  "clawback",
  "freeze",
  "unfreeze",
  "pause",
  "unpause",
  "authorize",
  "unauthorize",
  "set_admin",
  "revoke_admin",
  "upgrade",
]);

interface UseContractEventsOptions {
  intervalMs?: number;
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

export function useContractEvents(
  contractId: string,
  options?: UseContractEventsOptions,
) {
  const { networkConfig } = useNetwork();
  const [events, setEvents] = useState<TokenActivityInfo[]>([]);
  const [error, setError] = useState<Error | null>(null);

  const startLedgerRef = useRef<number | null>(null);
  const intervalMs = options?.intervalMs ?? 10000;

  useEffect(() => {
    if (!contractId || !networkConfig?.rpcUrl) return;

    const rpc = new StellarSdk.rpc.Server(networkConfig.rpcUrl);
    const getEvents = (
      rpc as unknown as {
        getEvents?: (req: unknown) => Promise<{ events?: RpcEvent[] }>;
      }
    ).getEvents;

    if (!getEvents) {
      console.warn("getEvents is not available on this RPC server instance");
      return;
    }

    let isMounted = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isPolling = false;

    const safeGetEvents = async (startLedger: number) => {
      try {
        const response = await getEvents.call(rpc, {
          startLedger,
          filters: [{ type: "contract", contractIds: [contractId] }],
          pagination: { limit: 100 },
        });
        return response?.events ?? [];
      } catch (err) {
        console.error("Error polling getEvents:", err);
        return [];
      }
    };

    const poll = async () => {
      if (!isMounted || isPolling) return;
      isPolling = true;

      try {
        if (startLedgerRef.current === null) {
          const { sequence } = await rpc.getLatestLedger();
          startLedgerRef.current = sequence;
        }

        const rawEvents = await safeGetEvents(startLedgerRef.current);

        if (!isMounted) return;

        const newRecords: TokenActivityInfo[] = [];
        let maxLedgerSeen = startLedgerRef.current;

        for (const evt of rawEvents) {
          const evtLedger = readEventLedger(evt) || startLedgerRef.current;
          if (evtLedger > maxLedgerSeen) maxLedgerSeen = evtLedger;

          const topics = readEventTopics(evt);
          if (topics.length === 0) continue;

          const topic0 = toScVal(topics[0]);
          if (!topic0) continue;

          const typePath = decodeString(topic0);

          // Keep all tracked topics; label anything else as "other"
          const eventType: TokenActivityType = TRACKED_TOPICS.has(typePath)
            ? (typePath as TokenActivityType)
            : "other";

          const rawValue = (evt as { value?: unknown; data?: unknown }).value ??
            (evt as { data?: unknown }).data;
          const data = toScVal(rawValue as string | undefined);

          const record: TokenActivityInfo = {
            id: readEventId(evt, `${readEventTxHash(evt)}-${evtLedger}`),
            pagingToken: evt.pagingToken ?? "",
            type: eventType,
            amount: "-",
            from: "-",
            to: "-",
            txHash: readEventTxHash(evt),
            timestamp: readEventTimestamp(evt),
          };

          switch (typePath) {
            case "mint":
              if (data) record.amount = decodeI128(data);
              if (topics.length > 1) {
                const toVal = toScVal(topics[1]);
                if (toVal) record.to = decodeAddress(toVal);
              }
              break;

            case "burn":
            case "clawback":
              if (data) record.amount = decodeI128(data);
              if (topics.length > 1) {
                const fromVal = toScVal(topics[1]);
                if (fromVal) record.from = decodeAddress(fromVal);
              }
              break;

            case "transfer":
              if (data) record.amount = decodeI128(data);
              if (topics.length > 2) {
                const fromVal = toScVal(topics[1]);
                const toVal = toScVal(topics[2]);
                if (fromVal) record.from = decodeAddress(fromVal);
                if (toVal) record.to = decodeAddress(toVal);
              }
              break;

            case "freeze":
            case "unfreeze":
            case "authorize":
            case "unauthorize":
            case "set_admin":
            case "revoke_admin":
              if (topics.length > 1) {
                const addrVal = toScVal(topics[1]);
                if (addrVal) record.subject = decodeAddress(addrVal);
              }
              break;

            case "pause":
            case "unpause":
            case "upgrade":
              // no extra payload needed
              break;

            default:
              // unknown topic — kept as "other", no extra decoding
              break;
          }

          newRecords.push(record);
        }

        if (maxLedgerSeen >= startLedgerRef.current) {
          startLedgerRef.current = maxLedgerSeen + 1;
        }

        if (newRecords.length > 0) {
          setEvents((prev: TokenActivityInfo[]) => {
            const addedIds = new Set(prev.map((p: TokenActivityInfo) => p.id));
            const uniqueNew = newRecords.filter(
              (r: TokenActivityInfo) => !addedIds.has(r.id),
            );
            if (uniqueNew.length === 0) return prev;
            return [...uniqueNew.reverse(), ...prev];
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
  }, [contractId, networkConfig, intervalMs]);

  return { events, error };
}
