"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import {
  formatTokenAmount,
  type VestingSolvency,
} from "@/lib/vesting";

export function VestingSolvencyBadge({
  solvency,
  decimals = 7,
}: {
  solvency: VestingSolvency | null;
  decimals?: number;
}) {
  if (!solvency) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-sm font-semibold text-gray-200">
          Solvency unavailable
        </p>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">
          This vesting contract does not expose live commitment accounting.
        </p>
      </div>
    );
  }

  const Icon = solvency.solvent ? ShieldCheck : AlertTriangle;
  const tone = solvency.solvent
    ? "border-green-500/30 bg-green-500/10 text-green-200"
    : "border-red-500/35 bg-red-500/10 text-red-200";
  const iconTone = solvency.solvent ? "text-green-300" : "text-red-300";
  const label = solvency.solvent ? "Solvent" : "Underfunded";

  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconTone}`} />
          <div>
            <p className="text-sm font-semibold">{label}</p>
            <p className="mt-1 text-xs leading-relaxed opacity-85">
              {solvency.solvent
                ? "Live token balance covers all active vesting commitments."
                : "Live token balance is below active vesting commitments."}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:min-w-64">
          <div>
            <p className="opacity-70">Balance</p>
            <p className="font-mono font-semibold">
              {formatTokenAmount(solvency.tokenBalance, decimals)}
            </p>
          </div>
          <div>
            <p className="opacity-70">Committed</p>
            <p className="font-mono font-semibold">
              {formatTokenAmount(solvency.totalCommitted, decimals)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
