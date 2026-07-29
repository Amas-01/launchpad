import { type NetworkConfig } from "../types/network";
import * as StellarSdk from "@stellar/stellar-sdk";

const DEFAULT_MERCURY_BASE_URL_TESTNET =
  process.env.NEXT_PUBLIC_MERCURY_TESTNET_URL ??
  "https://testnet.mercurydata.app/rest";
const DEFAULT_MERCURY_BASE_URL_MAINNET =
  process.env.NEXT_PUBLIC_MERCURY_MAINNET_URL ??
  "https://mainnet.mercurydata.app/rest";
const DEFAULT_MERCURY_AUTH_TOKEN =
  process.env.NEXT_PUBLIC_MERCURY_AUTH_TOKEN ?? "";

export interface IndexedEvent {
  id: string;
  ledger: number;
  tx_hash: string;
  timestamp: string;
  topic: unknown[];
  value: unknown;
}

export interface FetchIndexedEventsResult {
  events: IndexedEvent[];
  nextCursor: string | null;
}

export function getMercuryConfig(
  config: NetworkConfig,
): { baseUrl: string; token: string } | null {
  const explicitBaseUrl = process.env.NEXT_PUBLIC_MERCURY_BASE_URL;
  const baseUrl =
    explicitBaseUrl ??
    (config.network === "mainnet"
      ? DEFAULT_MERCURY_BASE_URL_MAINNET
      : DEFAULT_MERCURY_BASE_URL_TESTNET);
  const token = DEFAULT_MERCURY_AUTH_TOKEN;

  if (!token) {
    return null;
  }

  return { baseUrl, token };
}

/**
 * Fetch events using Soroban RPC's native getEvents endpoint as a fallback
 * when Mercury indexer is not configured.
 */
async function fetchEventsFromRpc(
  contractId: string,
  config: NetworkConfig,
  options: {
    topics?: string[];
    cursor?: string;
    limit?: number;
  } = {},
): Promise<FetchIndexedEventsResult> {
  const { topics, cursor, limit = 200 } = options;
  
  const rpc = new StellarSdk.rpc.Server(config.rpcUrl);

  // Build filters for Soroban RPC getEvents
  const filters: StellarSdk.rpc.Api.EventFilter[] = [];

  if (topics && topics.length > 0) {
    for (const topic of topics) {
      filters.push({
        contractIds: [contractId],
        topics: [[topic]],
      });
    }
  } else {
    filters.push({
      contractIds: [contractId],
    });
  }

  // Parse cursor (format: "ledger-<sequence>") to derive startLedger.
  // GetEventsRequest uses a discriminated union: either startLedger OR cursor, never both.
  let startLedger: number | undefined;
  if (cursor) {
    const cursorParts = cursor.split("-");
    if (cursorParts.length === 2) {
      const parsed = parseInt(cursorParts[1], 10);
      if (!isNaN(parsed)) {
        startLedger = parsed;
      }
    }
  }

  // Fall back to latest ledger when no startLedger could be derived.
  if (startLedger === undefined) {
    const ledgerInfo = await rpc.getLatestLedger();
    startLedger = Math.max(1, ledgerInfo.sequence - 1000);
  }

  try {
    const response = await rpc.getEvents({
      filters,
      startLedger,
      limit,
    });

    const events: IndexedEvent[] = response.events.map((event) => {
      // Convert Soroban RPC event format to IndexedEvent format
      const topicStrings = event.topic.map((t) => 
        t.toXDR("base64")
      );
      
      return {
        id: event.id,
        ledger: event.ledger,
        tx_hash: event.txHash || "",
        timestamp: new Date(event.ledgerClosedAt || 0).toISOString(),
        topic: topicStrings,
        value: event.value?.toXDR("base64") ?? null,
      };
    });

    // Determine next cursor from the last event's ledger
    let nextCursor: string | null = null;
    if (events.length > 0) {
      const lastEvent = events[events.length - 1];
      nextCursor = `ledger-${lastEvent.ledger}`;
    }

    return { events, nextCursor };
  } catch (error) {
    console.error("Soroban RPC getEvents failed:", error);
    throw new Error(
      `Failed to fetch events from Soroban RPC: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function fetchIndexedEvents(
  contractId: string,
  config: NetworkConfig,
  options: {
    topics?: string[];
    cursor?: string;
    limit?: number;
  } = {},
): Promise<FetchIndexedEventsResult> {
  const mercury = getMercuryConfig(config);
  
  // If Mercury is not configured, use Soroban RPC fallback
  if (!mercury) {
    console.warn(
      "Mercury indexer not configured. Using Soroban RPC fallback (history may be limited to recent ledgers)."
    );
    return fetchEventsFromRpc(contractId, config, options);
  }

  const { topics, cursor, limit = 200 } = options;

  const searchParams = new URLSearchParams();
  searchParams.set("limit", String(limit));
  if (topics && topics.length > 0) {
    searchParams.set("topics", topics.join(","));
  }
  if (cursor) {
    searchParams.set("cursor", cursor);
  }

  const url = `${mercury.baseUrl}/events/by-contract/${contractId}?${searchParams.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${mercury.token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Mercury request failed (${response.status}): ${body || response.statusText}`,
    );
  }

  const json = (await response.json()) as unknown;

  let rawEvents: unknown[];
  const payload = json as { events?: unknown; data?: unknown; cursor?: unknown };
  if (Array.isArray(payload?.events)) {
    rawEvents = payload.events;
  } else if (Array.isArray(payload?.data)) {
    rawEvents = payload.data;
  } else if (Array.isArray(json)) {
    rawEvents = json as unknown[];
  } else {
    rawEvents = [];
  }

  const nextCursor = extractNextCursor(payload, rawEvents);

  const events = rawEvents.map((raw) => normalizeEvent(raw));

  return { events, nextCursor };
}

function extractNextCursor(
  payload: { cursor?: unknown; next_cursor?: unknown },
  events: unknown[],
): string | null {
  if (typeof payload.cursor === "string" && payload.cursor) {
    return payload.cursor;
  }
  if (typeof payload.next_cursor === "string" && payload.next_cursor) {
    return payload.next_cursor;
  }

  // Fall back to the id of the last event as a cursor
  if (events.length > 0) {
    const last = events[events.length - 1] as {
      id?: unknown;
      event_id?: unknown;
    };
    const lastId = last.id ?? last.event_id;
    if (typeof lastId === "string" && lastId) return lastId;
    if (typeof lastId === "number") return String(lastId);
  }

  return null;
}

function normalizeEvent(raw: unknown): IndexedEvent {
  const e = raw as Record<string, unknown>;

  const id =
    typeof (e.id ?? e.event_id) === "string"
      ? String(e.id ?? e.event_id)
      : typeof (e.id ?? e.event_id) === "number"
        ? String(e.id ?? e.event_id)
        : "";

  const ledger =
    typeof (e.ledger ?? e.ledger_seq ?? e.ledger_sequence ?? e.ledgerSequence) ===
    "number"
      ? Number(
          e.ledger ?? e.ledger_seq ?? e.ledger_sequence ?? e.ledgerSequence,
        )
      : Number(
          e.ledger ?? e.ledger_seq ?? e.ledger_sequence ?? e.ledgerSequence,
        ) || 0;

  const tx_hash =
    typeof (e.tx_hash ?? e.txHash ?? e.hash) === "string"
      ? String(e.tx_hash ?? e.txHash ?? e.hash)
      : "";

  const rawTs =
    e.timestamp ??
    e.ledger_timestamp ??
    e.ledgerTimestamp ??
    e.created_at ??
    e.createdAt;
  let timestamp: string;
  if (typeof rawTs === "string") {
    timestamp = rawTs;
  } else if (typeof rawTs === "number") {
    timestamp = new Date(rawTs * 1000).toISOString();
  } else {
    timestamp = new Date(0).toISOString();
  }

  const topic: unknown[] = Array.isArray(e.topic)
    ? e.topic
    : Array.isArray(e.topics)
      ? e.topics
      : [];

  const value = e.value ?? e.data ?? null;

  return { id, ledger, tx_hash, timestamp, topic, value };
}
