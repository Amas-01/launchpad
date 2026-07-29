"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Lock, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { UseAdminActionResult } from "../../hooks/useAdminAction";
import { AdminCard } from "./AdminCard";
import { ActionSuccess } from "./ConfirmPanel";
import { upgradeSchema, type UpgradeData } from "./schemas";

/**
 * Replace the contract WASM in place. Gated behind typing the token symbol,
 * because it changes the logic under every existing holder.
 */
export function DangerCard({
  admin,
  disabled,
  locked,
  tokenSymbol,
}: {
  admin: UseAdminActionResult;
  disabled: boolean;
  locked: boolean;
  tokenSymbol?: string;
}) {
  const form = useForm<UpgradeData>({ resolver: zodResolver(upgradeSchema) });
  const [showConfirm, setShowConfirm] = useState(false);

  const onSubmit = form.handleSubmit(async (data) => {
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    const expectedSymbol = (tokenSymbol ?? "").toUpperCase();
    if (data.confirmSymbol.trim().toUpperCase() !== expectedSymbol) {
      form.setError("confirmSymbol", {
        message: `Type "${expectedSymbol}" exactly to confirm.`,
      });
      return;
    }

    if (await admin.run("upgrade", data)) {
      form.reset();
      setShowConfirm(false);
    }
  });

  return (
    <div className="mt-2 w-full">
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="flex-1 border-t border-white/5" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-600">
          Advanced / Danger
        </span>
        <div className="flex-1 border-t border-white/5" />
      </div>

      <AdminCard
        title="Upgrade Contract"
        icon={Upload}
        accent="purple"
        className="border border-purple-500/10 bg-purple-950/5"
        description="Replace the contract WASM with a new version. Affects all holders immediately."
      >
        {locked ? (
          <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-200">
            <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
            Contract is locked — upgrades are permanently disabled.
          </div>
        ) : (
          <>
            <div className="mb-4 rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 text-xs leading-relaxed text-purple-200/80">
              <strong className="text-purple-300">Before upgrading:</strong>{" "}
              ensure the new WASM has been reviewed and audited. This replaces
              contract logic for every token holder and cannot be undone unless
              the new contract itself supports a further upgrade.
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div>
                <label
                  htmlFor="upgrade-wasm-hash"
                  className="mb-1.5 block text-xs font-medium text-gray-300"
                >
                  New WASM Hash{" "}
                  <span className="text-gray-500">(64 hex characters)</span>
                </label>
                <input
                  id="upgrade-wasm-hash"
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
                    Type the token symbol{" "}
                    <span className="font-mono font-bold text-purple-300">
                      {tokenSymbol ?? "SYMBOL"}
                    </span>{" "}
                    to confirm you understand this is irreversible.
                  </p>
                  <input
                    {...form.register("confirmSymbol")}
                    aria-label="Token symbol confirmation"
                    placeholder={tokenSymbol ?? "SYMBOL"}
                    disabled={admin.loading === "upgrade"}
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
                    disabled={admin.loading === "upgrade"}
                  >
                    Cancel
                  </button>
                )}
                <Button
                  type="submit"
                  className={`${showConfirm ? "flex-1" : "w-full"} bg-purple-700 hover:bg-purple-600 border-none shadow-lg shadow-purple-600/20`}
                  isLoading={admin.loading === "upgrade"}
                  disabled={disabled}
                >
                  {admin.success === "upgrade" ? (
                    <ActionSuccess label="Upgraded" />
                  ) : showConfirm ? (
                    "Confirm Upgrade"
                  ) : (
                    <span className="flex items-center gap-2">
                      <Upload className="w-4 h-4" aria-hidden="true" /> Upgrade
                      Contract
                    </span>
                  )}
                </Button>
              </div>
            </form>
          </>
        )}
      </AdminCard>
    </div>
  );
}
