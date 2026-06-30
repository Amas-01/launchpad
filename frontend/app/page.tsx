"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import { Search, ArrowRight, AlertCircle } from "lucide-react";
import { RecentLaunches } from "./components/RecentLaunches";

const CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/;

export default function Home() {
  const t = useTranslations("home");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleLookup = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const val = query.trim();
      if (!val) {
        setError("Paste a contract ID to look it up.");
        return;
      }
      if (!CONTRACT_ID_REGEX.test(val)) {
        setError("That doesn't look like a valid Stellar contract ID (C + 55 base-32 chars).");
        return;
      }
      setError(null);
      router.push(`/token/${val}`);
    },
    [query, router],
  );

  return (
    <div className="relative overflow-hidden">
      {/* Background gradient orbs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-stellar-600/10 blur-[120px]" />
        <div className="absolute -right-40 top-40 h-[400px] w-[400px] rounded-full bg-stellar-400/5 blur-[100px]" />
      </div>

      {/* Hero */}
      <section className="relative mx-auto flex min-h-[85vh] max-w-5xl flex-col items-center justify-center px-6 text-center">
        <div className="animate-fade-in-up">
          <span className="mb-4 inline-block rounded-full border border-stellar-500/20 bg-stellar-500/5 px-4 py-1.5 text-xs font-medium tracking-wide text-stellar-300">
            {t("badge")}
          </span>

          <h1 className="mt-4 text-5xl font-extrabold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
            {t("title")}
            <br />
            <span className="gradient-text">{t("titleHighlight")}</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-400">
            {t("description")}
          </p>

          {/* Token lookup */}
          <form
            onSubmit={handleLookup}
            className="mx-auto mt-8 flex w-full max-w-xl flex-col gap-2"
            aria-label="Look up a token by contract ID"
          >
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 focus-within:border-stellar-500/50 focus-within:ring-1 focus-within:ring-stellar-500/30 transition-all">
              <Search className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Paste a contract ID to look up any token…"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-gray-500 focus:outline-none"
                aria-label="Token contract ID"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="submit"
                className="flex items-center gap-1 rounded-lg bg-stellar-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stellar-400 focus:outline-none focus:ring-2 focus:ring-stellar-500/50"
                aria-label="Look up token"
              >
                Look up
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            {error && (
              <p className="flex items-center gap-1.5 text-xs text-red-400" role="alert">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <a href="/deploy" className="btn-primary px-8 py-3 text-base">
              {t("deployButton")}
            </a>
            <a
              href="https://github.com/soropad/launchpad"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary px-8 py-3 text-base"
            >
              {t("githubButton")}
            </a>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="relative mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              icon: "🪙",
              title: t("features.deploy.title"),
              desc: t("features.deploy.description"),
            },
            {
              icon: "🔒",
              title: t("features.vesting.title"),
              desc: t("features.vesting.description"),
            },
            {
              icon: "📊",
              title: t("features.dashboard.title"),
              desc: t("features.dashboard.description"),
            },
          ].map((f) => (
            <div key={f.title} className="glass-card p-6">
              <span className="text-3xl">{f.icon}</span>
              <h3 className="mt-4 text-lg font-semibold text-white">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Launches */}
      <RecentLaunches />
    </div>
  );
}
