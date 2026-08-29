"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useWallet } from "@/app/hooks/useWallet";
import { useSoroban } from "@/hooks/useSoroban";
import { useToast } from "@/app/providers/ToastProvider";
// import {
//     addressToScVal,
//     i128ToScVal
// } from "@/lib/soroban";
// import {
//     TransactionBuilder,
//     rpc,
//     Contract
// } from "@stellar/stellar-sdk";
import {
  Flame,
  CheckCircle2,
  ExternalLink,
  AlertTriangle,
  Wallet,
} from "lucide-react";

/* ── Constants ────────────────────────────────────────────────── */
// Removed hardcoded RPC_URL in favor of networkConfig from useSoroban

/* ── Validation Schemas ────────────────────────────────────────── */

const burnSchema = z.object({
  amount: z
    .string()
    .refine(
      (val) => !isNaN(Number(val)) && Number(val) > 0,
      "Amount must be positive",
    ),
});

type BurnData = z.infer<typeof burnSchema>;

/* ── UserPanel Component ───────────────────────────────────────── */

interface UserPanelProps {
  contractId: string;
  decimals: number;
}

export function UserPanel({ contractId, decimals }: UserPanelProps) {
  const t = useTranslations("userPanel");
  const { signTransaction, publicKey } = useWallet();
  const {
    fetchTokenBalance,
    buildBurnTransaction,
    submitTransaction,
    networkConfig,
  } = useSoroban();
  const toast = useToast();

  const [loading, setLoading] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>("0.00");
  const [fetchingBalance, setFetchingBalance] = useState(false);

  // Form
  const burnForm = useForm<BurnData>({ resolver: zodResolver(burnSchema) });

  useEffect(() => {
    if (!publicKey) return;

    let isMounted = true;
    setFetchingBalance(true);

    const loadBalance = async () => {
      try {
        const bal = await fetchTokenBalance(contractId, publicKey);
        if (isMounted) setBalance(bal);
      } catch (err) {
        console.error("Failed to load user balance:", err);
      } finally {
        if (isMounted) setFetchingBalance(false);
      }
    };

    loadBalance();

    return () => {
      isMounted = false;
    };
  }, [publicKey, contractId, fetchTokenBalance, success]);

  const handleBurn = async (data: BurnData) => {
    if (!publicKey) return;

    setLoading("burn");
    setSuccess(null);
    setLastTxHash(null);

    try {
      setLoading("burn");

      // Build Transaction
      const xdr = await buildBurnTransaction(
        contractId,
        publicKey,
        data.amount,
        decimals,
      );

      // Sign
      const signedTxXdr = await signTransaction(xdr, {
        networkPassphrase: networkConfig.passphrase,
      });

      if (!signedTxXdr) {
        throw new Error("Transaction signing failed or was cancelled");
      }

      // Submit
      const txHash = await submitTransaction(signedTxXdr);

      setLastTxHash(txHash);
      setSuccess("burn");

      burnForm.reset();
    } catch (err) {
      const error = err as Error;
      console.error(`burn failed:`, error);
      toast.show({
        title: t("burnFailed"),
        message: error.message,
        variant: "error",
      });
    } finally {
      setLoading(null);
    }
  };

  if (!publicKey) return null;

  return (
    <section className="mt-12 w-full max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between mb-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Wallet className="w-6 h-6 text-stellar-400" />
            <h2 className="text-2xl font-bold text-white tracking-tight">
              {t("yourDashboard")}
            </h2>
          </div>
          <p className="text-sm text-gray-400 mt-2">
            {t("balanceLabel", { balance: fetchingBalance ? t("loadingBalance") : balance })}
          </p>
        </div>
        {lastTxHash && (
          <a
            href={`https://stellar.expert/explorer/${networkConfig.network}/tx/${lastTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-stellar-400 hover:text-stellar-300 transition-colors bg-stellar-400/10 px-3 py-1.5 rounded-full border border-stellar-400/20"
          >
            {t("lastTx", { hash: lastTxHash.slice(0, 8) })}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">
        {/* ── Burn Form ─────────────────────────────────────── */}
        <div className="glass-card p-6 flex flex-col hover:border-red-500/30 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-6 text-red-400">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-red-500/10 rounded-lg group-hover:scale-110 transition-transform">
                <Flame className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg">{t("burnTitle")}</h3>
            </div>
          </div>

          <div className="mb-6 flex items-start gap-3 rounded-lg bg-red-500/10 p-3 text-red-400 border border-red-500/20">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-xs leading-relaxed">
              {t("burnWarning")}
            </p>
          </div>

          <form
            onSubmit={burnForm.handleSubmit(handleBurn)}
            className="space-y-4 grow"
          >
            <Input
              label={t("burnAmountLabel")}
              type="number"
              placeholder={t("burnAmountPlaceholder")}
              className="bg-white/5 border-white/10"
              {...burnForm.register("amount")}
              error={burnForm.formState.errors.amount?.message}
            />
            <Button
              type="submit"
              variant="secondary"
              className="w-full mt-4 border-red-500/20 hover:border-red-500/40 text-red-400"
              isLoading={loading === "burn"}
              disabled={!!loading}
            >
              {success === "burn" ? (
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> {t("burnSuccessful")}
                </span>
              ) : (
                t("burnButton")
              )}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
