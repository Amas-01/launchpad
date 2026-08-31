"use client";

import React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PreflightCheckDisplay } from "@/components/ui/PreflightCheck";
import { VestingCurveChart } from "@/components/VestingCurveChart";
import type { UseAdminActionResult } from "../../hooks/useAdminAction";
import { AdminCard } from "./AdminCard";
import { ActionSuccess } from "./ConfirmPanel";
import { vestingSchema, type VestingData } from "./schemas";

/** Create a new vesting schedule on a vesting contract. */
export function VestingCard({
  admin,
  disabled,
}: {
  admin: UseAdminActionResult;
  disabled: boolean;
}) {
  const form = useForm<VestingData>({ resolver: zodResolver(vestingSchema) });
  const preflight = admin.preflight.vesting;

  // Live values for the vesting curve preview chart.
  const [watchedCliff, watchedDuration] = useWatch({
    control: form.control,
    name: ["cliffDays", "durationDays"],
  });
  const chartCliffDays = Math.max(0, Number(watchedCliff) || 0);
  const chartDurationDays = Math.max(0, Number(watchedDuration) || 0);

  const onSubmit = async (data: VestingData) => {
    if (await admin.run("vesting", data)) {
      form.reset();
      admin.clearPreflight("vesting");
    }
  };

  return (
    <AdminCard title="Create Vesting" icon={Clock}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 flex-grow"
      >
        <Input
          label="Vesting Contract"
          placeholder="C..."
          className="bg-white/5 border-white/10"
          {...form.register("vestingContract")}
          error={form.formState.errors.vestingContract?.message}
        />
        <Input
          label="Recipient Address"
          placeholder="G..."
          className="bg-white/5 border-white/10"
          {...form.register("recipient")}
          error={form.formState.errors.recipient?.message}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Cliff (Days)"
            type="number"
            placeholder="0"
            className="bg-white/5 border-white/10"
            {...form.register("cliffDays")}
            error={form.formState.errors.cliffDays?.message}
          />
          <Input
            label="Duration (Days)"
            type="number"
            placeholder="365"
            className="bg-white/5 border-white/10"
            {...form.register("durationDays")}
            error={form.formState.errors.durationDays?.message}
          />
        </div>
        {chartDurationDays > 0 && (
          <VestingCurveChart
            cliffDays={chartCliffDays}
            durationDays={chartDurationDays}
          />
        )}
        <Input
          label="Total Amount"
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
                ? "Vesting schedule is ready"
                : undefined
            }
          />
        )}
        <Button
          type="submit"
          className="w-full mt-4 bg-stellar-500 hover:bg-stellar-600 text-white shadow-lg shadow-stellar-500/20"
          isLoading={admin.loading === "vesting"}
          disabled={disabled}
        >
          {admin.success === "vesting" ? (
            <ActionSuccess />
          ) : (
            "Initialize Schedule"
          )}
        </Button>
      </form>
    </AdminCard>
  );
}
