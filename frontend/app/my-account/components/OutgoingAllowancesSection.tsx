"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Shield, Trash2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { truncateAddress } from "@/lib/stellar";
import { useWallet } from "@/app/hooks/useWallet";
import { useSoroban } from "@/hooks/useSoroban";
import { useTransactionSimulator } from "@/hooks/useTransactionSimulator";
import { buildApproveTransaction, fetchTokenAllowance, fetchApprovedSpendersFromEvents } from "@/lib/stellar";
import { fromBaseUnits } from "@/lib/utils";

interface AllowanceItem {
  tokenContractId: string;
  tokenSymbol: string;
  spenderAddress: string;
  amount: string;
  expirationLedger: number;
  isExpired: boolean;
}

interface OutgoingAllowancesSectionProps {
  onRefresh?: () => void;
}

export function OutgoingAllowancesSection({ onRefresh }: OutgoingAllowancesSectionProps) {
  const t = useTranslations("myAccount");
  const tc = useTranslations("common");
  const { publicKey, signTransaction } = useWallet();
  const { networkConfig, submitTransaction, fetchCurrentLedger, fetchTokenInfo } = useSoroban();
  const simulator = useTransactionSimulator();

  const [tokenContractId, setTokenContractId] = useState("");
  const [allowances, setAllowances] = useState<AllowanceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingSpender, setRevokingSpender] = useState<string | null>(null);
  const [currentLedger, setCurrentLedger] = useState(0);

  const loadAllowances = useCallback(async () => {
    if (!publicKey || !tokenContractId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const [tokenInfo, ledger, spenders] = await Promise.all([
        fetchTokenInfo(tokenContractId.trim()),
        fetchCurrentLedger(),
        fetchApprovedSpendersFromEvents({
          contractId: tokenContractId.trim(),
          ownerAddress: publicKey,
          config: networkConfig,
          maxPages: 3,
        }),
      ]);
      setCurrentLedger(ledger);
      const allowancePromises = spenders.map(async (spender) => {
        try {
          const amount = await fetchTokenAllowance(tokenContractId.trim(), publicKey, spender, networkConfig);
          if (amount === BigInt(0)) return null;
          const formattedAmount = fromBaseUnits(amount, tokenInfo.decimals);
          return { tokenContractId: tokenContractId.trim(), tokenSymbol: tokenInfo.symbol, spenderAddress: spender, amount: formattedAmount, expirationLedger: ledger + 1000000, isExpired: false };
        } catch { return null; }
      });
      const results = await Promise.all(allowancePromises);
      setAllowances(results.filter((a): a is AllowanceItem => a !== null));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("allowanceError"));
    } finally { setLoading(false); }
  }, [publicKey, tokenContractId, networkConfig, fetchTokenInfo, fetchCurrentLedger, t]);

  useEffect(() => { if (tokenContractId.trim()) loadAllowances(); }, [tokenContractId, loadAllowances]);

  const handleRevoke = async (spenderAddress: string) => {
    if (!publicKey) return;
    setRevokingSpender(spenderAddress);
    setError(null);
    try {
      const checkResult = await simulator.checkRevokeAllowance(tokenContractId.trim(), publicKey, spenderAddress);
      if (!checkResult.success) throw new Error(checkResult.errors[0] || "Pre-flight check failed");
      const xdr = await buildApproveTransaction({ tokenContractId: tokenContractId.trim(), ownerAddress: publicKey, spenderAddress, amount: BigInt(0), expirationLedger: currentLedger + 100, config: networkConfig });
      const signedXdr = await signTransaction(xdr);
      await submitTransaction(signedXdr);
      await loadAllowances();
      onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("revokeError"));
    } finally { setRevokingSpender(null); }
  };

  return (
    <section aria-label={t("outgoingAllowances")} className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-gray-500 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            {t("outgoingAllowances")}
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            {t("outgoingAllowancesDesc")}
          </p>
        </div>
        {allowances.length > 0 && (
          <Button onClick={loadAllowances} disabled={loading} variant="secondary" className="h-8 px-3 text-xs">
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            {tc("refresh")}
          </Button>
        )}
      </div>

      <div className="glass-card p-6 space-y-4">
        <div>
          <label className="text-xs font-medium text-gray-400 uppercase mb-2 block">
            {t("allowanceContractLabel")}
          </label>
          <div className="flex gap-2">
            <Input
              value={tokenContractId}
              onChange={(e) => setTokenContractId(e.target.value)}
              placeholder={t("allowanceContractPlaceholder")}
              className="flex-1 font-mono text-sm bg-void-900 border-white/10"
            />
            <Button onClick={loadAllowances} disabled={loading || !tokenContractId.trim()} isLoading={loading} className="px-4">
              {t("loadAllowances")}
            </Button>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-400/10 border border-red-400/20 rounded-lg flex items-center gap-2 text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="animate-spin h-8 w-8 border-2 border-stellar-400 border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-sm text-gray-400">{t("loadingAllowances")}</p>
            </div>
          </div>
        )}

        {!loading && tokenContractId.trim() && allowances.length === 0 && (
          <EmptyState title={t("noAllowancesTitle")} description={t("noAllowancesDescription")} />
        )}

        {!loading && allowances.length > 0 && (
          <div className="space-y-2">
            {allowances.map((allowance) => (
              <div key={`${allowance.tokenContractId}-${allowance.spenderAddress}`} className="glass-card p-4 flex items-center justify-between gap-4 hover:border-stellar-400/20 transition-all">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-400 uppercase">{t("spenderLabel")}</span>
                    <code className="text-sm font-mono bg-black/20 px-2 py-0.5 rounded text-gray-300">{truncateAddress(allowance.spenderAddress, 6)}</code>
                  </div>
                  <div className="flex items-center gap-4">
                    <div>
                      <span className="text-xs text-gray-400">{t("amountLabel")}</span>
                      <p className="text-sm font-semibold text-white">{allowance.amount} {allowance.tokenSymbol}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">{t("statusLabel")}</span>
                      <p className={`text-sm font-medium ${allowance.isExpired ? "text-red-400" : "text-green-400"}`}>
                        {allowance.isExpired ? t("expired") : t("active")}
                      </p>
                    </div>
                  </div>
                </div>

                <Button onClick={() => handleRevoke(allowance.spenderAddress)} disabled={revokingSpender === allowance.spenderAddress || allowance.isExpired} isLoading={revokingSpender === allowance.spenderAddress} className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 transition-all shrink-0">
                  <Trash2 className="w-4 h-4 mr-1" />
                  {t("revoke")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
