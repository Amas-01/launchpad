"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, AlertCircle, FileQuestion } from "lucide-react";
import { truncateAddress } from "@/lib/stellar";

export function LoadingState() {
  const t = useTranslations("dashboard");
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <Loader2 className="h-8 w-8 animate-spin text-stellar-400" />
      <p className="text-sm text-gray-400">{t("fetching")}</p>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const t = useTranslations("common");
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <AlertCircle className="h-10 w-10 text-red-400" />
      <p className="max-w-md text-gray-400">{message}</p>
      <button onClick={onRetry} className="btn-secondary px-4 py-2 text-sm">
        {t("retry")}
      </button>
    </div>
  );
}

export function NotATokenState({ contractId }: { contractId: string }) {
  const t = useTranslations("dashboard");
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <FileQuestion className="h-12 w-12 text-amber-400" />
      <h2 className="text-xl font-bold text-white">{t("notATokenTitle")}</h2>
      <p className="max-w-md text-gray-400">
        {t("notATokenDesc", { contractId: truncateAddress(contractId) })}
      </p>
      <p className="text-sm text-gray-500">
        {t("notATokenNote")}
      </p>
      <Link
        href="/dashboard"
        className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:border-stellar-400/30 hover:bg-stellar-500/10 hover:text-stellar-300"
      >
        {t("backToSearchLink")}
      </Link>
    </div>
  );
}
