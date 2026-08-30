import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AirdropBuilder } from "./AirdropBuilder";

export const metadata: Metadata = {
  title: "Airdrop Builder — SoroPad",
  description:
    "Build a Merkle airdrop from a CSV of addresses and amounts, publish the root on chain, and export proofs for recipients.",
};

export default async function AirdropBuilderPage() {
  const t = await getTranslations("airdrop");

  return (
    <section className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="mb-2 text-3xl font-bold gradient-text">
        {t("builderTitle")}
      </h1>
      <p className="mb-10 text-gray-400">{t("builderDescription")}</p>
      <AirdropBuilder />
    </section>
  );
}
