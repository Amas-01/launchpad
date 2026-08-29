"use client";

import { useState, useCallback } from "react";
import {
  Loader2,
  AlertCircle,
  Clock,
  Unlock,
  Lock,
  XCircle,
  CheckCircle,
} from "lucide-react";
import {
  formatTokenAmount,
  truncateAddress,
  buildRevokeTransaction,
  submitTransaction,
  type VestingScheduleInfo,
} from "@/lib/stellar";
import { VestingSolvencyBadge } from "@/components/VestingSolvencyBadge";
import {
  fetchVestingSolvency,
  type VestingSolvency,
} from "@/lib/vesting";
import { useNetwork } from "@/app/providers/NetworkProvider";
// import { CopyButton } from "@/components/ui/CopyButton";
import { useSoroban } from "@/hooks/useSoroban";
import { useWallet } from "@/app/hooks/useWallet";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ExplorerLink } from "@/components/ui/ExplorerLink";

// ---------------------------------------------------------------------------
// Vesting display (progress bars + timeline)
// ---------------------------------------------------------------------------

/**
 * Toast notification component for transaction feedback
 */
function Toast({
  type,
  message,
  onClose,
}: {
  type: "success" | "error";
  message: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex max-w-md items-start gap-3 rounded-lg border border-white/10 bg-void-900 p-4 shadow-2xl animate-slide-in-up"
      role="alert"
    >
      {type === "success" ? (
        <CheckCircle className="h-5 w-5 shrink-0 text-green-400" />
      ) : (
        <XCircle className="h-5 w-5 shrink-0 text-red-400" />
      )}
      <div className="flex-1">
        <p
          className={`text-sm font-medium ${type === "success" ? "text-green-400" : "text-red-400"}`}
        >
          {type === "success" ? "Success" : "Error"}
        </p>
        <p className="mt-1 text-sm text-gray-300">{message}</p>
      </div>
      <button
        onClick={onClose}
        className="text-gray-400 transition-colors hover:text-white"
        aria-label="Close notification"
      >
        <XCircle className="h-4 w-4" />
      </button>
    </div>
  );
}

function VestingDisplay({
  schedule,
  // The authoritative vested amount read directly from the contract's
  // `vested_amount` getter. This is what we show to the user.
  contractVestedAmount,
  currentLedger,
  decimals,
  vestingContractId,
  onRevoked,
}: {
  schedule: VestingScheduleInfo;
  contractVestedAmount: string;
  currentLedger: number;
  decimals: number;
  vestingContractId: string;
  onRevoked: () => void;
}) {
  const totalBig = BigInt(schedule.totalAmount);
  const releasedBig = BigInt(schedule.released);
  const vestedBig = BigInt(contractVestedAmount);

  // Wallet integration for admin actions
  const { connected, publicKey, signTransaction, connect } = useWallet();
  const { networkConfig } = useNetwork();

  // Revoke transaction state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  /**
   * Handle revoke action with proper security checks and user confirmation.
   *
   * Security considerations:
   * - Admin-only: Only the connected wallet matching the admin can revoke
   * - Confirmation required: User must explicitly confirm the irreversible action
   * - Transaction signing: All signing happens via Freighter wallet (no private keys in frontend)
   * - Error handling: Comprehensive error messages for all failure scenarios
   */
  const handleRevoke = useCallback(async () => {
    if (!connected || !publicKey) {
      setToast({ type: "error", message: "Please connect your wallet first" });
      return;
    }

    setIsRevoking(true);
    setShowConfirmDialog(false);

    try {
      // Build the revoke transaction
      const xdr = await buildRevokeTransaction(
        vestingContractId,
        schedule.recipient,
        publicKey,
        networkConfig,
      );

      // Sign with Freighter
      const signedXdr = await signTransaction(xdr, {
        networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
      });

      // Submit to network
      const txHash = await submitTransaction(signedXdr, networkConfig);

      setToast({
        type: "success",
        message: `Vesting schedule revoked successfully. Transaction: ${txHash.slice(0, 8)}...`,
      });

      // Refresh the schedule data
      setTimeout(() => {
        onRevoked();
      }, 2000);
    } catch (err) {
      console.error("[VestingDisplay] Revoke failed:", err);

      let errorMessage = "Failed to revoke vesting schedule";
      if (err instanceof Error) {
        if (err.message.includes("User declined")) {
          errorMessage = "Transaction was cancelled";
        } else if (err.message.includes("not initialized")) {
          errorMessage = "Contract not properly initialized";
        } else if (err.message.includes("require_auth")) {
          errorMessage = "You are not authorized to revoke this schedule";
        } else {
          errorMessage = err.message;
        }
      }

      setToast({ type: "error", message: errorMessage });
    } finally {
      setIsRevoking(false);
    }
  }, [
    connected,
    publicKey,
    signTransaction,
    networkConfig,
    vestingContractId,
    schedule.recipient,
    onRevoked,
  ]);

  // vestedBig comes from the contract — authoritative.
  const vestedPercent =
    totalBig > 0n ? Number((vestedBig * 10000n) / totalBig) / 100 : 0;
  const releasedPercent =
    totalBig > 0n ? Number((releasedBig * 10000n) / totalBig) / 100 : 0;

  // Timeline cursor position (0–100%).
  // Uses estimateVestedAmount from lib/vesting.ts for the visual cursor only —
  // this is a between-poll animation aid, not the displayed amount.
  const range = schedule.endLedger - schedule.cliffLedger;
  let timelinePos = 0;
  if (currentLedger >= schedule.endLedger) {
    timelinePos = 100;
  } else if (currentLedger > schedule.cliffLedger && range > 0) {
    timelinePos = ((currentLedger - schedule.cliffLedger) / range) * 100;
  }

  // Status label derived from the contract-authoritative vested amount.
  const statusLabel = schedule.revoked
    ? "Revoked"
    : currentLedger < schedule.cliffLedger
      ? "Cliff pending"
      : vestedBig >= totalBig
        ? "Fully vested"
        : "Vesting";

  const statusColor = schedule.revoked
    ? "text-red-400"
    : vestedBig >= totalBig
      ? "text-green-400"
      : "text-stellar-400";

  return (
    <div className="space-y-6">
      {/* Info cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="glass-card p-3">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Status
          </span>
          <p className={`mt-1 text-sm font-semibold ${statusColor}`}>
            {statusLabel}
          </p>
        </div>
        <div className="glass-card p-3">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Unlock %
          </span>
          <p className="mt-1 text-sm font-semibold text-white">
            {vestedPercent.toFixed(2)}%
          </p>
        </div>
        <div className="glass-card p-3">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Vested
          </span>
          <p className="mt-1 text-sm font-semibold text-white">
            {formatTokenAmount(contractVestedAmount, decimals)}
          </p>
        </div>
        <div className="glass-card p-3">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Released
          </span>
          <p className="mt-1 text-sm font-semibold text-white">
            {formatTokenAmount(schedule.released, decimals)}
          </p>
        </div>
      </div>

      {/* Vested progress bar */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
            <Unlock className="h-3 w-3" /> Vested
          </span>
          <span className="text-xs font-mono text-gray-500">
            {formatTokenAmount(contractVestedAmount, decimals)} /{" "}
            {formatTokenAmount(schedule.totalAmount, decimals)}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full border border-white/5 bg-void-800">
          <div
            className="h-full rounded-full bg-linear-to-r from-stellar-400 to-stellar-600 transition-all duration-700 ease-out shadow-[0_0_10px_rgba(45,125,255,0.3)]"
            style={{ width: `${Math.min(vestedPercent, 100)}%` }}
          />
        </div>
      </div>

      {/* Released progress bar */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
            <Lock className="h-3 w-3" /> Released
          </span>
          <span className="text-xs font-mono text-gray-500">
            {formatTokenAmount(schedule.released, decimals)} /{" "}
            {formatTokenAmount(schedule.totalAmount, decimals)}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full border border-white/5 bg-void-800">
          <div
            className="h-full rounded-full bg-linear-to-r from-green-500 to-green-400 transition-all duration-700 ease-out shadow-[0_0_10px_rgba(34,197,94,0.3)]"
            style={{ width: `${Math.min(releasedPercent, 100)}%` }}
          />
        </div>
      </div>

      {/* Timeline */}
      <div>
        <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-gray-400">
          <Clock className="h-3 w-3" /> Timeline
        </p>

        <div className="relative pb-8 pt-8">
          {/* Background track */}
          <div className="h-1.5 w-full rounded-full border border-white/5 bg-void-800" />

          {/* Filled portion — position is an estimate for animation only */}
          <div
            className="absolute left-0 top-8 h-1.5 rounded-full bg-linear-to-r from-stellar-500 to-stellar-400"
            style={{ width: `${timelinePos}%` }}
          />

          {/* Current position marker */}
          {currentLedger >= schedule.cliffLedger &&
            currentLedger < schedule.endLedger && (
              <div
                className="absolute flex flex-col items-center"
                style={{
                  left: `${timelinePos}%`,
                  top: 0,
                  transform: "translateX(-50%)",
                }}
              >
                <span className="whitespace-nowrap text-[10px] font-mono text-stellar-300">
                  L{currentLedger.toLocaleString()}
                </span>
                <div className="mt-0.5 h-3 w-0.5 bg-stellar-400" />
                <div className="h-3 w-3 rounded-full border-2 border-stellar-400 bg-void-900 shadow-[0_0_8px_rgba(45,125,255,0.5)]" />
              </div>
            )}

          {/* Cliff label */}
          <div className="absolute left-0 top-12 flex flex-col items-start">
            <div className="h-2 w-0.5 bg-gray-600" />
            <span className="mt-0.5 text-[10px] font-mono text-gray-500">
              Cliff: L{schedule.cliffLedger.toLocaleString()}
            </span>
          </div>

          {/* End label */}
          <div className="absolute right-0 top-12 flex flex-col items-end">
            <div className="ml-auto h-2 w-0.5 bg-gray-600" />
            <span className="mt-0.5 text-[10px] font-mono text-gray-500">
              End: L{schedule.endLedger.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Recipient */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>Recipient:</span>
        <ExplorerLink
          type="account"
          identifier={schedule.recipient}
          truncate={true}
          truncateChars={6}
          showCopy={true}
        />
        {schedule.revoked && <span className="text-red-400">(Revoked)</span>}
      </div>

      {/* Admin Actions */}
      {!schedule.revoked && (
        <div className="mt-6 border-t border-white/5 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-300">Admin Actions</p>
              <p className="mt-1 text-xs text-gray-500">
                Revoke this schedule to reclaim unvested tokens
              </p>
            </div>
            {!connected ? (
              <button
                onClick={connect}
                className="rounded-lg border border-stellar-500/30 bg-stellar-500/10 px-4 py-2 text-sm font-medium text-stellar-300 transition-colors hover:bg-stellar-500/20"
              >
                Connect Wallet
              </button>
            ) : (
              <button
                onClick={() => setShowConfirmDialog(true)}
                disabled={isRevoking}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isRevoking ? "Revoking..." : "Revoke Schedule"}
              </button>
            )}
          </div>
          {connected && (
            <p className="mt-2 text-xs text-gray-600">
              Connected: {truncateAddress(publicKey || "", 4)}
            </p>
          )}
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showConfirmDialog}
        title="Revoke Vesting Schedule"
        message={`Are you sure you want to revoke this vesting schedule for ${truncateAddress(schedule.recipient, 6)}? This action cannot be undone. Vested tokens will be sent to the recipient, and unvested tokens will be returned to the admin.`}
        confirmLabel="Revoke"
        cancelLabel="Cancel"
        onConfirm={handleRevoke}
        onCancel={() => setShowConfirmDialog(false)}
        loading={isRevoking}
        variant="danger"
      />

      {/* Toast Notification */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported component — lookup form + display
// ---------------------------------------------------------------------------

export default function VestingProgress({ decimals }: { decimals: number }) {
  const [vestingContract, setVestingContract] = useState("");
  const [recipient, setRecipient] = useState("");
  const [schedule, setSchedule] = useState<VestingScheduleInfo | null>(null);
  const [contractVestedAmount, setContractVestedAmount] = useState("0");
  const [currentLedger, setCurrentLedger] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fetchVestingSchedule, fetchVestedAmount, fetchCurrentLedger } = useSoroban();

  const lookup = useCallback(async () => {
    if (!vestingContract.trim() || !recipient.trim()) return;

    setLoading(true);
    setError(null);
    setSchedule(null);

    try {
      // Fetch schedule, the contract's authoritative vested amount, and the
      // current ledger in parallel — three calls total regardless of schedule count.
      const [sched, vested, ledger] = await Promise.all([
        fetchVestingSchedule(vestingContract.trim(), recipient.trim()),
        fetchVestedAmount(vestingContract.trim(), recipient.trim()),
        fetchCurrentLedger(),
      ]);
      setSchedule(sched);
      setContractVestedAmount(vested);
      setCurrentLedger(ledger);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch vesting schedule.",
      );
    } finally {
      setLoading(false);
    }
  }, [vestingContract, recipient, fetchCurrentLedger, fetchVestingSchedule, fetchVestedAmount]);

  return (
    <div className="space-y-4">
      {/* Lookup form */}
      <div className="glass-card space-y-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            Vesting Contract ID
          </label>
          <input
            type="text"
            value={vestingContract}
            onChange={(e) => setVestingContract(e.target.value)}
            placeholder="C… or G…"
            className="w-full rounded-lg border border-white/10 bg-void-800 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-stellar-500 focus:ring-1 focus:ring-stellar-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            Recipient Address
          </label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="G…"
            className="w-full rounded-lg border border-white/10 bg-void-800 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-stellar-500 focus:ring-1 focus:ring-stellar-500"
          />
        </div>
        <button
          onClick={lookup}
          disabled={loading || !vestingContract.trim() || !recipient.trim()}
          className="btn-primary w-full py-2 text-sm disabled:opacity-40"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </span>
          ) : (
            "Look Up Schedule"
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="glass-card flex items-start gap-3 p-4 text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Result */}
      {schedule && (
        <div className="glass-card p-4">
          <VestingDisplay
            schedule={schedule}
            contractVestedAmount={contractVestedAmount}
            currentLedger={currentLedger}
            decimals={decimals}
            vestingContractId={vestingContract.trim()}
            onRevoked={lookup}
          />
        </div>
      )}
    </div>
  );
}
// import { CopyButton } from "@/components/ui/CopyButton";
import { useSoroban } from "@/hooks/useSoroban";
import { useWallet } from "@/app/hooks/useWallet";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ExplorerLink } from "@/components/ui/ExplorerLink";

// ---------------------------------------------------------------------------
// Vesting display (progress bars + timeline)
// ---------------------------------------------------------------------------

/**
 * Toast notification component for transaction feedback
 */
function Toast({
  type,
  message,
  onClose,
}: {
  type: "success" | "error";
  message: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex max-w-md items-start gap-3 rounded-lg border border-white/10 bg-void-900 p-4 shadow-2xl animate-slide-in-up"
      role="alert"
    >
      {type === "success" ? (
        <CheckCircle className="h-5 w-5 shrink-0 text-green-400" />
      ) : (
        <XCircle className="h-5 w-5 shrink-0 text-red-400" />
      )}
      <div className="flex-1">
        <p
          className={`text-sm font-medium ${type === "success" ? "text-green-400" : "text-red-400"}`}
        >
          {type === "success" ? "Success" : "Error"}
        </p>
        <p className="mt-1 text-sm text-gray-300">{message}</p>
      </div>
      <button
        onClick={onClose}
        className="text-gray-400 transition-colors hover:text-white"
        aria-label="Close notification"
      >
        <XCircle className="h-4 w-4" />
      </button>
    </div>
  );
}

function VestingDisplay({
  schedule,
  currentLedger,
  decimals,
  vestingContractId,
  onRevoked,
}: {
  schedule: VestingScheduleInfo;
  currentLedger: number;
  decimals: number;
  vestingContractId: string;
  onRevoked: () => void;
}) {
  const totalBig = BigInt(schedule.totalAmount);
  const releasedBig = BigInt(schedule.released);

  // Wallet integration for admin actions
  const { connected, publicKey, signTransaction, connect } = useWallet();
  const { networkConfig } = useNetwork();

  // Revoke transaction state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  /**
   * Handle revoke action with proper security checks and user confirmation.
   *
   * Security considerations:
   * - Admin-only: Only the connected wallet matching the admin can revoke
   * - Confirmation required: User must explicitly confirm the irreversible action
   * - Transaction signing: All signing happens via Freighter wallet (no private keys in frontend)
   * - Error handling: Comprehensive error messages for all failure scenarios
   */
  const handleRevoke = useCallback(async () => {
    if (!connected || !publicKey) {
      setToast({ type: "error", message: "Please connect your wallet first" });
      return;
    }

    setIsRevoking(true);
    setShowConfirmDialog(false);

    try {
      // Build the revoke transaction
      const xdr = await buildRevokeTransaction(
        vestingContractId,
        schedule.recipient,
        publicKey,
        networkConfig,
      );

      // Sign with Freighter
      const signedXdr = await signTransaction(xdr, {
        networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
      });

      // Submit to network
      const txHash = await submitTransaction(signedXdr, networkConfig);

      setToast({
        type: "success",
        message: `Vesting schedule revoked successfully. Transaction: ${txHash.slice(0, 8)}...`,
      });

      // Refresh the schedule data
      setTimeout(() => {
        onRevoked();
      }, 2000);
    } catch (err) {
      console.error("[VestingDisplay] Revoke failed:", err);

      let errorMessage = "Failed to revoke vesting schedule";
      if (err instanceof Error) {
        if (err.message.includes("User declined")) {
          errorMessage = "Transaction was cancelled";
        } else if (err.message.includes("not initialized")) {
          errorMessage = "Contract not properly initialized";
        } else if (err.message.includes("require_auth")) {
          errorMessage = "You are not authorized to revoke this schedule";
        } else {
          errorMessage = err.message;
        }
      }

      setToast({ type: "error", message: errorMessage });
    } finally {
      setIsRevoking(false);
    }
  }, [
    connected,
    publicKey,
    signTransaction,
    networkConfig,
    vestingContractId,
    schedule.recipient,
    onRevoked,
  ]);

  // Replicate the contract's cliff + linear vesting formula
  let vestedBig: bigint;
  if (currentLedger < schedule.cliffLedger) {
    vestedBig = BigInt(0);
  } else if (currentLedger >= schedule.endLedger) {
    vestedBig = totalBig;
  } else {
    const elapsed = BigInt(currentLedger - schedule.cliffLedger);
    const duration = BigInt(schedule.endLedger - schedule.cliffLedger);
    vestedBig = (totalBig * elapsed) / duration;
  }

  const vestedPercent =
    totalBig > BigInt(0)
      ? Number((vestedBig * BigInt(10000)) / totalBig) / 100
      : 0;
  const releasedPercent =
    totalBig > BigInt(0)
      ? Number((releasedBig * BigInt(10000)) / totalBig) / 100
      : 0;

  // Timeline cursor position (0–100 %)
  const range = schedule.endLedger - schedule.cliffLedger;
  let timelinePos = 0;
  if (currentLedger >= schedule.endLedger) {
    timelinePos = 100;
  } else if (currentLedger > schedule.cliffLedger && range > 0) {
    timelinePos = ((currentLedger - schedule.cliffLedger) / range) * 100;
  }

  // Status label
  const statusLabel = schedule.revoked
    ? "Revoked"
    : currentLedger < schedule.cliffLedger
      ? "Cliff pending"
      : currentLedger >= schedule.endLedger
        ? "Fully vested"
        : "Vesting";

  const statusColor = schedule.revoked
    ? "text-red-400"
    : currentLedger >= schedule.endLedger
      ? "text-green-400"
      : "text-stellar-400";

  return (
    <div className="space-y-6">
      {/* Info cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="glass-card p-3">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Status
          </span>
          <p className={`mt-1 text-sm font-semibold ${statusColor}`}>
            {statusLabel}
          </p>
        </div>
        <div className="glass-card p-3">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Unlock %
          </span>
          <p className="mt-1 text-sm font-semibold text-white">
            {vestedPercent.toFixed(2)}%
          </p>
        </div>
        <div className="glass-card p-3">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Vested
          </span>
          <p className="mt-1 text-sm font-semibold text-white">
            {formatTokenAmount(vestedBig.toString(), decimals)}
          </p>
        </div>
        <div className="glass-card p-3">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Released
          </span>
          <p className="mt-1 text-sm font-semibold text-white">
            {formatTokenAmount(schedule.released, decimals)}
          </p>
        </div>
      </div>

      {/* Vested progress bar */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
            <Unlock className="h-3 w-3" /> Vested
          </span>
          <span className="text-xs font-mono text-gray-500">
            {formatTokenAmount(vestedBig.toString(), decimals)} /{" "}
            {formatTokenAmount(schedule.totalAmount, decimals)}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full border border-white/5 bg-void-800">
          <div
            className="h-full rounded-full bg-linear-to-r from-stellar-400 to-stellar-600 transition-all duration-700 ease-out shadow-[0_0_10px_rgba(45,125,255,0.3)]"
            style={{ width: `${Math.min(vestedPercent, 100)}%` }}
          />
        </div>
      </div>

      {/* Released progress bar */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
            <Lock className="h-3 w-3" /> Released
          </span>
          <span className="text-xs font-mono text-gray-500">
            {formatTokenAmount(schedule.released, decimals)} /{" "}
            {formatTokenAmount(schedule.totalAmount, decimals)}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full border border-white/5 bg-void-800">
          <div
            className="h-full rounded-full bg-linear-to-r from-green-500 to-green-400 transition-all duration-700 ease-out shadow-[0_0_10px_rgba(34,197,94,0.3)]"
            style={{ width: `${Math.min(releasedPercent, 100)}%` }}
          />
        </div>
      </div>

      {/* Timeline */}
      <div>
        <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-gray-400">
          <Clock className="h-3 w-3" /> Timeline
        </p>

        <div className="relative pb-8 pt-8">
          {/* Background track */}
          <div className="h-1.5 w-full rounded-full border border-white/5 bg-void-800" />

          {/* Filled portion */}
          <div
            className="absolute left-0 top-8 h-1.5 rounded-full bg-linear-to-r from-stellar-500 to-stellar-400"
            style={{ width: `${timelinePos}%` }}
          />

          {/* Current position marker */}
          {currentLedger >= schedule.cliffLedger &&
            currentLedger < schedule.endLedger && (
              <div
                className="absolute flex flex-col items-center"
                style={{
                  left: `${timelinePos}%`,
                  top: 0,
                  transform: "translateX(-50%)",
                }}
              >
                <span className="whitespace-nowrap text-[10px] font-mono text-stellar-300">
                  L{currentLedger.toLocaleString()}
                </span>
                <div className="mt-0.5 h-3 w-0.5 bg-stellar-400" />
                <div className="h-3 w-3 rounded-full border-2 border-stellar-400 bg-void-900 shadow-[0_0_8px_rgba(45,125,255,0.5)]" />
              </div>
            )}

          {/* Cliff label */}
          <div className="absolute left-0 top-12 flex flex-col items-start">
            <div className="h-2 w-0.5 bg-gray-600" />
            <span className="mt-0.5 text-[10px] font-mono text-gray-500">
              Cliff: L{schedule.cliffLedger.toLocaleString()}
            </span>
          </div>

          {/* End label */}
          <div className="absolute right-0 top-12 flex flex-col items-end">
            <div className="ml-auto h-2 w-0.5 bg-gray-600" />
            <span className="mt-0.5 text-[10px] font-mono text-gray-500">
              End: L{schedule.endLedger.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Recipient */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>Recipient:</span>
        <ExplorerLink
          type="account"
          identifier={schedule.recipient}
          truncate={true}
          truncateChars={6}
          showCopy={true}
        />
        {schedule.revoked && <span className="text-red-400">(Revoked)</span>}
      </div>

      {/* Admin Actions */}
      {!schedule.revoked && (
        <div className="mt-6 border-t border-white/5 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-300">Admin Actions</p>
              <p className="mt-1 text-xs text-gray-500">
                Revoke this schedule to reclaim unvested tokens
              </p>
            </div>
            {!connected ? (
              <button
                onClick={connect}
                className="rounded-lg border border-stellar-500/30 bg-stellar-500/10 px-4 py-2 text-sm font-medium text-stellar-300 transition-colors hover:bg-stellar-500/20"
              >
                Connect Wallet
              </button>
            ) : (
              <button
                onClick={() => setShowConfirmDialog(true)}
                disabled={isRevoking}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isRevoking ? "Revoking..." : "Revoke Schedule"}
              </button>
            )}
          </div>
          {connected && (
            <p className="mt-2 text-xs text-gray-600">
              Connected: {truncateAddress(publicKey || "", 4)}
            </p>
          )}
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showConfirmDialog}
        title="Revoke Vesting Schedule"
        message={`Are you sure you want to revoke this vesting schedule for ${truncateAddress(schedule.recipient, 6)}? This action cannot be undone. Vested tokens will be sent to the recipient, and unvested tokens will be returned to the admin.`}
        confirmLabel="Revoke"
        cancelLabel="Cancel"
        onConfirm={handleRevoke}
        onCancel={() => setShowConfirmDialog(false)}
        loading={isRevoking}
        variant="danger"
      />

      {/* Toast Notification */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported component — lookup form + display
// ---------------------------------------------------------------------------

export default function VestingProgress({ decimals }: { decimals: number }) {
  const [vestingContract, setVestingContract] = useState("");
  const [recipient, setRecipient] = useState("");
  const [schedule, setSchedule] = useState<VestingScheduleInfo | null>(null);
  const [solvency, setSolvency] = useState<
    VestingSolvency | null | undefined
  >();
  const [currentLedger, setCurrentLedger] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fetchVestingSchedule, fetchCurrentLedger } = useSoroban();
  const lookup = useCallback(async () => {
    if (!vestingContract.trim() || !recipient.trim()) return;

    setLoading(true);
    setError(null);
    setSchedule(null);
    setSolvency(undefined);

    try {
      const [sched, ledger, solvencyState] = await Promise.all([
        fetchVestingSchedule(vestingContract.trim(), recipient.trim()),
        fetchCurrentLedger(),
        fetchVestingSolvency(vestingContract.trim()),
      ]);
      setSchedule(sched);
      setCurrentLedger(ledger);
      setSolvency(solvencyState);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch vesting schedule.",
      );
    } finally {
      setLoading(false);
    }
  }, [vestingContract, recipient, fetchCurrentLedger, fetchVestingSchedule]);

  return (
    <div className="space-y-4">
      {/* Lookup form */}
      <div className="glass-card space-y-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            Vesting Contract ID
          </label>
          <input
            type="text"
            value={vestingContract}
            onChange={(e) => setVestingContract(e.target.value)}
            placeholder="C… or G…"
            className="w-full rounded-lg border border-white/10 bg-void-800 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-stellar-500 focus:ring-1 focus:ring-stellar-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            Recipient Address
          </label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="G…"
            className="w-full rounded-lg border border-white/10 bg-void-800 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-stellar-500 focus:ring-1 focus:ring-stellar-500"
          />
        </div>
        <button
          onClick={lookup}
          disabled={loading || !vestingContract.trim() || !recipient.trim()}
          className="btn-primary w-full py-2 text-sm disabled:opacity-40"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </span>
          ) : (
            "Look Up Schedule"
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="glass-card flex items-start gap-3 p-4 text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {solvency !== undefined && (
        <VestingSolvencyBadge solvency={solvency} decimals={decimals} />
      )}

      {/* Result */}
      {schedule && (
        <div className="glass-card p-4">
          <VestingDisplay
            schedule={schedule}
            currentLedger={currentLedger}
            decimals={decimals}
            vestingContractId={vestingContract.trim()}
            onRevoked={lookup}
          />
        </div>
      )}
    </div>
  );
}
