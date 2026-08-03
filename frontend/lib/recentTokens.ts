import * as StellarSdk from "@stellar/stellar-sdk";
import { type NetworkConfig } from "../types/network";
import { fetchTokenInfo, type TokenInfo } from "./stellar";
import { LEDGERS_PER_DAY } from "./soroban";

export interface RecentToken extends TokenInfo {
  deployedAt: string;
  activityScore: number;
}

interface RpcEvent {
  contractId?: string;
  ledger?: number;
  ledgerClosedAt?: string;
  topic?: string[];
  value?: string;
}

const LOOKBACK_LEDGERS = LEDGERS_PER_DAY; // ~24 hours at ~5s per ledger
const MAX_CANDIDATES = 20;
const MAX_RESULTS = 12;

async function safeGetEvents(
  getEvents: (req: unknown) => Promise<unknown>,
  request: unknown,
): Promise<RpcEvent[]> {
  try {
    const response = await getEvents(request);
    const obj = (response ?? {}) as { events?: unknown[] };
    return Array.isArray(obj.events) ? (obj.events as RpcEvent[]) : [];
  } catch {
    return [];
  }
}

export async function fetchRecentTokens(
  config: NetworkConfig,
): Promise<RecentToken[]> {
  const rpc = new StellarSdk.rpc.Server(config.rpcUrl);
  const getEvents = (
    rpc as unknown as {
      getEvents?: (req: unknown) => Promise<unknown>;
    }
  ).getEvents;
  if (!getEvents) return [];

  const { sequence: latestLedger } = await rpc.getLatestLedger();
  const startLedger = Math.max(1, latestLedger - LOOKBACK_LEDGERS);

  const initTopic = StellarSdk.xdr.ScVal.scvSymbol("init").toXDR("base64");
  const initEvents = await safeGetEvents(getEvents, {
    startLedger,
    filters: [{ type: "contract", topics: [[initTopic]] }],
    pagination: { limit: 200 },
  });

  const seen = new Map<string, RpcEvent>();
  for (const evt of initEvents) {
    if (evt.contractId && !seen.has(evt.contractId)) {
      seen.set(evt.contractId, evt);
    }
  }

  const candidates = Array.from(seen.entries()).slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return [];

  const tokens: RecentToken[] = [];
  const settled = await Promise.allSettled(
    candidates.map(
      async ([contractId, evt]): Promise<RecentToken> => {
        const info = await fetchTokenInfo(contractId, config);
        return {
          ...info,
          deployedAt: evt.ledgerClosedAt ?? "",
          activityScore: 0,
        };
      },
    ),
  );

  for (const result of settled) {
    if (result.status === "fulfilled") {
      tokens.push(result.value);
    }
  }

  if (tokens.length === 0) return [];

  const ids = tokens.map((t) => t.contractId);
  const scores = new Map<string, number>();

  for (let i = 0; i < ids.length; i += 5) {
    const batch = ids.slice(i, i + 5);
    const events = await safeGetEvents(getEvents, {
      startLedger,
      filters: [{ type: "contract", contractIds: batch }],
      pagination: { limit: 1000 },
    });
    for (const evt of events) {
      if (evt.contractId) {
        scores.set(evt.contractId, (scores.get(evt.contractId) ?? 0) + 1);
      }
    }
  }

  for (const token of tokens) {
    token.activityScore = scores.get(token.contractId) ?? 0;
  }

  tokens.sort(
    (a, b) =>
      b.activityScore - a.activityScore ||
      b.deployedAt.localeCompare(a.deployedAt),
  );

  return tokens.slice(0, MAX_RESULTS);
}
