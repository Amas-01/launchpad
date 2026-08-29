"use client";

import React, { useState, useCallback } from "react";
import { ApproveForm } from "@/components/forms/ApproveForm";
import { RevokeAllowanceForm } from "@/components/forms/RevokeAllowanceForm";
import { TransferFromForm } from "@/components/forms/TransferFromForm";
import { AllowanceCard, type AllowanceInfo } from "@/components/ui/AllowanceCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useWallet } from "@/app/hooks/useWallet";
import { useNetwork } from "@/app/providers/NetworkProvider";
import {
  buildApproveTransaction,
  buildRevokeAllowanceTransaction,
  fetchApprovedSpendersFromEvents,
  fetchCurrentLedger,
  fetchTokenDecimals,
  fetchAllowanceWithExpiration,
  formatTokenAmount,
  submitTransaction,
} from "@/lib/stellar";
import { AlertCircle, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";

type TabType = "view" | "grant" | "revoke" | "transfer";

interface NotificationState {
  type: "success" | "error";
  message: string;
}

interface AllowanceManagerProps {
  contractId?: string;
}

/**
 * AllowanceManager - Complete allowance management interface
 *
 * Provides a tabbed interface for:
 * - Granting allowances to spenders
 * - Revoking existing allowances
 * - Transferring tokens using allowances
 */
export function AllowanceManager({ contractId: initialContractId }: AllowanceManagerProps) {
  const [activeTab, setActiveTab] = useState<TabType>("grant");
  const [notification, setNotification] = useState<NotificationState | null>(
    null,
  );

  const [viewContractId, setViewContractId] = useState(initialContractId || "");
  const [allowances, setAllowances] = useState<AllowanceInfo[]>([]);
  const [isLoadingAllowances, setIsLoadingAllowances] = useState(false);
  const [allowancesError, setAllowancesError] = useState<string | null>(null);
  const [revokingSpender, setRevokingSpender] = useState<string | null>(null);

  const { publicKey, signTransaction } = useWallet();
  const { networkConfig } = useNetwork();

  const loadAllowances = useCallback(async () => {
    const contractId = viewContractId || initialContractId;
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
  }, [viewContractId, initialContractId, publicKey, networkConfig]);

  const handleRevokeAllowance = async (spenderAddress: string) => {
    const contractId = viewContractId || initialContractId;
    if (!contractId || !publicKey) return;

    setRevokingSpender(spenderAddress);
    try {
      const xdr = await buildRevokeAllowanceTransaction({
        tokenContractId: contractId,
        ownerAddress: publicKey,
        spenderAddress,
        config: networkConfig,
      });

      const signedXdr = await signTransaction(xdr);
      await submitTransaction(signedXdr, networkConfig);
      await loadAllowances();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to revoke allowance";
      setAllowancesError(message);
    } finally {
      setRevokingSpender(null);
    }
  };

  const handleSuccess = (txHash: string, tab: TabType) => {
    const messages = {
      view: "",
      grant: "Allowance granted successfully!",
      revoke: "Allowance revoked successfully!",
      transfer: "Transfer completed successfully!",
    };

    setNotification({
      type: "success",
      message: `${messages[tab]} TX: ${txHash}`,
    });

    setTimeout(() => setNotification(null), 5000);
  };

  const handleError = (error: string) => {
    setNotification({
      type: "error",
      message: error,
    });

    setTimeout(() => setNotification(null), 5000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">Token Allowances</h1>
        <p className="text-sm text-gray-400">
          Manage SEP-41 token allowances. Grant spenders permission to transfer
          tokens on your behalf, or transfer tokens using allowances granted to
          you.
        </p>
      </div>

      {/* Notification */}
      {notification && (
        <div
          className={`flex items-center gap-3 p-4 rounded-lg border ${
            notification.type === "success"
              ? "bg-green-600/10 border-green-600/50"
              : "bg-red-600/10 border-red-600/50"
          }`}
        >
          {notification.type === "success" ? (
            <CheckCircle className="h-5 w-5 text-green-400 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
          )}
          <p
            className={
              notification.type === "success"
                ? "text-sm text-green-300"
                : "text-sm text-red-300"
            }
          >
            {notification.message}
          </p>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-white/10">
        <TabButton
          tab="view"
          label="View Allowances"
          active={activeTab === "view"}
          onClick={() => setActiveTab("view")}
        />
        <TabButton
          tab="grant"
          label="Grant Allowance"
          active={activeTab === "grant"}
          onClick={() => setActiveTab("grant")}
        />
        <TabButton
          tab="revoke"
          label="Revoke Allowance"
          active={activeTab === "revoke"}
          onClick={() => setActiveTab("revoke")}
        />
        <TabButton
          tab="transfer"
          label="Transfer From"
          active={activeTab === "transfer"}
          onClick={() => setActiveTab("transfer")}
        />
      </div>

      {/* Tab Content */}
      <div className="glass-card p-6">
        {activeTab === "view" && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <Input
                value={viewContractId}
                onChange={(e) => setViewContractId(e.target.value)}
                placeholder="C..."
                className="font-mono text-sm flex-1"
              />
              <Button
                onClick={loadAllowances}
                disabled={!viewContractId || isLoadingAllowances}
                className="flex items-center gap-2"
              >
                {isLoadingAllowances && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Load Allowances
              </Button>
            </div>

            {allowancesError && (
              <div className="flex items-center gap-3 p-4 bg-red-600/10 border border-red-600/50 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
                <p className="text-sm text-red-300">{allowancesError}</p>
              </div>
            )}

            {isLoadingAllowances && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-stellar-400" />
              </div>
            )}

            {!isLoadingAllowances && allowances.length === 0 && !allowancesError && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle className="h-8 w-8 text-gray-600" />
                <p className="text-sm font-medium text-gray-300 mt-3">No allowances</p>
                <p className="text-xs text-gray-500 mt-1">
                  Enter a contract ID above and click Load Allowances.
                </p>
              </div>
            )}

            {allowances.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {allowances.map((allowance) => (
                  <AllowanceCard
                    key={allowance.spenderAddress}
                    allowance={allowance}
                    onRevoke={handleRevokeAllowance}
                    isRevoking={revokingSpender === allowance.spenderAddress}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "grant" && (
          <ApproveForm
            onSuccess={(hash) => handleSuccess(hash, "grant")}
            onError={handleError}
          />
        )}

        {activeTab === "revoke" && (
          <RevokeAllowanceForm
            onSuccess={(hash) => handleSuccess(hash, "revoke")}
            onError={handleError}
          />
        )}

        {activeTab === "transfer" && (
          <TransferFromForm
            onSuccess={(hash) => handleSuccess(hash, "transfer")}
            onError={handleError}
          />
        )}
      </div>

      {/* Info Section */}
      <div className="rounded-lg bg-blue-600/10 border border-blue-600/50 p-4">
        <div className="flex gap-3">
          <AlertTriangle className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-blue-300">
              How allowances work:
            </p>
            <ul className="text-xs text-blue-200 space-y-1 list-disc list-inside">
              <li>
                <strong>Grant:</strong> Set the maximum amount a spender can
                transfer on your behalf
              </li>
              <li>
                <strong>Revoke:</strong> Remove a spender&apos;s ability to
                transfer your tokens
              </li>
              <li>
                <strong>Transfer From:</strong> Transfer tokens if you have an
                allowance from another address
              </li>
              <li>Allowances have an expiration ledger for security</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

interface TabButtonProps {
  tab: TabType;
  label: string;
  active: boolean;
  onClick: () => void;
}

function TabButton({ label, active, onClick }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 font-medium text-sm transition-colors ${
        active
          ? "text-stellar-400 border-b-2 border-stellar-400"
          : "text-gray-400 hover:text-gray-300 border-b-2 border-transparent"
      }`}
    >
      {label}
    </button>
  );
}
