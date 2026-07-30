"use client";

import React, { useState, useCallback } from "react";
import { useWallet } from "@/app/hooks/useWallet";
import { useNetwork } from "@/app/providers/NetworkProvider";
import { AllowancesPanel } from "@/components/ui/AllowancesPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AlertCircle, Wallet, RefreshCw } from "lucide-react";
import type { AllowanceInfo } from "@/components/ui/AllowanceCard";
import {
  buildRevokeAllowanceTransaction,
  fetchApprovedSpendersFromEvents,
  fetchCurrentLedger,
  fetchTokenDecimals,
  fetchAllowanceWithExpiration,
  formatTokenAmount,
  submitTransaction,
} from "@/lib/stellar";

interface AllowancesPageProps {
  contractId?: string;
}

/**
 * AllowancesPage - Full page for managing token allowances
 * Can be integrated into dashboard or used as standalone page
 */
export function AllowancesPage({
  contractId: initialContractId,
}: AllowancesPageProps) {
  const { connected, publicKey, signTransaction, connect } = useWallet();
  const { networkConfig } = useNetwork();

  const [contractId, setContractId] = useState(initialContractId || "");
  const [allowances, setAllowances] = useState<AllowanceInfo[]>([]);
  const [isLoadingAllowances, setIsLoadingAllowances] = useState(false);
  const [allowancesError, setAllowancesError] = useState<string | null>(null);

  /**
   * Load allowances for a given contract and owner
   * NOTE: This is a placeholder - you'll need to implement actual RPC calls
   * to fetch allowances from the chain
   */
  const loadAllowances = useCallback(async () => {
    if (!contractId || !publicKey) {
      setAllowancesError("Both contract ID and wallet connection required");
      return;
    }

    setIsLoadingAllowances(true);
    setAllowancesError(null);

    try {
      const decimals = await fetchTokenDecimals(contractId, networkConfig);
      const [, spenders] = await Promise.all([
        fetchCurrentLedger(networkConfig),
        fetchApprovedSpendersFromEvents({
          contractId,
          ownerAddress: publicKey,
          config: networkConfig,
          maxPages: 5,
        }),
      ]);

      const results = await Promise.all(
        spenders.map(async (spenderAddress) => {
          const { amount, expirationLedger } = await fetchAllowanceWithExpiration(
            contractId,
            publicKey,
            spenderAddress,
            networkConfig,
          );

          const isExpired = amount <= BigInt(0);

          const allowance: AllowanceInfo = {
            spenderAddress,
            amount: amount.toString(),
            amountFormatted: formatTokenAmount(amount.toString(), decimals),
            expirationLedger: expirationLedger > 0 ? expirationLedger : undefined,
            isExpired,
          };

          return allowance;
        }),
      );

      setAllowances(results.filter((a) => a.amount !== "0"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load allowances";
      setAllowancesError(message);
    } finally {
      setIsLoadingAllowances(false);
    }
  }, [contractId, publicKey, networkConfig]);

  const handleRevokeAllowance = async (spenderAddress: string) => {
    if (!connected || !publicKey) {
      await connect();
      return;
    }

    const xdr = await buildRevokeAllowanceTransaction({
      tokenContractId: contractId,
      ownerAddress: publicKey,
      spenderAddress,
      config: networkConfig,
    });

    const signedXdr = await signTransaction(xdr);
    await submitTransaction(signedXdr, networkConfig);
    await loadAllowances();
  };

  const handleContractIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setContractId(e.target.value);
  };

  const handleLoadAllowances = () => {
    loadAllowances();
  };

  if (!publicKey) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="text-center space-y-3">
          <Wallet className="h-12 w-12 text-stellar-400 mx-auto" />
          <h2 className="text-2xl font-bold text-white">Connect Your Wallet</h2>
          <p className="text-gray-400">
            Please connect your wallet to manage allowances
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-10 mx-auto max-w-5xl min-h-[calc(100vh-10rem)]">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Token Allowances</h1>
        <p className="text-gray-400">
          Manage token approvals granted to other addresses or use allowances
          granted to you.
        </p>
      </div>

      {/* Contract ID Input */}
      <div
        className={`glass-card p-6 border border-white/10 ${contractId ? "border-stellar-600/50" : ""}`}
      >
        <label className="block text-sm font-medium text-gray-300 mb-3">
          Token Contract ID
        </label>
        <div className="flex gap-3">
          <Input
            value={contractId}
            onChange={handleContractIdChange}
            placeholder="C..."
            className="font-mono text-sm flex-1"
          />
          <Button
            onClick={handleLoadAllowances}
            disabled={!contractId || isLoadingAllowances}
            variant="secondary"
            className="flex items-center gap-2"
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoadingAllowances ? "animate-spin" : ""}`}
            />
            Load
          </Button>
        </div>
        {contractId && (
          <p className="text-xs text-gray-500 mt-2">
            Showing allowances for:{" "}
            <span className="font-mono">{contractId.slice(0, 16)}...</span>
          </p>
        )}
      </div>

      {/* Connection Status */}
      <div className="bg-blue-600/10 border border-blue-600/50 rounded-lg p-4">
        <p className="text-sm text-blue-300">
          <span className="font-mono">{publicKey.slice(0, 16)}...</span> —
          Connected on {networkConfig.network}
        </p>
      </div>

      {/* Network Warning */}
      {networkConfig.network === "mainnet" && (
        <div className="bg-yellow-600/10 border border-yellow-600/50 rounded-lg p-4">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-300">
                Mainnet Detected
              </p>
              <p className="text-xs text-yellow-200 mt-1">
                You are about to manage allowances on {networkConfig.network}.
                Please be careful with large allowances.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Panel */}
      {contractId ? (
        <AllowancesPanel
          tokenContractId={contractId}
          ownerAddress={publicKey}
          allowances={allowances}
          isLoadingAllowances={isLoadingAllowances}
          allowancesError={allowancesError}
          onRefreshAllowances={loadAllowances}
          onRevokeAllowance={handleRevokeAllowance}
        />
      ) : (
        <div className="glass-card p-12 border border-white/10 text-center">
          <AlertCircle className="h-10 w-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">
            Enter a token contract ID above to get started
          </p>
        </div>
      )}
    </div>
  );
}
