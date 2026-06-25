"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/app/providers/ToastProvider";
import { useWallet } from "@/app/hooks/useWallet";
import {
  fetchVestingInfo,
  buildReleaseTx,
  submitTx,
  formatTokenAmount,
  truncateAddress,
  type VestingInfo,
} from "@/lib/vesting";

/* ── Soroban contract-ID regex (56 chars starting with C) ──────────── */
const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

export function ClaimVesting() {
  const { connected, publicKey, connect, signTransaction } = useWallet();
  const toast = useToast();

  const [contractId, setContractId] = useState("");
  const [info, setInfo] = useState<VestingInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── Fetch vesting schedule ────────────────────────────────────────── */
  const handleLookup = useCallback(async () => {
    if (!connected || !publicKey) {
      toast.show({
        title: "Wallet Not Connected",
        message: "Connect your wallet first.",
        variant: "error",
      });
      return;
    }

    const trimmed = contractId.trim();
    if (!CONTRACT_ID_RE.test(trimmed)) {
      setError("Enter a valid Soroban contract ID (56 characters, starts with C).");
      return;
    }

    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      const vestingInfo = await fetchVestingInfo(trimmed, publicKey);
      setInfo(vestingInfo);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to fetch vesting info";
      if (msg.includes("no schedule found")) {
        setError("No vesting schedule found for your wallet on this contract.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, contractId]);

  /* ── Release unlocked tokens ───────────────────────────────────────── */
  const handleRelease = useCallback(async () => {
    if (!connected || !publicKey || !info) return;

    if (info.releasableAmount <= 0n) {
      toast.show({
        title: "No Tokens Available",
        message: "No tokens available to release right now.",
        variant: "error",
      });
      return;
    }

    setReleasing(true);
    try {
      const xdr = await buildReleaseTx(contractId.trim(), publicKey, publicKey);
      const signedXdr = await signTransaction(xdr);
      await submitTx(signedXdr);
      toast.show({
        title: "Success",
        message: "Tokens released successfully!",
        variant: "success",
      });

      // Refresh data
      const updated = await fetchVestingInfo(contractId.trim(), publicKey);
      setInfo(updated);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Release transaction failed";
      toast.show({
        title: "Release Failed",
        message: msg,
        variant: "error",
      });
    } finally {
      setReleasing(false);
    }
  }, [connected, publicKey, info, contractId, signTransaction]);

  /* ── Computed display values ───────────────────────────────────────── */
  const schedule = info?.schedule;
  const progressPct =
    schedule && schedule.totalAmount > 0n
      ? Number((info.vestedAmount * 100n) / schedule.totalAmount)
      : 0;

  /* ── Render ────────────────────────────────────────────────────────── */
  return (
    <>
      {/* ── Wallet gate ──────────────────────────────────────────────── */}
      {!connected && (
        <div className="glass-card p-8 text-center">
          <p className="mb-4 text-gray-400">
            Connect your Freighter wallet to view your vesting schedule.
          </p>
          <Button onClick={connect}>Connect Wallet</Button>
        </div>
      )}

      {/* ── Contract ID input ────────────────────────────────────────── */}
      {connected && (
        <div className="space-y-8">
          <div className="glass-card p-6">
            <label
              htmlFor="contractId"
              className="mb-2 block text-sm font-medium text-gray-300"
            >
              Vesting Contract ID
            </label>
            <div className="flex gap-3">
              <input
                id="contractId"
                type="text"
                value={contractId}
                onChange={(e) => {
                  setContractId(e.target.value);
                  setError(null);
                }}
                placeholder="CABC…XYZ (56 characters)"
                className="flex-1 rounded-xl border border-white/10 bg-void-800 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition-colors focus:border-stellar-400 focus:ring-1 focus:ring-stellar-400"
                aria-describedby={error ? "contract-error" : undefined}
              />
              <Button
                onClick={handleLookup}
                isLoading={loading}
                disabled={loading || !contractId.trim()}
              >
                Look Up
              </Button>
            </div>

            {error && (
              <p
                id="contract-error"
                className="mt-3 text-sm text-red-400"
                role="alert"
              >
                {error}
              </p>
            )}
          </div>

          {/* ── Vesting schedule details ──────────────────────────────── */}
          {info && schedule && (
            <div className="glass-card animate-fade-in-up space-y-6 p-6">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">
                  Your Vesting Schedule
                </h2>
                {schedule.revoked && (
                  <span className="rounded-lg bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400">
                    Revoked
                  </span>
                )}
              </div>

              {/* Progress bar */}
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-gray-400">Vesting Progress</span>
                  <span className="font-medium text-stellar-400">
                    {progressPct}%
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-void-700">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-stellar-400 to-stellar-600 transition-all duration-500"
                    style={{ width: `${Math.min(progressPct, 100)}%` }}
                    role="progressbar"
                    aria-valuenow={progressPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Vesting progress"
                  />
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-4">
                <StatCard
                  label="Total Allocation"
                  value={formatTokenAmount(schedule.totalAmount)}
                />
                <StatCard
                  label="Vested So Far"
                  value={formatTokenAmount(info.vestedAmount)}
                />
                <StatCard
                  label="Already Released"
                  value={formatTokenAmount(schedule.released)}
                />
                <StatCard
                  label="Available to Claim"
                  value={formatTokenAmount(info.releasableAmount)}
                  highlight
                />
              </div>

              {/* Schedule metadata */}
              <div className="space-y-2 rounded-xl border border-white/5 bg-void-800/50 p-4 text-sm">
                <DetailRow
                  label="Recipient"
                  value={truncateAddress(schedule.recipient)}
                />
                <DetailRow
                  label="Cliff Ledger"
                  value={schedule.cliffLedger.toLocaleString()}
                />
                <DetailRow
                  label="End Ledger"
                  value={schedule.endLedger.toLocaleString()}
                />
                <DetailRow
                  label="Current Ledger"
                  value={info.currentLedger.toLocaleString()}
                />
              </div>

              {/* Release button */}
              <Button
                onClick={handleRelease}
                isLoading={releasing}
                disabled={
                  releasing ||
                  info.releasableAmount <= 0n ||
                  schedule.revoked
                }
                className="w-full"
                aria-label={`Release ${formatTokenAmount(info.releasableAmount)} vested tokens`}
              >
                {schedule.revoked
                  ? "Schedule Revoked"
                  : info.releasableAmount <= 0n
                    ? "No Tokens to Release"
                    : `Release ${formatTokenAmount(info.releasableAmount)} Tokens`}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ── Small sub-components ──────────────────────────────────────────── */

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-void-800/50 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold ${
          highlight ? "text-stellar-400" : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-mono text-gray-300">{value}</span>
    </div>
  );
}
