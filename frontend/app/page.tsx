"use client";

import { useTranslations } from "next-intl";
import { RecentLaunches } from "./components/RecentLaunches";

export default function Home() {
  const t = useTranslations("home");
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

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
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
