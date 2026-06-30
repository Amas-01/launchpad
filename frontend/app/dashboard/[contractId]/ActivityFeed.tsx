"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  ArrowRight,
  Loader2,
  ArrowLeftRight,
  Flame,
  Droplets,
  SnowflakeIcon,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserX,
  Upload,
} from "lucide-react";
import {
  type TokenActivityInfo,
} from "@/lib/stellar";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { useSoroban } from "@/hooks/useSoroban";
import { useContractEvents } from "@/hooks/useContractEvents";

export default function ActivityFeed({ accountId }: { accountId: string }) {
  const { fetchAccountOperations } = useSoroban();
  const { events: liveEvents } = useContractEvents(accountId, { intervalMs: 10000 });
  const [operations, setOperations] = useState<TokenActivityInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Use refs to avoid closure stale state in intervals
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = nextCursor;

  const performFetch = useCallback(
    async (isLoadMore = false, isRefresh = false) => {
      try {
        if (!isLoadMore && !isRefresh) setLoading(true);
        if (isLoadMore) setLoadingMore(true);

        const cursorToUse = isLoadMore ? cursorRef.current : undefined;
        // Note: for a true auto-refresh we might want to fetch without cursor and prepend new ones,
        // but for simplicity we'll just reload the first page if it's a refresh interval.
        const fetchCursor = isRefresh ? undefined : cursorToUse;

        const { records, nextCursor: newCursor } = await fetchAccountOperations(
          accountId,
          // networkConfig,
          fetchCursor ?? undefined,
          10,
        );

        if (isLoadMore) {
          setOperations((prev) => [...prev, ...records]);
        } else {
          // First load or Refresh
          // If refresh, we might want to smartly prepend, but replacing is simpler for pagination reset.
          // Actually, just leaving it be or updating if head is different is better UX.
          setOperations(records);
        }

        if (!isRefresh || isLoadMore) {
          setNextCursor(newCursor);
        }
        setError(null);
      } catch (err) {
        console.error(err);
        if (!isRefresh) {
          setError("Failed to fetch activity feed.");
        }
      } finally {
        if (!isLoadMore && !isRefresh) setLoading(false);
        if (isLoadMore) setLoadingMore(false);
      }
    },
    [accountId, fetchAccountOperations],
  );

  // Initial load
  useEffect(() => {
    performFetch();
  }, [performFetch]);

  // Auto-refresh using live events from the polling hook
  useEffect(() => {
    if (liveEvents.length > 0) {
      setOperations((prev: TokenActivityInfo[]) => {
        const existingIds = new Set(prev.map((op: TokenActivityInfo) => op.id));
        const newOps = liveEvents.filter((op: TokenActivityInfo) => !existingIds.has(op.id));
        if (newOps.length === 0) return prev;
        return [...newOps, ...prev];
      });
    }
  }, [liveEvents]);

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-stellar-400" />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-center text-sm text-red-400">{error}</div>;
  }

  if (operations.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-sm text-gray-500">
        No token activity found for this account/contract.
      </div>
    );
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "mint":
        return <Droplets className="h-4 w-4 text-blue-400" />;
      case "burn":
      case "clawback":
        return <Flame className="h-4 w-4 text-red-400" />;
      case "transfer":
        return <ArrowLeftRight className="h-4 w-4 text-green-400" />;
      case "freeze":
        return <SnowflakeIcon className="h-4 w-4 text-cyan-400" />;
      case "unfreeze":
        return <SnowflakeIcon className="h-4 w-4 text-teal-400" />;
      case "pause":
        return <PauseCircle className="h-4 w-4 text-yellow-400" />;
      case "unpause":
        return <PlayCircle className="h-4 w-4 text-green-400" />;
      case "authorize":
        return <ShieldCheck className="h-4 w-4 text-emerald-400" />;
      case "unauthorize":
        return <ShieldOff className="h-4 w-4 text-orange-400" />;
      case "set_admin":
        return <UserCheck className="h-4 w-4 text-stellar-400" />;
      case "revoke_admin":
        return <UserX className="h-4 w-4 text-red-400" />;
      case "upgrade":
        return <Upload className="h-4 w-4 text-purple-400" />;
      default:
        return <ArrowRight className="h-4 w-4 text-gray-400" />;
    }
  };

  const getTypeLabel = (type: string): string => {
    switch (type) {
      case "mint":          return "Mint";
      case "burn":          return "Burn";
      case "clawback":      return "Clawback";
      case "transfer":      return "Transfer";
      case "freeze":        return "Account frozen";
      case "unfreeze":      return "Account unfrozen";
      case "pause":         return "Token paused";
      case "unpause":       return "Token unpaused";
      case "authorize":     return "Authorized";
      case "unauthorize":   return "Unauthorize";
      case "set_admin":     return "Admin set";
      case "revoke_admin":  return "Admin revoked";
      case "upgrade":       return "Contract upgraded";
      default:              return "Other";
    }
  };

  const getStyleForType = (type: string) => {
    switch (type) {
      case "mint":
        return "text-blue-400 bg-blue-400/10 border-blue-400/20";
      case "burn":
      case "clawback":
      case "revoke_admin":
        return "text-red-400 bg-red-400/10 border-red-400/20";
      case "transfer":
      case "unpause":
      case "authorize":
        return "text-green-400 bg-green-400/10 border-green-400/20";
      case "freeze":
        return "text-cyan-400 bg-cyan-400/10 border-cyan-400/20";
      case "unfreeze":
        return "text-teal-400 bg-teal-400/10 border-teal-400/20";
      case "pause":
        return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20";
      case "unauthorize":
        return "text-orange-400 bg-orange-400/10 border-orange-400/20";
      case "set_admin":
        return "text-stellar-400 bg-stellar-400/10 border-stellar-400/20";
      case "upgrade":
        return "text-purple-400 bg-purple-400/10 border-purple-400/20";
      default:
        return "text-gray-400 bg-gray-400/10 border-gray-400/20";
    }
  };

  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 bg-white/5">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Type
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Amount
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                From
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                To
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Time
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Tx
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {operations.map((op, i) => (
              <tr
                key={`${op.id}-${i}`}
                className="transition-colors hover:bg-white/2"
              >
                <td className="px-4 py-3">
                  <div
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${getStyleForType(op.type)}`}
                  >
                    {getTypeIcon(op.type)}
                    {getTypeLabel(op.type)}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-white">
                  {op.amount !== "-" ? op.amount : "-"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-stellar-300">
                  {op.subject ? (
                    <ExplorerLink
                      type="account"
                      identifier={op.subject}
                      truncate={true}
                      truncateChars={5}
                      showCopy={false}
                    />
                  ) : op.from !== "-" ? (
                    <ExplorerLink
                      type="account"
                      identifier={op.from}
                      truncate={true}
                      truncateChars={5}
                      showCopy={false}
                    />
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-stellar-300">
                  {op.to !== "-" ? (
                    <ExplorerLink
                      type="account"
                      identifier={op.to}
                      truncate={true}
                      truncateChars={5}
                      showCopy={false}
                    />
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3 text-right text-xs text-gray-400">
                  {new Date(op.timestamp).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-3 text-right">
                  <ExplorerLink
                    type="tx"
                    identifier={op.txHash}
                    truncate={false}
                    showCopy={false}
                    displayText="View"
                    className="inline-flex items-center gap-1 rounded text-xs"
                    label="View transaction on Stellar Expert"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="border-t border-white/5 p-4 text-center">
          <button
            onClick={() => performFetch(true)}
            disabled={loadingMore}
            className="btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"
          >
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
