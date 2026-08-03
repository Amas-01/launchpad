"use client";

import { useTranslations } from "next-intl";
import { useWallet } from "../hooks/useWallet";
import { CopyButton } from "@/components/ui/CopyButton";

/**
 * Truncate a Stellar public key for display: `GABC…WXYZ`.
 */
function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Navbar wallet button.
 *
 * - **Disconnected:** shows a "Connect Wallet" CTA.
 * - **Connected:** shows the truncated public key with a disconnect option.
 */
export function WalletButton() {
  const t = useTranslations("wallet");
  const { connected, publicKey, loading, connect, disconnect } = useWallet();

  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-2">
        {/* Truncated address badge */}
        <span
          className="rounded-lg border border-stellar-500/20 bg-stellar-500/10 px-3 py-1.5 font-mono text-xs text-stellar-300 flex items-center gap-2"
          title={publicKey}
        >
          {truncateAddress(publicKey)}
          <CopyButton value={publicKey} label={t("copyAddress")} />
        </span>

        {/* Disconnect button */}
        <button
          onClick={disconnect}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-red-500/30 hover:text-red-400"
        >
          {t("disconnect")}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={loading}
      className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? t("connectingEllipsis") : t("connect")}
    </button>
  );
}
