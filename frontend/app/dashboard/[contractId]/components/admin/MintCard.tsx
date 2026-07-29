"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PreflightCheckDisplay } from "@/components/ui/PreflightCheck";
import {
  parseBatchMintData,
  parseBatchMintFile,
  type BatchMintEntry,
} from "@/lib/batch";
import { useToast } from "../../../../providers/ToastProvider";
import type { UseAdminActionResult } from "../../hooks/useAdminAction";
import { AdminCard, ModeToggle } from "./AdminCard";
import { ActionSuccess } from "./ConfirmPanel";
import { mintSchema, type MintData } from "./schemas";

/** Contract-side `mint_batch` caps at 100; the UI stays well under it. */
const MAX_BATCH_SIZE = 50;

export function MintCard({
  admin,
  disabled,
}: {
  admin: UseAdminActionResult;
  disabled: boolean;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [batchData, setBatchData] = useState("");
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [parsedEntries, setParsedEntries] = useState<BatchMintEntry[]>([]);

  const form = useForm<MintData>({ resolver: zodResolver(mintSchema) });
  const preflight = admin.preflight.mint;

  const onMint = async (data: MintData) => {
    if (await admin.run("mint", data)) {
      form.reset();
      admin.clearPreflight("mint");
    }
  };

  const onBatchMint = async () => {
    if (parsedEntries.length > MAX_BATCH_SIZE) {
      toast.show({
        title: "Batch too large",
        message: `Maximum batch size is ${MAX_BATCH_SIZE} recipients. You have ${parsedEntries.length}.`,
        variant: "error",
      });
      return;
    }
    if (await admin.run("batch-mint", { entries: parsedEntries })) {
      setBatchData("");
      setParsedEntries([]);
      setBatchErrors([]);
    }
  };

  return (
    <AdminCard
      title="Mint Assets"
      icon={Coins}
      headerAction={
        <ModeToggle
          label="Mint mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "single", label: "Single" },
            { value: "batch", label: "Batch" },
          ]}
        />
      }
    >
      {mode === "single" ? (
        <form
          onSubmit={form.handleSubmit(onMint)}
          className="space-y-4 flex-grow"
        >
          <Input
            label="Recipient Address"
            placeholder="G..."
            className="bg-white/5 border-white/10"
            {...form.register("to")}
            error={form.formState.errors.to?.message}
          />
          <Input
            label="Amount"
            type="number"
            placeholder="0.00"
            className="bg-white/5 border-white/10"
            {...form.register("amount")}
            error={form.formState.errors.amount?.message}
          />
          {preflight && (
            <PreflightCheckDisplay
              isLoading={admin.isSimulating}
              errors={preflight.errors}
              warnings={preflight.warnings}
              successMessage={
                !preflight.errors?.length && !preflight.warnings?.length
                  ? "Mint transaction is ready"
                  : undefined
              }
            />
          )}
          <Button
            type="submit"
            className="w-full mt-4 shadow-lg shadow-stellar-500/20"
            isLoading={admin.loading === "mint"}
            disabled={disabled}
          >
            {admin.success === "mint" ? <ActionSuccess /> : "Mint Tokens"}
          </Button>
        </form>
      ) : (
        <div className="space-y-4 flex-grow">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="batch-mint-entries"
              className="text-sm font-medium text-gray-300"
            >
              Manual Entry (Address, Amount)
            </label>
            <textarea
              id="batch-mint-entries"
              className="w-full h-32 bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-stellar-100 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-stellar-500/50 resize-none"
              placeholder="GC7... , 100.0&#10;GD2... , 50.5"
              value={batchData}
              onChange={(e) => {
                setBatchData(e.target.value);
                const { entries, errors } = parseBatchMintData(e.target.value);
                setParsedEntries(entries);
                setBatchErrors(errors);
              }}
            />
          </div>

          <div className="relative">
            <div
              className="absolute inset-0 flex items-center"
              aria-hidden="true"
            >
              <div className="w-full border-t border-white/5" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-2 bg-transparent text-[10px] uppercase tracking-widest text-gray-500">
                Or Upload CSV
              </span>
            </div>
          </div>

          <input
            type="file"
            accept=".csv"
            aria-label="Upload batch mint CSV"
            className="block w-full text-xs text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-stellar-500/10 file:text-stellar-400 hover:file:bg-stellar-500/20 transition-all cursor-pointer"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const { entries, errors } = await parseBatchMintFile(file);
              setParsedEntries(entries);
              setBatchErrors(errors);
            }}
          />

          {batchErrors.length > 0 && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-[10px] text-red-400 font-bold uppercase mb-1">
                Errors Found:
              </p>
              <ul className="text-[10px] text-red-300 space-y-1 list-disc list-inside">
                {batchErrors.slice(0, 3).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
                {batchErrors.length > 3 && (
                  <li>...and {batchErrors.length - 3} more</li>
                )}
              </ul>
            </div>
          )}

          {parsedEntries.length > 0 && batchErrors.length === 0 && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center justify-between">
              <span className="text-xs text-green-400 font-medium">
                {parsedEntries.length} valid entries ready
              </span>
              <span className="text-[10px] text-green-500/70">
                Total:{" "}
                {parsedEntries
                  .reduce((acc, curr) => acc + Number(curr.amount), 0)
                  .toLocaleString()}
              </span>
            </div>
          )}

          <Button
            type="button"
            className="w-full mt-2 shadow-lg shadow-stellar-500/20"
            isLoading={admin.loading === "batch-mint"}
            disabled={
              disabled || parsedEntries.length === 0 || batchErrors.length > 0
            }
            onClick={onBatchMint}
          >
            {admin.success === "batch-mint" ? (
              <ActionSuccess label="Batch Minted!" />
            ) : (
              `Mint Batch (${parsedEntries.length})`
            )}
          </Button>
        </div>
      )}
    </AdminCard>
  );
}
