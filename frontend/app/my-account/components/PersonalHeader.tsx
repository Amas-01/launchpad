"use client";

import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { CopyButton } from "@/components/ui/CopyButton";
import { truncateAddress } from "@/lib/stellar";

export function PersonalHeader({
  publicKey,
  refreshing,
  onRefresh,
}: {
  publicKey: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations("myAccount");
  const tc = useTranslations("common");

  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold text-white">{t("title")}</h1>
        <div className="mt-2 flex items-center gap-2 text-sm text-gray-400">
          <span className="font-mono text-xs">
            <span className="hidden md:inline">{publicKey}</span>
            <span className="md:hidden">{truncateAddress(publicKey, 8)}</span>
          </span>
          <CopyButton value={publicKey} label={t("copyWalletAria")} />
        </div>
      </div>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="btn-secondary inline-flex items-center gap-2 self-start px-4 py-2 text-sm"
      >
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        {refreshing ? tc("refreshing") : tc("refresh")}
      </button>
    </div>
  );
}
