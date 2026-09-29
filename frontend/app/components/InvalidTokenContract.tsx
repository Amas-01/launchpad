"use client";

import { AlertTriangle, ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export type InvalidTokenContractReason =
  | "not-a-contract"
  | "no-token-interface"
  | "unreachable";

interface InvalidTokenContractProps {
  contractId: string;
  /** Why the contract could not be rendered as a token. */
  reason?: InvalidTokenContractReason;
  /** Optional transport/RPC error message (used for the unreachable case). */
  error?: string;
}

export default function InvalidTokenContract({
  contractId,
  reason = "not-a-contract",
  error,
}: InvalidTokenContractProps) {
  const t = useTranslations("token.invalidContract");
  const truncatedId = contractId.length > 16
    ? `${contractId.slice(0, 8)}...${contractId.slice(-8)}`
    : contractId;

  const isUnreachable = reason === "unreachable";
  const isNoTokenInterface = reason === "no-token-interface";

  const errorMessage = error
    ? error
    : isUnreachable
      ? "We could not reach the Stellar RPC to verify this contract"
      : isNoTokenInterface
        ? "This contract does not implement the SEP-41 token standard"
        : "No contract exists at this address";

  return (
    <div className="mx-auto max-w-2x px-6 py-20 text-center animate-fade-in-up">
      <div className="glass-card p-8">
        <AlertTriangle className="mx-auto h-16 w-16 text-amber-400 mb-6" />

        <h1 className="text-2xl font-bold text-white mb-4">
          {isUnreachable ? t("unreachableTitle") : t("title")}
        </h1>

        <p className="text-gray-400 mb-6 leading-relaxed">
          {isUnreachable
            ? t("unreachableDescription", { contractId: truncatedId })
            : t("description", { contractId: truncatedId })}
        </p>

        <div className="bg-amber-400/10 border border-amber-400/20 rounded-lg p-4 mb-6">
          <p className="text-amber-200 text-sm">
            <strong>{t("errorLabel")}:</strong> {errorMessage}
          </p>
        </div>

        {!isUnreachable && (
          <div className="text-left space-y-3 mb-8">
            <h3 className="text-lg font-semibold text-white mb-3">
              {t("whatThisMeans")}
            </h3>
            <ul className="text-gray-400 space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-stellar-400 mt-1">•</span>
                {isNoTokenInterface ? t("notToken") : t("noContract")}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-stellar-400 mt-1">•</span>
                {t("missingMethods", { methods: "name(), symbol(), decimals()" })}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-stellar-400 mt-1">•</span>
                {t("differentStandard")}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-stellar-400 mt-1">•</span>
                {t("networkIssue")}
              </li>
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md border border-stellar-400/30 bg-stellar-400/10 px-4 py-2 text-sm font-medium text-stellar-300 transition-colors hover:bg-stellar-400/20"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToHome")}
          </Link>

          <a
            href={`${t("explorerBaseUrl")}/${contractId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-gray-600 bg-gray-700/50 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
          >
            <ExternalLink className="h-4 w-4" />
            {t("viewOnExplorer")}
          </a>
        </div>

        <div className="mt-8 pt-6 border-t border-white/10">
          <p className="text-xs text-gray-500">
            {t("footerNote")}
          </p>
        </div>
      </div>
    </div>
  );
}
