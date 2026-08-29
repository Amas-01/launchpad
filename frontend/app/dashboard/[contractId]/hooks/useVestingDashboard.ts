"use client";

import { useState, useCallback } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import type { ContractReadFn } from "./useContractRead";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScheduleStatus =
  | "cliff_pending"
  | "vesting"
  | "fully_vested"
  | "revoked";

export interface ScheduleRow {
  recipient: string;
  scheduleIndex: number;
  totalAmount: bigint;
  vested: bigint;
  released: bigint;
  remaining: bigint;
  cliffLedger: number;
  endLedger: number;
  revoked: boolean;
  status: ScheduleStatus;
  /** Approximate next unlock date (null if revoked or fully vested). */
  nextUnlockDate: Date | null;
}

export interface RecipientRow {
  address: string;
  trancheCount: number;
  totalAmount: bigint;
  vested: bigint;
  released: bigint;
  remaining: bigint;
  /** Soonest cliff / unlock among active schedules. */
  nextUnlockDate: Date | null;
  /** Worst-case status across all schedules. */
  status: ScheduleStatus;
  schedules: ScheduleRow[];
}

export interface VestingDashboardSummary {
  totalCommitted: bigint;
  totalVested: bigint;
  totalReleased: bigint;
  totalRemaining: bigint;
  /** Tokens held by the vesting contract address (if readable). */
  contractBalance: bigint | null;
  /** contractBalance >= totalRemaining — null when balance is unavailable. */
  solvent: boolean | null;
  isPaused: boolean;
}

/** One bar in the 12-month projected unlock chart. */
export interface UnlockProjectionPoint {
  label: string; // e.g. "Aug 2025"
  amount: bigint;
}

export interface VestingDashboardData {
  rows: RecipientRow[];
  summary: VestingDashboardSummary;
  projection: UnlockProjectionPoint[];
  currentLedger: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Soroban: ~5 s per ledger. */
const LEDGERS_PER_DAY = 17_280;
const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ledgerToDate(ledger: number, currentLedger: number): Date {
  const now = new Date();
  const deltaMs = ((ledger - currentLedger) / LEDGERS_PER_DAY) * 86_400_000;
  return new Date(now.getTime() + deltaMs);
}

function computeVested(
  total: bigint,
  cliffLedger: number,
  endLedger: number,
  currentLedger: number,
): bigint {
  if (currentLedger < cliffLedger) return 0n;
  if (currentLedger >= endLedger) return total;
  const elapsed = BigInt(currentLedger - cliffLedger);
  const duration = BigInt(endLedger - cliffLedger);
  return (total * elapsed) / duration;
}

function scheduleStatus(
  schedule: Pick<
    ScheduleRow,
    "revoked" | "cliffLedger" | "endLedger" | "vested" | "totalAmount"
  >,
  currentLedger: number,
): ScheduleStatus {
  if (schedule.revoked) return "revoked";
  if (currentLedger < schedule.cliffLedger) return "cliff_pending";
  if (schedule.vested >= schedule.totalAmount) return "fully_vested";
  return "vesting";
}

/** Worst-case status order for a recipient row. */
const STATUS_RANK: Record<ScheduleStatus, number> = {
  cliff_pending: 0,
  vesting: 1,
  fully_vested: 2,
  revoked: 3,
};

function worstStatus(statuses: ScheduleStatus[]): ScheduleStatus {
  if (!statuses.length) return "vesting";
  return statuses.reduce((a, b) =>
    STATUS_RANK[a] <= STATUS_RANK[b] ? a : b,
  );
}

/** Label for a month offset from now. */
function monthLabel(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseVestingDashboardResult {
  data: VestingDashboardData | null;
  loading: boolean;
  error: string | null;
  load: (vestingContractId: string, tokenContractId?: string) => Promise<void>;
}

export function useVestingDashboard(
  read: ContractReadFn,
): UseVestingDashboardResult {
  const [data, setData] = useState<VestingDashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (vestingContractId: string, tokenContractId?: string) => {
      setLoading(true);
      setError(null);
      setData(null);

      // We need a separate reader pointed at the vesting contract.
      // `read` from the hook is bound to the token contractId, so we build
      // an inline read wrapper that swaps the contractId via a closure.
      // To avoid the re-entrancy issue we accept the vestingContractId param
      // and pass it to the shared `read` via its closure over contractId.
      // Since `read` is already bound to a specific contract, we can't
      // reuse it for a different contract. Instead we re-import and build
      // an ad-hoc caller at the module level — see `readVesting` below.

      try {
        // 1. Fetch current ledger via a known-good call on the vesting contract.
        //    We use `get_recipient_count` as a lightweight probe that also
        //    surfaces the total count without a second round-trip.
        const countRaw = await readVestingContract(
          vestingContractId,
          "get_recipient_count",
          [],
        );
        const recipientCount =
          typeof countRaw === "number"
            ? countRaw
            : typeof countRaw === "bigint"
              ? Number(countRaw)
              : 0;

        // 2. Get current ledger for vested amount calculation.
        const currentLedger = await fetchCurrentLedger(vestingContractId);

        // 3. Fetch is_paused.
        const pausedRaw = await readVestingContract(
          vestingContractId,
          "is_paused",
          [],
        );
        const isPaused = pausedRaw === true;

        // 4. Page through all recipients.
        const allRecipients: string[] = [];
        let start = 0;
        while (start < recipientCount) {
          const page = await readVestingContract(
            vestingContractId,
            "get_recipients_paginated",
            [
              nativeToScVal(start, { type: "u32" }),
              nativeToScVal(Math.min(PAGE_SIZE, recipientCount - start), {
                type: "u32",
              }),
            ],
          );
          const addrs = Array.isArray(page) ? (page as string[]) : [];
          allRecipients.push(...addrs);
          start += PAGE_SIZE;
          if (addrs.length === 0) break; // safety guard against pruned-only pages
        }

        // 5. For each recipient: fetch schedule count, then all schedules.
        const recipientRows: RecipientRow[] = [];

        for (const address of allRecipients) {
          const addrScVal = new Address(address).toScVal();

          const countResult = await readVestingContract(
            vestingContractId,
            "get_schedule_count",
            [addrScVal],
          );
          const schedCount =
            typeof countResult === "number"
              ? countResult
              : typeof countResult === "bigint"
                ? Number(countResult)
                : 0;

          if (schedCount === 0) continue;

          const scheduleRows: ScheduleRow[] = [];

          for (let i = 0; i < schedCount; i++) {
            const schedRaw = await readVestingContract(
              vestingContractId,
              "get_schedule",
              [addrScVal, nativeToScVal(i, { type: "u32" })],
            );

            if (!schedRaw || typeof schedRaw !== "object") continue;

            const s = schedRaw as Record<string, unknown>;

            const totalAmount = bigintFrom(s["total_amount"] ?? s["totalAmount"]);
            const released = bigintFrom(s["released"]);
            const cliffLedger = numberFrom(s["cliff_ledger"] ?? s["cliffLedger"]);
            const endLedger = numberFrom(s["end_ledger"] ?? s["endLedger"]);
            const revoked = Boolean(s["revoked"]);

            const vested = revoked
              ? totalAmount
              : computeVested(totalAmount, cliffLedger, endLedger, currentLedger);
            const remaining = revoked ? 0n : totalAmount - released;

            const row: ScheduleRow = {
              recipient: address,
              scheduleIndex: i,
              totalAmount,
              vested,
              released,
              remaining,
              cliffLedger,
              endLedger,
              revoked,
              status: "vesting",
              nextUnlockDate: null,
            };

            row.status = scheduleStatus(row, currentLedger);

            // Next unlock = cliff date if still in cliff, otherwise null (already
            // unlocking linearly — no single discrete "next" unlock).
            if (row.status === "cliff_pending") {
              row.nextUnlockDate = ledgerToDate(cliffLedger, currentLedger);
            } else if (row.status === "vesting") {
              // Show end date (full vest) as a reference point.
              row.nextUnlockDate = ledgerToDate(endLedger, currentLedger);
            }

            scheduleRows.push(row);
          }

          if (scheduleRows.length === 0) continue;

          const totalAmount = scheduleRows.reduce(
            (s, r) => s + r.totalAmount,
            0n,
          );
          const vested = scheduleRows.reduce((s, r) => s + r.vested, 0n);
          const released = scheduleRows.reduce((s, r) => s + r.released, 0n);
          const remaining = scheduleRows.reduce((s, r) => s + r.remaining, 0n);

          const activeUnlockDates = scheduleRows
            .filter((r) => r.nextUnlockDate !== null)
            .map((r) => r.nextUnlockDate!.getTime());
          const nextUnlockDate =
            activeUnlockDates.length > 0
              ? new Date(Math.min(...activeUnlockDates))
              : null;

          recipientRows.push({
            address,
            trancheCount: scheduleRows.length,
            totalAmount,
            vested,
            released,
            remaining,
            nextUnlockDate,
            status: worstStatus(scheduleRows.map((r) => r.status)),
            schedules: scheduleRows,
          });
        }

        // 6. Compute summary.
        const totalCommitted = recipientRows.reduce(
          (s, r) => s + r.totalAmount,
          0n,
        );
        const totalVested = recipientRows.reduce((s, r) => s + r.vested, 0n);
        const totalReleased = recipientRows.reduce(
          (s, r) => s + r.released,
          0n,
        );
        const totalRemaining = recipientRows.reduce(
          (s, r) => s + r.remaining,
          0n,
        );

        // 7. Solvency: try to read the vesting contract's token balance.
        let contractBalance: bigint | null = null;
        let solvent: boolean | null = null;

        if (tokenContractId) {
          try {
            const balRaw = await readAnyContract(
              tokenContractId,
              "balance",
              [new Address(vestingContractId).toScVal()],
            );
            if (balRaw !== null && balRaw !== undefined) {
              contractBalance = bigintFrom(balRaw);
              solvent = contractBalance >= totalRemaining;
            }
          } catch {
            // Non-fatal; solvency badge simply won't appear.
          }
        }

        // 8. Build 12-month projection.
        //    For each active schedule, compute how many tokens unlock in each
        //    of the next 12 monthly buckets.
        const now = new Date();
        const projection: UnlockProjectionPoint[] = Array.from(
          { length: 12 },
          (_, i) => ({
            label: monthLabel(i + 1),
            amount: 0n,
          }),
        );

        for (const recip of recipientRows) {
          for (const sched of recip.schedules) {
            if (sched.revoked || sched.vested >= sched.totalAmount) continue;

            for (let mi = 0; mi < 12; mi++) {
              const monthStartMs = (() => {
                const d = new Date(now);
                d.setMonth(d.getMonth() + mi);
                return d.getTime();
              })();
              const monthEndMs = (() => {
                const d = new Date(now);
                d.setMonth(d.getMonth() + mi + 1);
                return d.getTime();
              })();

              const deltaStart = monthStartMs - now.getTime();
              const deltaEnd = monthEndMs - now.getTime();

              const ledgerStart =
                currentLedger +
                Math.round((deltaStart / 86_400_000) * LEDGERS_PER_DAY);
              const ledgerEnd =
                currentLedger +
                Math.round((deltaEnd / 86_400_000) * LEDGERS_PER_DAY);

              const vestedAtStart = computeVested(
                sched.totalAmount,
                sched.cliffLedger,
                sched.endLedger,
                Math.max(currentLedger, ledgerStart),
              );
              const vestedAtEnd = computeVested(
                sched.totalAmount,
                sched.cliffLedger,
                sched.endLedger,
                ledgerEnd,
              );

              const unlockInBucket = vestedAtEnd - vestedAtStart;
              if (unlockInBucket > 0n) {
                projection[mi].amount += unlockInBucket;
              }
            }
          }
        }

        setData({
          rows: recipientRows,
          summary: {
            totalCommitted,
            totalVested,
            totalReleased,
            totalRemaining,
            contractBalance,
            solvent,
            isPaused,
          },
          projection,
          currentLedger,
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load vesting data.",
        );
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { data, loading, error, load };
}

// ---------------------------------------------------------------------------
// Module-level helpers that bypass the hook's bound contractId
// ---------------------------------------------------------------------------

async function readVestingContract(
  contractId: string,
  method: string,
  args: import("@stellar/stellar-sdk").xdr.ScVal[],
): Promise<unknown> {
  return readAnyContract(contractId, method, args);
}

async function readAnyContract(
  contractId: string,
  method: string,
  args: import("@stellar/stellar-sdk").xdr.ScVal[],
): Promise<unknown> {
  const {
    TransactionBuilder,
    rpc,
    Contract,
    Account,
    Networks,
  } = await import("@stellar/stellar-sdk");
  const { scValToNative } = await import("@/lib/soroban");

  const RPC_URL =
    typeof window !== "undefined" && (window as Record<string, unknown>).__SOROPAD_RPC
      ? String((window as Record<string, unknown>).__SOROPAD_RPC)
      : process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
        "https://soroban-testnet.stellar.org";

  const PASSPHRASE =
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? Networks.TESTNET;

  const READ_ONLY_SOURCE =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  const server = new rpc.Server(RPC_URL);
  const tx = new TransactionBuilder(new Account(READ_ONLY_SOURCE, "0"), {
    fee: "100",
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return null;
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return null;
  return scValToNative(sim.result.retval);
}

async function fetchCurrentLedger(_vestingContractId: string): Promise<number> {
  const { rpc } = await import("@stellar/stellar-sdk");
  const RPC_URL =
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
    "https://soroban-testnet.stellar.org";
  const server = new rpc.Server(RPC_URL);
  const latest = await server.getLatestLedger();
  return latest.sequence;
}

// ---------------------------------------------------------------------------
// Safe coercions from scValToNative's output
// ---------------------------------------------------------------------------

function bigintFrom(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  return 0n;
}

function numberFrom(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return parseInt(v, 10);
  return 0;
}
