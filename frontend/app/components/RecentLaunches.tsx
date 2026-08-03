"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useNetwork } from "../providers/NetworkProvider";
import { Loader2, TrendingUp, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { RecentToken } from "@/lib/recentTokens";
import { truncateAddress } from "@/lib/stellar";
import { EmptyState } from "@/components/ui/EmptyState";

function timeAgo(iso: string): string {
  if (!iso) return "";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function RecentLaunches() {
  const t = useTranslations("recentLaunches");
  const { networkConfig } = useNetwork();
  const [tokens, setTokens] = useState<RecentToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tokens/recent?network=${networkConfig.network}`,
      );
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setTokens(Array.isArray(data) ? data : []);

      const mercuryNote = res.headers.get("X-Note");
      if (mercuryNote && data.length === 0) {
        setError(null);
      }
    } catch {
      setError(t("error"));
    } finally {
      setLoading(false);
    }
  }, [networkConfig.network, t]);

  useEffect(() => {
    load();
  }, [load]);

  const maxScore = tokens.length
    ? Math.max(...tokens.map((t) => t.activityScore))
    : 0;
  const trendingThreshold = Math.max(5, Math.floor(maxScore * 0.6));

  return (
    <section className="relative mx-auto max-w-6xl px-6 pb-24">
      <div className="mb-10 text-center">
        <h2 className="text-3xl font-bold text-white">{t("title")}</h2>
        <p className="mt-2 text-sm text-gray-400">
          {t("description")}
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-stellar-400" />
        </div>
      )}

      {!loading && error && (
        <p className="text-center text-sm text-gray-500">{error}</p>
      )}

      {!loading && !error && tokens.length === 0 && (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          actionLabel={t("emptyAction")}
          actionHref="/deploy"
        />
      )}

      {!loading && !error && tokens.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {tokens.map((token) => (
            <Link
              key={token.contractId}
              href={`/dashboard/${token.contractId}`}
              className="glass-card group relative flex flex-col p-5 transition-all"
            >
              {token.activityScore >= trendingThreshold && (
                <span className="absolute right-4 top-4 flex items-center gap-1 rounded-full bg-stellar-500/15 px-2.5 py-0.5 text-xs font-medium text-stellar-300">
                  <TrendingUp className="h-3 w-3" />
                  {t("trending")}
                </span>
              )}

              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stellar-500/10 text-sm font-bold text-stellar-400">
                  {token.symbol.slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-white">
                    {token.name}
                  </h3>
                  <p className="text-xs text-gray-400">{token.symbol}</p>
                </div>
              </div>

              <div className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">{t("supply")}</span>
                  <span className="text-gray-300">{token.totalSupply}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t("contract")}</span>
                  <span className="font-mono text-xs text-gray-300">
                    {truncateAddress(token.contractId)}
                  </span>
                </div>
                {token.deployedAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">{t("deployed")}</span>
                    <span className="text-gray-300">
                      {timeAgo(token.deployedAt)}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-1 text-xs font-medium text-stellar-400 opacity-0 transition-opacity group-hover:opacity-100">
                {t("viewDashboard")}
                <ArrowRight className="h-3 w-3" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
