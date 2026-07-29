"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PreflightCheckDisplay } from "@/components/ui/PreflightCheck";
import type { UseAdminActionResult } from "../../hooks/useAdminAction";
import { AdminCard } from "./AdminCard";
import { ActionSuccess, ConfirmPanel } from "./ConfirmPanel";
import { manageVestingSchema, type ManageVestingData } from "./schemas";

/** Extend the cliff of, or revoke, an existing vesting schedule. */
export function ManageVestingCard({
  admin,
  disabled,
}: {
  admin: UseAdminActionResult;
  disabled: boolean;
}) {
  const form = useForm<ManageVestingData>({
    resolver: zodResolver(manageVestingSchema),
  });
  // Revoke is destructive, so it sits behind an explicit confirmation step.
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  const preflight =
    admin.preflight["extend-cliff"] ?? admin.preflight["vesting-revoke"];

  const onExtendCliff = form.handleSubmit(async (data) => {
    // newCliffDays is optional in the schema (Revoke ignores it), so enforce
    // it here for the Extend path.
    if (!data.newCliffDays) {
      form.setError("newCliffDays", {
        message: "Cliff extension must be positive",
      });
      return;
    }
    if (await admin.run("extend-cliff", data)) {
      // Keep the contract / recipient / index so further edits are easy; just
      // clear the one-off cliff input and the preflight banner.
      form.resetField("newCliffDays");
      admin.clearPreflight("extend-cliff");
    }
  });

  const onRevoke = async () => {
    if (await admin.run("vesting-revoke", form.getValues())) {
      form.reset();
      admin.clearPreflight("vesting-revoke");
      setShowRevokeConfirm(false);
    }
  };

  return (
    <AdminCard
      title="Manage Vesting"
      icon={Clock}
      description="Extend the cliff of, or revoke, an existing schedule."
    >
      <div className="space-y-4 flex-grow">
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
        <Input
          label="Schedule Index (optional)"
          type="number"
          placeholder="0"
          className="bg-white/5 border-white/10"
          {...form.register("scheduleIndex")}
          error={form.formState.errors.scheduleIndex?.message}
        />

        {preflight && (
          <PreflightCheckDisplay
            isLoading={admin.isSimulating}
            errors={preflight.errors}
            warnings={preflight.warnings}
            successMessage={
              !preflight.errors?.length && !preflight.warnings?.length
                ? "Vesting transaction is ready"
                : undefined
            }
          />
        )}

        <div className="pt-2 border-t border-white/10">
          <p className="text-[10px] uppercase tracking-widest text-stellar-400 font-bold mb-2">
            Extend Cliff
          </p>
          <p className="text-xs text-gray-400 mb-3 leading-relaxed">
            Push the cliff back by the number of days from now. Only works while
            the current cliff is still in the future.
          </p>
          <Input
            label="New Cliff (Days from now)"
            type="number"
            placeholder="30"
            className="bg-white/5 border-white/10"
            {...form.register("newCliffDays")}
            error={form.formState.errors.newCliffDays?.message}
          />
          <Button
            type="button"
            className="w-full mt-3 bg-stellar-500 hover:bg-stellar-600 text-white shadow-lg shadow-stellar-500/20"
            isLoading={admin.loading === "extend-cliff"}
            disabled={disabled}
            onClick={onExtendCliff}
          >
            {admin.success === "extend-cliff" ? (
              <ActionSuccess label="Cliff Extended" />
            ) : (
              "Extend Cliff"
            )}
          </Button>
        </div>

        <div className="pt-2 border-t border-white/10">
          <p className="text-[10px] uppercase tracking-widest text-red-400 font-bold mb-2">
            Revoke Schedule
          </p>
          {!showRevokeConfirm ? (
            <>
              <p className="text-xs text-gray-400 mb-3 leading-relaxed">
                Cancels the schedule. Vested tokens are released to the
                recipient and all unvested tokens return to the admin.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="w-full border-red-500/20 text-red-400 hover:border-red-500/40"
                disabled={disabled}
                onClick={form.handleSubmit(() => setShowRevokeConfirm(true))}
              >
                Revoke Schedule
              </Button>
            </>
          ) : (
            <ConfirmPanel
              title="Confirm Revocation"
              message="Unvested tokens will be returned to the admin and the schedule will be permanently revoked. This cannot be undone."
              confirmLabel="Confirm Revoke"
              successLabel="Revoked"
              succeeded={admin.success === "vesting-revoke"}
              isLoading={admin.loading === "vesting-revoke"}
              onCancel={() => setShowRevokeConfirm(false)}
              onConfirm={onRevoke}
            />
          )}
        </div>
      </div>
    </AdminCard>
  );
}
