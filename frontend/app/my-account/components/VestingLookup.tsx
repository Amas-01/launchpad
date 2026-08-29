"use client";

import { useTranslations } from "next-intl";
import { Loader2, Search } from "lucide-react";

export function VestingLookup({
  vestingContractId,
  onChange,
  onLookup,
  loading,
  error,
}: {
  vestingContractId: string;
  onChange: (value: string) => void;
  onLookup: () => void;
  loading: boolean;
  error: string | null;
}) {
  const t = useTranslations("myAccount");

  return (
    <div className="glass-card p-5">
      <p className="mb-3 text-xs text-gray-400">
        {t("vestingLookupDescription")}
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={vestingContractId}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("vestingPlaceholder")}
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-gray-500 outline-none transition-colors focus:border-stellar-400/50 focus:ring-1 focus:ring-stellar-400/30"
        />
        <button
          onClick={onLookup}
          disabled={loading || !vestingContractId.trim()}
          className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          {t("vestingSchedules")}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
