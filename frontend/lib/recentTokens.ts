import * as StellarSdk from "@stellar/stellar-sdk";
import { type NetworkConfig } from "../types/network";
import { fetchTokenInfo, type TokenInfo } from "./stellar";

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

// Fallback lookback when the RPC's actual retention window can't be probed
// (e.g. getHealth() unsupported or unreachable) — the previous fixed window.
const FALLBACK_LOOKBACK_LEDGERS = 17280; // ~24 hours at ~5s per ledger
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

/**
 * Resolve the oldest ledger the RPC can still serve events for, so the launch
 * feed can widen its lookback to the RPC's actual retention window instead of
 * a self-imposed 24h cutoff. Falls back to `FALLBACK_LOOKBACK_LEDGERS` behind
 * `latestLedger` when `getHealth` is unsupported or unreachable, so a launch
 * feed request never hard-fails on a probe failure.
 */
async function resolveStartLedger(
  rpc: StellarSdk.rpc.Server,
  latestLedger: number,
): Promise<number> {
  try {
    const health = await rpc.getHealth();
    if (typeof health.oldestLedger === "number" && health.oldestLedger > 0) {
      return Math.max(1, health.oldestLedger);
    }
  } catch {
    // getHealth unsupported/unreachable — degrade to the fixed fallback below.
  }
  return Math.max(1, latestLedger - FALLBACK_LOOKBACK_LEDGERS);
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
  const startLedger = await resolveStartLedger(rpc, latestLedger);

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

  // Sort by ledger descending *before* truncating, so a window with more than
  // MAX_CANDIDATES launches keeps the newest ones rather than whichever
  // MAX_CANDIDATES the RPC happened to return first.
  const candidates = Array.from(seen.entries())
    .sort(([, a], [, b]) => (b.ledger ?? 0) - (a.ledger ?? 0))
    .slice(0, MAX_CANDIDATES);
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

  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 5) {
    batches.push(ids.slice(i, i + 5));
  }

  // Batches are independent RPC calls — run them concurrently instead of one
  // round trip at a time, so a full candidate-set refresh is a single wave of
  // requests rather than four serial ones.
  const batchResults = await Promise.all(
    batches.map((batch) =>
      safeGetEvents(getEvents, {
        startLedger,
        filters: [{ type: "contract", contractIds: batch }],
        pagination: { limit: 1000 },
      }),
    ),
  );

  for (const events of batchResults) {
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
