"use client";

import { useTranslations } from "next-intl";

export default function Footer() {
  const t = useTranslations("footer");

  return (
    <footer
      role="contentinfo"
      className="border-t border-white/5 py-8 text-center text-sm text-gray-500"
    >
      <p>
        {t("builtFor")}{" "}
        <a
          href="https://www.drips.network/wave"
          className="text-stellar-400 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("stellarWave")}
        </a>{" "}
        · {t("license")}
      </p>
    </footer>
  );
}
