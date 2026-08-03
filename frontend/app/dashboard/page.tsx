"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search, User } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function DashboardIndex() {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [contractId, setContractId] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const trimmed = contractId.trim();
    if (!trimmed) {
      setError(t("errors.emptyContract"));
      return;
    }
    // Basic Soroban contract ID validation (56-char alphanumeric starting with C)
    if (!/^C[A-Z0-9]{55}$/.test(trimmed) && !/^G[A-Z2-7]{55}$/.test(trimmed)) {
      setError(t("errors.invalidFormat"));
      return;
    }

    setError("");
    router.push(`/dashboard/${trimmed}`);
  };

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-3xl flex-col items-center justify-center px-6 text-center">
      <span className="text-5xl">📊</span>
      <h1 className="mt-4 text-3xl font-bold text-white">{t("title")}</h1>
      <p className="mt-3 max-w-md text-gray-400">
        {t("description")}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 w-full max-w-lg">
        <div className="glass-card flex items-center gap-3 px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-gray-500" />
          <input
            type="text"
            value={contractId}
            onChange={(e) => {
              setContractId(e.target.value);
              if (error) setError("");
            }}
            placeholder={t("searchPlaceholder")}
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none"
            aria-label={t("searchLabel")}
            spellCheck={false}
            autoComplete="off"
          />
          <Button type="submit" className="shrink-0 px-4 py-2 text-sm">
            {t("sections.contractId")}
          </Button>
        </div>
        {error && (
          <p className="mt-2 text-left text-xs text-red-400">{error}</p>
        )}
      </form>

      <Link
        href="/my-account"
        className="mt-6 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
      >
        <User className="h-4 w-4" />
        {t("viewMyAccount")}
      </Link>
    </div>
  );
}
