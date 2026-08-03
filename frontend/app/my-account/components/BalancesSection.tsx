"use client";

import { useTranslations } from "next-intl";
import { Loader2, AlertCircle } from "lucide-react";
import { BalanceCard } from "./BalanceCard";
import type { AccountBalance } from "@/lib/stellar";

export function BalancesSection({
  balances,
  loading,
  error,
  onRetry,
}: {
  balances: AccountBalance[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const t = useTranslations("myAccount");
  const tc = useTranslations("common");
  return (
    <section aria-label={t("tokenBalances")} className="mb-10">
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">
        {t("tokenBalances")}
      </h2>
      {loading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin text-stellar-400" />
        </div>
      ) : error ? (
        <div className="glass-card p-6 text-center">
          <AlertCircle className="mx-auto mb-2 h-8 w-8 text-red-400" />
          <p className="text-sm text-gray-400">{error}</p>
          <button
            onClick={onRetry}
            className="btn-secondary mt-3 px-4 py-1.5 text-sm"
          >
            {tc("retry")}
          </button>
        </div>
      ) : balances.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm text-gray-500">
          {t("noBalances")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {balances.map((bal) => (
            <BalanceCard
              key={`${bal.assetCode}-${bal.assetIssuer}`}
              assetCode={bal.assetCode}
              balance={bal.balance}
              assetIssuer={bal.assetIssuer}
            />
          ))}
        </div>
      )}
    </section>
  );
}
