"use client";

import React, { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Upload, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { UseAdminActionResult } from "../../hooks/useAdminAction";
import { AdminCard } from "./AdminCard";
import { ActionSuccess } from "./ConfirmPanel";
import { vestingUpgradeSchema, type VestingUpgradeData } from "./schemas";

/** Upgrade a vesting contract's WASM in place. */
export function VestingUpgradeCard({
  admin,
  disabled,
  locked,
}: {
  admin: UseAdminActionResult;
  disabled: boolean;
  locked: boolean;
}) {
  const form = useForm<VestingUpgradeData>({
    resolver: zodResolver(vestingUpgradeSchema),
  });
  const watchedVestingContract = useWatch({
    control: form.control,
    name: "vestingContract",
  });
  const [showConfirm, setShowConfirm] = useState(false);

  const onSubmit = form.handleSubmit(async (data) => {
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    if (await admin.run("vesting-upgrade", data)) {
      form.reset();
      setShowConfirm(false);
    }
  });

  return (
    <AdminCard
      title="Upgrade Vesting Contract"
      icon={Upload}
      accent="purple"
      description="Replace the vesting contract WASM with a new version. Affects all vesting schedules immediately."
    >
      {locked ? (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-200">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          Vesting contract is locked — upgrades are permanently disabled.
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 text-xs leading-relaxed text-purple-200/80">
            <strong className="text-purple-300">Before upgrading:</strong>{" "}
            ensure the new WASM has been reviewed and audited. This replaces
            contract logic for every vesting schedule holder and cannot be undone
            unless the new contract itself supports a further upgrade.
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="vesting-upgrade-contract"
                className="mb-1.5 block text-xs font-medium text-gray-300"
              >
                Vesting Contract{" "}
                <span className="text-gray-500">(C...)</span>
              </label>
              <input
                id="vesting-upgrade-contract"
                {...form.register("vestingContract")}
                placeholder="C..."
                disabled={disabled}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-40"
                spellCheck={false}
                autoComplete="off"
              />
              {form.formState.errors.vestingContract && (
                <p className="mt-1 text-xs text-red-400">
                  {form.formState.errors.vestingContract.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="vesting-upgrade-wasm-hash"
                className="mb-1.5 block text-xs font-medium text-gray-300"
              >
                New WASM Hash{" "}
                <span className="text-gray-500">(64 hex characters)</span>
              </label>
              <input
                id="vesting-upgrade-wasm-hash"
                {...form.register("wasmHash")}
                placeholder="a1b2c3d4e5f6… (64 hex chars)"
                disabled={disabled}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-40"
                spellCheck={false}
                autoComplete="off"
                maxLength={64}
              />
              {form.formState.errors.wasmHash && (
                <p className="mt-1 text-xs text-red-400">
                  {form.formState.errors.wasmHash.message}
                </p>
              )}
            </div>

            {showConfirm && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-2 rounded-xl border border-purple-500/30 bg-purple-950/30 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-purple-400 text-center">
                  Confirm upgrade
                </p>
                <p className="text-xs text-center text-gray-300 leading-relaxed">
                  Type the vesting contract address{" "}
                  <span className="font-mono font-bold text-purple-300">
                    {watchedVestingContract ?? "C..."}
                  </span>{" "}
                  to confirm you understand this is irreversible.
                </p>
                <input
                  {...form.register("confirmSymbol")}
                  aria-label="Vesting contract address confirmation"
                  placeholder="C..."
                  disabled={admin.loading === "vesting-upgrade"}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-40"
                  autoComplete="off"
                />
                {form.formState.errors.confirmSymbol && (
                  <p className="text-xs text-red-400">
                    {form.formState.errors.confirmSymbol.message}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {showConfirm && (
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirm(false);
                    form.clearErrors("confirmSymbol");
                  }}
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-40"
                  disabled={admin.loading === "vesting-upgrade"}
                >
                  Cancel
                </button>
              )}
              <Button
                type="submit"
                className={`${showConfirm ? "flex-1" : "w-full"} bg-purple-700 hover:bg-purple-600 border-none shadow-lg shadow-purple-600/20`}
                isLoading={admin.loading === "vesting-upgrade"}
                disabled={disabled}
              >
                {admin.success === "vesting-upgrade" ? (
                  <ActionSuccess label="Upgraded" />
                ) : showConfirm ? (
                  "Confirm Upgrade"
                ) : (
                  <span className="flex items-center gap-2">
                    <Upload className="w-4 h-4" aria-hidden="true" /> Upgrade
                    Vesting Contract
                  </span>
                )}
              </Button>
            </div>
          </form>
        </>
      )}
    </AdminCard>
  );
}