"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import {
  truncateAddress,
  type TokenInfo,
  type TokenHolder,
  type SupplyBreakdown,
} from "@/lib/stellar";
import { useSoroban } from "@/hooks/useSoroban";
import VestingProgress from "./VestingProgress";
import TransactionHistory from "./TransactionHistory";
import SupplyBreakdownChart from "@/components/charts/SupplyBreakdownChart";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import ActivityFeed from "./ActivityFeed";
import { TransferPanel } from "./components/TransferPanel";
import { UserPanel } from "./components/UserPanel";
import { AdminPanel } from "./components/AdminPanel";
import { useWallet } from "@/app/hooks/useWallet";
import { HoldersTable, exportHoldersCsv } from "./components/HoldersTable";
import { InfoCard } from "./components/InfoCard";
import {
  ErrorState,
  LoadingState,
  NotATokenState,
} from "./components/DashboardUi";

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

export default function TokenDashboard({ contractId }: { contractId: string }) {
  const t = useTranslations("dashboard");
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [holders, setHolders] = useState<TokenHolder[]>([]);
  const [supplyBreakdown, setSupplyBreakdown] =
    useState<SupplyBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { publicKey } = useWallet();
  const { fetchTokenInfo, fetchTopHolders, fetchSupplyBreakdown } =
    useSoroban();
  console.log(tokenInfo);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const info = await fetchTokenInfo(contractId);
      setTokenInfo(info);

      // Attempt to load holders (best-effort for classic-wrapped assets)
      const holderData = await fetchTopHolders(contractId);
      setHolders(holderData);

      // Fetch supply breakdown
      try {
        const breakdown = await fetchSupplyBreakdown(contractId);
        setSupplyBreakdown(breakdown);
      } catch (supplyError) {
        console.error("Failed to fetch supply breakdown", supplyError);
        // Non-fatal for the dashboard – chart will simply be hidden.
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch token data. Please check the contract ID and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [contractId, fetchTokenInfo, fetchTopHolders, fetchSupplyBreakdown]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const isInvalidToken = error?.startsWith("Invalid token contract:") ?? false;

  if (loading) return <LoadingState />;
  if (isInvalidToken) return <NotATokenState contractId={contractId} />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;
  if (!tokenInfo) return null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 animate-fade-in-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">
          {tokenInfo.name}{" "}
          <span className="text-stellar-400">({tokenInfo.symbol})</span>
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-400">
          <span className="text-xs text-gray-500">
            {t("sections.contractId")}:
          </span>
          <ExplorerLink
            type="contract"
            identifier={contractId}
            truncate={true}
            truncateChars={8}
            showCopy={true}
          />
        </div>
      </div>

      {/* Token info grid */}
      <section aria-label={t("sections.tokenDetails")} className="mb-10">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">
          {t("sections.tokenDetails")}
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <InfoCard label="Name" value={tokenInfo.name} />
          <InfoCard label="Symbol" value={tokenInfo.symbol} />
          <InfoCard label="Decimals" value={String(tokenInfo.decimals)} />
          <InfoCard label="Total Supply" value={tokenInfo.totalSupply} />
          <InfoCard label="Circulating" value={tokenInfo.circulatingSupply} />
          <InfoCard
            label="Admin"
            value={truncateAddress(tokenInfo.admin)}
            copyValue={tokenInfo.admin}
            isAddress={true}
          />
          {tokenInfo.complianceNode && (
            <InfoCard
              label="Compliance Node"
              value={truncateAddress(tokenInfo.complianceNode)}
              copyValue={tokenInfo.complianceNode}
              isAddress={true}
            />
          )}
        </div>
      </section>

      {/* Metadata URI */}
      {tokenInfo.contractUri && (
        <section aria-label="Metadata URI" className="mb-10">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">
            Metadata
          </h2>
          <div className="glass-card flex flex-col gap-1 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
                URI
              </span>
            </div>
            <a
              href={tokenInfo.contractUri}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-lg font-semibold text-stellar-400 hover:text-stellar-300 transition-colors"
            >
              {tokenInfo.contractUri}
            </a>
          </div>
        </section>
      )}

      {/* User Actions Panel (Burn Tokens) */}
      <UserPanel contractId={contractId} decimals={tokenInfo.decimals} />

      {/* Admin Panel (Mint, Burn, Vesting, Transfer Admin) */}
      {publicKey && tokenInfo.admin === publicKey && (
        <AdminPanel
          contractId={contractId}
          maxSupply={tokenInfo.maxSupply}
          totalSupply={tokenInfo.totalSupply}
          decimals={tokenInfo.decimals}
        />
      )}

      {/* Supply Breakdown Chart */}
      {supplyBreakdown && (
        <section aria-label="Supply breakdown" className="mb-10">
          <SupplyBreakdownChart
            data={{
              circulating: supplyBreakdown.circulating,
              locked: supplyBreakdown.locked,
              burned: supplyBreakdown.burned,
              burnedAvailable: supplyBreakdown.burnedAvailable,
              total: supplyBreakdown.total,
            }}
            symbol={tokenInfo.symbol}
            decimals={tokenInfo.decimals}
          />
        </section>
      )}

      {/* Top holders */}
      <section aria-label={t("sections.topHolders")}>
        <div className="mb-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-gray-500">
            {t("sections.topHolders")}
          </h2>
        </div>
        <HoldersTable
          holders={holders}
          emptyMessage={
            contractId.startsWith("C")
              ? "This is a Soroban-native token, so Horizon cannot enumerate its holders."
              : "No holder data available."
          }
        />
      </section>

      {/* Vesting schedule */}
      <section aria-label={t("sections.vestingSchedule")} className="mt-10">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">
          {t("sections.vestingSchedule")}
        </h2>
        <VestingProgress decimals={tokenInfo.decimals} />
      </section>

      {/* Transaction History */}
      <section
        aria-label={t("sections.transactionHistory")}
        className="mt-16 border-t border-white/5 pt-10"
      >
        <TransactionHistory
          contractId={contractId}
          decimals={tokenInfo.decimals}
          symbol={tokenInfo.symbol}
        />
      </section>

      {/* Token Activity Feed */}
      <section aria-label={t("sections.tokenActivity")} className="mt-10">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">
          {t("sections.tokenActivity")}
        </h2>
        <ActivityFeed accountId={contractId} />
      </section>

      {/* Transfer Tokens Panel */}
      <TransferPanel
        contractId={contractId}
        tokenSymbol={tokenInfo.symbol}
        tokenDecimals={tokenInfo.decimals}
      />
    </div>
  );
}
