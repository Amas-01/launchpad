"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AlertCircle, Trash2, Copy, Check } from "lucide-react";

interface Allowance {
  id: string;
  tokenContractId: string;
  spenderAddress: string;
  amount: string;
  expirationLedger: number;
  isExpired: boolean;
}

interface AllowanceListProps {
  contractId?: string;
  allowances?: Allowance[];
  isLoading?: boolean;
  currentLedger?: number;
  onRevoke?: (spenderId: string) => Promise<void>;
}

/**
 * AllowanceList - Display all active allowances for a token
 *
 * Shows:
 * - Spender address
 * - Approved amount
 * - Expiration status
 * - Actions to revoke
 */
export function AllowanceList({
  contractId,
  allowances = [],
  isLoading = false,
  currentLedger,
  onRevoke,
}: AllowanceListProps) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const ledgerToExpiryInfo = (expirationLedger: number): { date: string; countdown: string } | null => {
    if (currentLedger === undefined) return null;
    const ledgersRemaining = expirationLedger - currentLedger;
    const secondsRemaining = ledgersRemaining * 5;
    const expiryDate = new Date(Date.now() + secondsRemaining * 1000);
    const dateStr = expiryDate.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    if (ledgersRemaining <= 0) return { date: dateStr, countdown: "Expired" };
    const days = Math.floor(secondsRemaining / 86400);
    const hours = Math.floor((secondsRemaining % 86400) / 3600);
    const countdown = days > 0 ? `${days}d ${hours}h remaining` : `${hours}h remaining`;
    return { date: dateStr, countdown };
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleRevoke = async (id: string) => {
    if (!onRevoke) return;
    setRevoking(id);
    try {
      await onRevoke(id);
    } finally {
      setRevoking(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-stellar-400 border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-sm text-gray-400">Loading allowances...</p>
        </div>
      </div>
    );
  }

  if (allowances.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <AlertCircle className="h-8 w-8 text-gray-500 mx-auto mb-3" />
        <p className="text-gray-400">No active allowances</p>
        {contractId && (
          <p className="text-xs text-gray-500 mt-2">
            Grant allowances from the Grant tab or check back later.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {allowances.map((allowance) => (
        <div
          key={allowance.id}
          className={`glass-card p-4 transition-opacity ${
            allowance.isExpired ? "opacity-60" : ""
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0 space-y-2">
              {/* Spender Address */}
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase mb-1">
                  Spender
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono bg-black/20 px-2 py-1 rounded text-gray-300 truncate">
                    {allowance.spenderAddress}
                  </code>
                  <button
                    onClick={() =>
                      handleCopy(
                        allowance.spenderAddress,
                        `spender-${allowance.id}`,
                      )
                    }
                    className="p-1 hover:bg-white/10 rounded transition-colors"
                    title="Copy address"
                  >
                    {copied === `spender-${allowance.id}` ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                </div>
              </div>

              {/* Amount and Expiration */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase mb-1">
                    Amount
                  </p>
                  <p className="text-sm font-semibold text-white">
                    {allowance.amount}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase mb-1">
                    Status
                  </p>
                  <p
                    className={`text-sm font-medium ${
                      allowance.isExpired ? "text-red-400" : "text-green-400"
                    }`}
                  >
                    {allowance.isExpired ? "Expired" : "Active"}
                  </p>
                </div>
              </div>

              {/* Expiration Ledger */}
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase mb-1">
                  Expires at Ledger
                </p>
                <p className="text-sm text-gray-300">
                  {allowance.expirationLedger.toLocaleString()}
                </p>
                {ledgerToExpiryInfo(allowance.expirationLedger) && (() => {
                  const expiry = ledgerToExpiryInfo(allowance.expirationLedger)!;
                  return (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {expiry.date} &middot; {expiry.countdown}
                    </p>
                  );
                })()}
              </div>
            </div>

            {/* Revoke Button */}
            <div className="shrink-0">
              {onRevoke && (
                <Button
                  onClick={() => handleRevoke(allowance.id)}
                  disabled={revoking === allowance.id || allowance.isExpired}
                  className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 flex items-center gap-2 text-sm"
                >
                  {revoking === allowance.id ? (
                    <>
                      <div className="h-3 w-3 animate-spin border border-white border-t-transparent rounded-full" />
                      Revoking...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      {allowance.isExpired ? "Expired" : "Revoke"}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
