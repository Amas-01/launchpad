"use client";

import { useTranslations } from "next-intl";
import { ArrowUpRight, ArrowLeftRight, Flame, Droplets, Loader2, ArrowRight } from "lucide-react";
import { truncateAddress, type TokenActivityInfo } from "@/lib/stellar";

export function PersonalActivityTable({
  operations,
  loadingMore,
  hasMore,
  onLoadMore,
  publicKey,
}: {
  operations: TokenActivityInfo[];
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  publicKey: string;
}) {
  const t = useTranslations("myAccount");
  const tc = useTranslations("common");

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "mint": return <Droplets className="h-4 w-4 text-blue-400" />;
      case "burn": return <Flame className="h-4 w-4 text-red-400" />;
      case "transfer": return <ArrowLeftRight className="h-4 w-4 text-green-400" />;
      default: return <ArrowRight className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStyleForType = (type: string) => {
    switch (type) {
      case "mint": return "text-blue-400 bg-blue-400/10 border-blue-400/20";
      case "burn": return "text-red-400 bg-red-400/10 border-red-400/20";
      case "transfer": return "text-green-400 bg-green-400/10 border-green-400/20";
      default: return "text-gray-400 bg-gray-400/10 border-gray-400/20";
    }
  };

  const getDirection = (op: TokenActivityInfo) => {
    if (op.type !== "transfer") return null;
    if (op.from === publicKey) return "Sent";
    if (op.to === publicKey) return "Received";
    return null;
  };

  if (operations.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-sm text-gray-500">
        No personal transaction history found.
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table" aria-label="Personal transaction history">
          <thead>
            <tr className="border-b border-white/5 bg-white/5">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Direction</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">{tc("amount")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Counterparty</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Time</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Tx</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {operations.map((op, i) => {
              const direction = getDirection(op);
              const counterparty = op.from === publicKey ? op.to : op.from;
              return (
                <tr key={`${op.id}-${i}`} className="transition-colors hover:bg-white/2">
                  <td className="px-4 py-3">
                    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${getStyleForType(op.type)}`}>
                      {getTypeIcon(op.type)}
                      {op.type}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {direction && (
                      <span className={`text-xs font-medium ${direction === "Sent" ? "text-red-400" : "text-green-400"}`}>{direction}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-white">{op.amount !== "-" ? op.amount : "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-stellar-300">
                    {counterparty && counterparty !== "-" ? (
                      <span title={counterparty}>{truncateAddress(counterparty, 5)}</span>
                    ) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-400">
                    {new Date(op.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a href={`https://stellar.expert/explorer/testnet/tx/${op.txHash}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded text-xs text-stellar-400 hover:text-stellar-300 hover:underline" title="View on Stellar Expert">
                      View<ArrowUpRight className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="border-t border-white/5 p-4 text-center">
          <button onClick={onLoadMore} disabled={loadingMore} className="btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm">
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            {loadingMore ? tc("loading") : tc("loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
