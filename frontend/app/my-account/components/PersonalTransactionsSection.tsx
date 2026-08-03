"use client";

import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { PersonalActivityTable } from "./PersonalActivityTable";
import type { TokenActivityInfo } from "@/lib/stellar";

export function PersonalTransactionsSection({
  operations,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  publicKey,
}: {
  operations: TokenActivityInfo[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  publicKey: string;
}) {
  const t = useTranslations("myAccount");

  return (
    <section aria-label={t("transactionHistory")}>
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">
        {t("transactionHistory")}
      </h2>
      {loading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin text-stellar-400" />
        </div>
      ) : (
        <PersonalActivityTable
          operations={operations}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onLoadMore={onLoadMore}
          publicKey={publicKey}
        />
      )}
    </section>
  );
}
