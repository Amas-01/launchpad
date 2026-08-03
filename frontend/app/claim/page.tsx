"use client";

import { useTranslations } from "next-intl";
import { ClaimVesting } from "./ClaimVesting";

export default function ClaimPage() {
  const t = useTranslations("claim");

  return (
    <section className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-2 text-3xl font-bold gradient-text">{t("title")}</h1>
      <p className="mb-10 text-gray-400">
        {t("description")}
      </p>
      <ClaimVesting />
    </section>
  );
}
