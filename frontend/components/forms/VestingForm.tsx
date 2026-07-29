"use client";

import React, { useState } from "react";
import { useForm, Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PreflightCheckDisplay } from "@/components/ui/PreflightCheck";
import { useTransactionSimulator } from "@/hooks/useTransactionSimulator";
import { AlertCircle, Clock, Unlock } from "lucide-react";
import { useToast } from "@/app/providers/ToastProvider";

const vestingReleaseSchema = z.object({
  vestingContractId: z.string().regex(/^C[A-Z0-9]{55}$/, "Invalid vesting contract ID"),
  recipientAddress: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid recipient address"),
  scheduleIndex: z.coerce
    .number()
    .int("Must be a whole number")
    .min(0, "Must be 0 or greater")
    .optional(),
});

type VestingReleaseFormData = z.infer<typeof vestingReleaseSchema>;

interface VestingReleaseFormProps {
  onSuccess?: (txHash: string) => void;
}

/**
 * Vesting Release Form with pre-flight checks
 */
export function VestingReleaseForm({ onSuccess }: VestingReleaseFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toast = useToast();
  const [preflightResult, setPreflightResult] = useState<{
    isLoading: boolean;
    success: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);

  const simulator = useTransactionSimulator();

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors, isValid },
    watch,
  } = useForm<VestingReleaseFormData>({
    resolver: zodResolver(vestingReleaseSchema) as Resolver<VestingReleaseFormData>,
    mode: "onChange",
  });

  const formData = watch();

  const handleCheck = async () => {
    const isValid = await trigger();
    if (!isValid) return;

    setPreflightResult({ isLoading: true, success: false, errors: [], warnings: [] });

    try {
      const result = await simulator.checkVestingRelease(
        formData.vestingContractId,
        formData.recipientAddress,
        formData.scheduleIndex,
      );

      setPreflightResult({
        isLoading: false,
        success: result.success,
        errors: result.errors,
        warnings: result.warnings,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setPreflightResult({
        isLoading: false,
        success: false,
        errors: [message],
        warnings: [],
      });
    }
  };

  const onSubmit = async (data: VestingReleaseFormData) => {
    if (!preflightResult?.success) {
      toast.show({
        title: "Pre-flight Check Required",
        message: "Run the pre-flight check first",
        variant: "warning",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      console.log("Submitting vesting release transaction:", data);
      onSuccess?.("0x...");
    } catch (error) {
      console.error("Failed to submit transaction:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="glass-card p-6 space-y-6">
      <div className="flex items-start gap-2 rounded-lg bg-blue-500/10 p-3 border border-blue-500/20">
        <Clock className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-200">
          Release vested tokens for a beneficiary. Available amount depends on the vesting schedule.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Vesting Contract ID
        </label>
        <Input
          type="text"
          placeholder="CABC123..."
          {...register("vestingContractId")}
        />
        {errors.vestingContractId && (
          <p className="text-red-400 text-sm mt-1">{errors.vestingContractId.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Recipient Address
        </label>
        <Input
          type="text"
          placeholder="GABC123..."
          {...register("recipientAddress")}
        />
        {errors.recipientAddress && (
          <p className="text-red-400 text-sm mt-1">{errors.recipientAddress.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Schedule Index{" "}
          <span className="text-gray-500 font-normal">(optional — defaults to latest)</span>
        </label>
        <Input
          type="number"
          min={0}
          placeholder="0"
          {...register("scheduleIndex")}
        />
        {errors.scheduleIndex && (
          <p className="text-red-400 text-sm mt-1">{errors.scheduleIndex.message}</p>
        )}
      </div>

      {/* Pre-flight check status */}
      {preflightResult && (
        <div className="mt-6">
          <PreflightCheckDisplay
            isLoading={preflightResult.isLoading}
            errors={preflightResult.errors}
            warnings={preflightResult.warnings}
            successMessage={preflightResult.success ? "Ready to release vested tokens" : undefined}
            onDismiss={() => setPreflightResult(null)}
          />
        </div>
      )}

      <div className="flex gap-3 pt-4">
        <Button
          type="button"
          variant="secondary"
          onClick={handleCheck}
          disabled={!isValid || simulator.isLoading}
        >
          Check Transaction
        </Button>
        <Button
          type="submit"
          disabled={!isValid || isSubmitting || !(preflightResult?.success ?? false)}
          isLoading={isSubmitting}
        >
          <Unlock className="w-4 h-4" />
          Release Tokens
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Vesting Revoke Form
// ───────────────────────────────────────────────────────────────────────────

const vestingRevokeSchema = z.object({
  vestingContractId: z.string().regex(/^C[A-Z0-9]{55}$/, "Invalid vesting contract ID"),
  recipientAddress: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid recipient address"),
  scheduleIndex: z.coerce
    .number()
    .int("Must be a whole number")
    .min(0, "Must be 0 or greater")
    .optional(),
});

type VestingRevokeFormData = z.infer<typeof vestingRevokeSchema>;

interface VestingRevokeFormProps {
  adminAddress: string;
  onSuccess?: (txHash: string) => void;
}

/**
 * Vesting Revoke Form with pre-flight checks (Admin only)
 */
export function VestingRevokeForm({ adminAddress, onSuccess }: VestingRevokeFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toast = useToast();
  const [preflightResult, setPreflightResult] = useState<{
    isLoading: boolean;
    success: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);

  const simulator = useTransactionSimulator();

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors, isValid },
    watch,
  } = useForm<VestingRevokeFormData>({
    resolver: zodResolver(vestingRevokeSchema) as Resolver<VestingRevokeFormData>,
    mode: "onChange",
  });

  const formData = watch();

  const handleCheck = async () => {
    const isValid = await trigger();
    if (!isValid) return;

    setPreflightResult({ isLoading: true, success: false, errors: [], warnings: [] });

    try {
      const result = await simulator.checkVestingRevoke(
        formData.vestingContractId,
        formData.recipientAddress,
        adminAddress,
        formData.scheduleIndex,
      );

      setPreflightResult({
        isLoading: false,
        success: result.success,
        errors: result.errors,
        warnings: result.warnings,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setPreflightResult({
        isLoading: false,
        success: false,
        errors: [message],
        warnings: [],
      });
    }
  };

  const onSubmit = async (data: VestingRevokeFormData) => {
    if (!preflightResult?.success) {
      toast.show({
        title: "Pre-flight Check Required",
        message: "Run the pre-flight check first",
        variant: "warning",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      console.log("Submitting vesting revoke transaction:", data);
      onSuccess?.("0x...");
    } catch (error) {
      console.error("Failed to submit transaction:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="glass-card p-6 space-y-6 border-red-500/30">
      <div className="flex items-start gap-2 rounded-lg bg-red-500/10 p-3 border border-red-500/20">
        <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-red-200">
          Revoking a schedule is permanent. Vested tokens go to the recipient, unvested tokens return to admin.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Vesting Contract ID
        </label>
        <Input
          type="text"
          placeholder="CABC123..."
          {...register("vestingContractId")}
        />
        {errors.vestingContractId && (
          <p className="text-red-400 text-sm mt-1">{errors.vestingContractId.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Recipient Address
        </label>
        <Input
          type="text"
          placeholder="GABC123..."
          {...register("recipientAddress")}
        />
        {errors.recipientAddress && (
          <p className="text-red-400 text-sm mt-1">{errors.recipientAddress.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Schedule Index{" "}
          <span className="text-gray-500 font-normal">(optional — defaults to latest)</span>
        </label>
        <Input
          type="number"
          min={0}
          placeholder="0"
          {...register("scheduleIndex")}
        />
        {errors.scheduleIndex && (
          <p className="text-red-400 text-sm mt-1">{errors.scheduleIndex.message}</p>
        )}
      </div>

      {/* Pre-flight check status */}
      {preflightResult && (
        <div className="mt-6">
          <PreflightCheckDisplay
            isLoading={preflightResult.isLoading}
            errors={preflightResult.errors}
            warnings={preflightResult.warnings}
            successMessage={preflightResult.success ? "Ready to revoke vesting schedule" : undefined}
            onDismiss={() => setPreflightResult(null)}
          />
        </div>
      )}

      <div className="flex gap-3 pt-4">
        <Button
          type="button"
          variant="secondary"
          onClick={handleCheck}
          disabled={!isValid || simulator.isLoading}
        >
          Check Transaction
        </Button>
        <Button
          type="submit"
          variant="secondary"
          disabled={!isValid || isSubmitting || !(preflightResult?.success ?? false)}
          isLoading={isSubmitting}
        >
          <AlertCircle className="w-4 h-4" />
          Revoke Schedule
        </Button>
      </div>
    </form>
  );
}
