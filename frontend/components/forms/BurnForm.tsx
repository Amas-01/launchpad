"use client";

import React, { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { NumericInput } from "@/components/ui/NumericInput";
import { PreflightCheckDisplay } from "@/components/ui/PreflightCheck";
import { useTransactionSimulator } from "@/hooks/useTransactionSimulator";
import { AlertCircle, Flame } from "lucide-react";
import { useToast } from "@/app/providers/ToastProvider";

const burnSchema = z.object({
  tokenContractId: z.string().regex(/^C[A-Z0-9]{55}$/, "Invalid token contract ID"),
  fromAddress: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid address"),
  amount: z
    .string()
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, "Amount must be positive"),
});

type BurnFormData = z.infer<typeof burnSchema>;

interface BurnFormProps {
  adminAddress: string;
  onSuccess?: (txHash: string) => void;
}

export function BurnForm({ adminAddress, onSuccess }: BurnFormProps) {
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
    control,
    formState: { errors, isValid },
    watch,
  } = useForm<BurnFormData>({
    resolver: zodResolver(burnSchema),
    mode: "onChange",
  });

  const formData = watch();

  const handleCheck = async () => {
    const isValid = await trigger();
    if (!isValid) return;

    setPreflightResult({ isLoading: true, success: false, errors: [], warnings: [] });

    try {
      const result = await simulator.checkBurn(
        formData.tokenContractId,
        formData.fromAddress,
        BigInt(Math.floor(parseFloat(formData.amount) * 1e7)),
        adminAddress,
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

  const onSubmit = async (_data: BurnFormData) => {
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
          Burning tokens permanently removes them from circulation. This action cannot be undone.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Token Contract ID
        </label>
        <Input
          type="text"
          placeholder="CABC123..."
          {...register("tokenContractId")}
        />
        {errors.tokenContractId && (
          <p className="text-red-400 text-sm mt-1">{errors.tokenContractId.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          From Address
        </label>
        <Input
          type="text"
          placeholder="GABC123..."
          {...register("fromAddress")}
        />
        {errors.fromAddress && (
          <p className="text-red-400 text-sm mt-1">{errors.fromAddress.message}</p>
        )}
      </div>

      <Controller
        name="amount"
        control={control}
        render={({ field }) => (
          <NumericInput
            label="Amount to Burn"
            placeholder="e.g. 1,000.50"
            value={field.value}
            onChange={(val) => field.onChange(val?.toString() ?? "")}
            error={errors.amount?.message as string}
          />
        )}
      />

      {preflightResult && (
        <div className="mt-6">
          <PreflightCheckDisplay
            isLoading={preflightResult.isLoading}
            errors={preflightResult.errors}
            warnings={preflightResult.warnings}
            successMessage={preflightResult.success ? "Ready to burn tokens" : undefined}
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
          <Flame className="w-4 h-4" />
          Burn Tokens
        </Button>
      </div>
    </form>
  );
}