"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { PendingAdminBanner } from "@/components/PendingAdminBanner";
import { VestingSolvencyBadge } from "@/components/VestingSolvencyBadge";
import { useToast } from "@/app/providers/ToastProvider";
import { useWallet } from "@/app/hooks/useWallet";
import {
  fetchVestingAdminState,
  fetchAllVestingSchedules,
  fetchVestingInfo,
  fetchVestingSolvency,
  buildReleaseTx,
  buildReleaseAllTx,
  submitTx,
  formatTokenAmount,
  type VestingAdminState,
  type VestingInfo,
  type VestingSolvency,
} from "@/lib/vesting";

/* ── Soroban contract-ID regex (56 chars starting with C) ──────────── */
const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

export function ClaimVesting() {
  const t = useTranslations("claim");
  const tc = useTranslations("common");
  const { connected, publicKey, connect, signTransaction } = useWallet();
  const toast = useToast();

  const [contractId, setContractId] = useState("");
  // One VestingInfo entry per schedule index
  const [schedules, setSchedules] = useState<VestingInfo[]>([]);
  const [adminState, setAdminState] = useState<VestingAdminState | null>(null);
  const [solvency, setSolvency] = useState
    VestingSolvency | null | undefined
  >();
  const [loading, setLoading] = useState(false);
  // Track which schedule index is currently releasing
  const [releasingIndex, setReleasingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ── Fetch all vesting schedules ───────────────────────────────────── */
  const handleLookup = useCallback(async () => {
    if (!connected || !publicKey) {
      toast.show({
        title: t("walletNotConnected"),
        message: t("walletNotConnectedMessage"),
        variant: "error",
      });
      return;
    }

    const trimmed = contractId.trim();
    if (!CONTRACT_ID_RE.test(trimmed)) {
      setError(t("invalidContractId"));
      return;
    }

    setError(null);
    setSchedules([]);
    setAdminState(null);
    setSolvency(undefined);
    setLoading(true);

    try {
      // Use get_all_schedules (single contract call, not N+1) + admin/solvency state
      const [allSchedules, vestingAdmin, solvencyState] = await Promise.all([
        fetchAllVestingSchedules(trimmed, publicKey),
        fetchVestingAdminState(trimmed),
        fetchVestingSolvency(trimmed),
      ]);
      setAdminState(vestingAdmin);
      setSolvency(solvencyState);

      if (allSchedules.length === 0) {
        if (
          vestingAdmin.pendingAdmin === publicKey ||
          vestingAdmin.admin === publicKey
        ) {
          setError(null);
        } else {
          setError("No vesting schedule found for your wallet on this contract.");
        }
        return;
      }

      // Build VestingInfo for each schedule
      const infos: VestingInfo[] = await Promise.all(
        allSchedules.map((_, i) =>
          fetchVestingInfo(trimmed, publicKey, i),
        ),
      );
      setSchedules(infos);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to fetch vesting info";
      if (msg.includes("no schedule found")) {
        setError(t("noSchedule"));
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, contractId, toast]);

  /* ── Release unlocked tokens for a specific schedule index ─────────── */
  const handleRelease = useCallback(
    async (scheduleIndex: number) => {
      if (!connected || !publicKey) return;
      const info = schedules[scheduleIndex];
      if (!info) return;

      if (info.releasableAmount <= 0n) {
        toast.show({
          title: "No Tokens Available",
          message: "No tokens available to release right now.",
          variant: "error",
        });
        return;
      }

      setReleasingIndex(scheduleIndex);
      try {
        const xdr = await buildReleaseTx(
          contractId.trim(),
          publicKey,
          publicKey,
          scheduleIndex,
        );
        const signedXdr = await signTransaction(xdr);
        await submitTx(signedXdr);
        toast.show({
          title: "Success",
          message: `Schedule ${scheduleIndex + 1}: tokens released successfully!`,
          variant: "success",
        });

        // Refresh this schedule
        const [updated, solvencyState] = await Promise.all([
          fetchVestingInfo(contractId.trim(), publicKey, scheduleIndex),
          fetchVestingSolvency(contractId.trim()),
        ]);
        setSolvency(solvencyState);
        setSchedules((prev) => {
          const next = [...prev];
          next[scheduleIndex] = updated;
          return next;
        });
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Release transaction failed";
        toast.show({
          title: "Release Failed",
          message: msg,
          variant: "error",
        });
      } finally {
        setReleasingIndex(null);
      }
    },
    [connected, publicKey, schedules, contractId, signTransaction, toast],
  );

  /* ── Release all unlocked tokens across all schedules ──────────────── */
  const [releasingAll, setReleasingAll] = useState(false);

  const handleReleaseAll = useCallback(async () => {
    if (!connected || !publicKey) return;
    setReleasingAll(true);
    try {
      const xdr = await buildReleaseAllTx(contractId.trim(), publicKey, publicKey);
      const signedXdr = await signTransaction(xdr);
      await submitTx(signedXdr);
      toast.show({
        title: "Success",
        message: "All tokens released successfully!",
        variant: "success",
      });
      // Refresh all schedules + solvency
      const [allSchedules, solvencyState] = await Promise.all([
        fetchAllVestingSchedules(contractId.trim(), publicKey),
        fetchVestingSolvency(contractId.trim()),
      ]);
      const infos: VestingInfo[] = await Promise.all(
        allSchedules.map((_, i) =>
          fetchVestingInfo(contractId.trim(), publicKey, i),
        ),
      );
      setSchedules(infos);
      setSolvency(solvencyState);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Release transaction failed";
      toast.show({
        title: "Release Failed",
        message: msg,
        variant: "error",
      });
    } finally {
      setReleasingAll(false);
    }
  }, [connected, publicKey, contractId, signTransaction, toast]);

  /* ── Render ────────────────────────────────────────────────────────── */
  return (
    <>
      {!connected && (
        <div className="glass-card p-8 text-center">
          <p className="mb-4 text-gray-400">
            {t("walletGate")}
          </p>
          <Button onClick={connect}>{t("connectWallet")}</Button>
        </div>
      )}

      {connected && (
        <div className="space-y-8">
          <div className="glass-card p-6">
            <label
              htmlFor="contractId"
              className="mb-2 block text-sm font-medium text-gray-300"
            >
              {t("contractIdLabel")}
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
                placeholder={t("contractIdPlaceholder")}
                className="flex-1 rounded-xl border border-white/10 bg-void-800 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition-colors focus:border-stellar-400 focus:ring-1 focus:ring-stellar-400"
                aria-describedby={error ? "contract-error" : undefined}
              />
              <Button
                onClick={handleLookup}
                isLoading={loading}
                disabled={loading || !contractId.trim()}
              >
                {t("lookUp")}
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

          {adminState?.pendingAdmin && (
            <PendingAdminBanner
              pendingAdmin={adminState.pendingAdmin}
              connectedWallet={publicKey}
              nonPendingMessage="The current admin can cancel the proposal from the contract's admin section."
            />
          )}

          {solvency !== undefined && (
            <VestingSolvencyBadge solvency={solvency} />
          )}

          {schedules.map((info, idx) => (
            <ScheduleCard
              key={idx}
              info={info}
              scheduleIndex={idx}
              scheduleCount={schedules.length}
              releasing={releasingIndex === idx}
              onRelease={() => handleRelease(idx)}
            />
          ))}

          {schedules.length > 1 && (
            <Button
              onClick={handleReleaseAll}
              isLoading={releasingAll}
              disabled={releasingAll || releasingIndex !== null}
              className="w-full mt-4"
              variant="secondary"
            >
              Release All Schedules
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/* ── remaining components (ScheduleCard, StatCard, DetailRow) unchanged ── */

/* ── Per-schedule card ─────────────────────────────────────────────── */

function ScheduleCard({
  info,
  scheduleIndex,
  scheduleCount,
  releasing,
  onRelease,
}: {
  info: VestingInfo;
  scheduleIndex: number;
  scheduleCount: number;
  releasing: boolean;
  onRelease: () => void;
}) {
  const t = useTranslations("claim");
  const { schedule } = info;

  const progressPct =
    schedule.totalAmount > 0n
      ? Number((info.vestedAmount * 100n) / schedule.totalAmount)
      : 0;

  return (
    <div className="glass-card animate-fade-in-up space-y-6 p-6">
      {/* Header */}        <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">
            {scheduleCount > 1
              ? t("scheduleOf", { current: scheduleIndex + 1, count: scheduleCount })
              : t("yourSchedule")}
          </h2>
          {scheduleCount > 1 && (
            <span className="rounded-full border border-stellar-400/20 bg-stellar-400/10 px-2.5 py-0.5 text-xs text-stellar-400">
              #{scheduleIndex + 1}
            </span>
          )}
        </div>
        {schedule.revoked && (
          <span className="rounded-lg bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400">
            {t("revoked")}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div>
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-gray-400">{t("vestingProgress")}</span>
          <span className="font-medium text-stellar-400">
            {progressPct.toFixed(1)}%
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-void-700">
          <div
            className="h-full rounded-full bg-gradient-to-r from-stellar-400 to-stellar-600 transition-all duration-500"
            style={{ width: `${Math.min(progressPct, 100)}%` }}
            role="progressbar"
            aria-valuenow={Math.round(progressPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Vesting progress for schedule ${scheduleIndex + 1}`}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4">          <StatCard
            label={t("totalAllocation")}
            value={formatTokenAmount(schedule.totalAmount)}
          />
        <StatCard
          label={t("vestedSoFar")}
          value={formatTokenAmount(info.vestedAmount)}
        />
        <StatCard
          label={t("alreadyReleased")}
          value={formatTokenAmount(schedule.released)}
        />
        <StatCard
          label={t("availableToClaim")}
          value={formatTokenAmount(info.releasableAmount)}
          highlight
        />
      </div>

      {/* Schedule metadata */}
      <div className="space-y-2 rounded-xl border border-white/5 bg-void-800/50 p-4 text-sm">
        <DetailRow
          label={t("recipient")}
          value={truncateAddress(schedule.recipient)}
        />
        <DetailRow
          label={t("cliffLedger")}
          value={schedule.cliffLedger.toLocaleString()}
        />
        <DetailRow
          label={t("endLedger")}
          value={schedule.endLedger.toLocaleString()}
        />
        <DetailRow
          label={t("currentLedger")}
          value={info.currentLedger.toLocaleString()}
        />
      </div>

      {/* Release button */}
      <Button
        onClick={onRelease}
        isLoading={releasing}
        disabled={
          releasing ||
          info.releasableAmount <= 0n ||
          schedule.revoked ||
          info.isPaused
        }
        className="w-full"
        aria-label={`Release ${formatTokenAmount(info.releasableAmount)} vested tokens from schedule ${scheduleIndex + 1}`}
      >
        {schedule.revoked
          ? t("scheduleRevoked")
          : info.isPaused
            ? t("vestingPaused")
            : info.releasableAmount <= 0n
              ? t("noTokensToRelease")
              : t("releaseTokens", { amount: formatTokenAmount(info.releasableAmount) })}
      </Button>
      {info.isPaused && !schedule.revoked && (
        <p className="text-xs text-orange-400">
          {t("pausedMessage")}
        </p>
      )}
    </div>
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
