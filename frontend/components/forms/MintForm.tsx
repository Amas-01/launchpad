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
import { Rocket } from "lucide-react";
import { useToast } from "@/app/providers/ToastProvider";

const mintSchema = z.object({
  tokenContractId: z
    .string()
    .regex(/^C[A-Z0-9]{55}$/, "Invalid token contract ID"),
  recipientAddress: z
    .string()
    .regex(/^G[A-Z2-7]{55}$/, "Invalid recipient address"),
  amount: z
    .string()
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      "Amount must be positive",
    ),
});

type MintFormData = z.infer<typeof mintSchema>;

interface MintFormProps {
  adminAddress: string;
  onSuccess?: (txHash: string) => void;
}

export function MintForm({ adminAddress, onSuccess }: MintFormProps) {
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
  } = useForm<MintFormData>({
    resolver: zodResolver(mintSchema),
    mode: "onChange",
  });

  const formData = watch();

  const handleCheck = async () => {
    const isValid = await trigger();
    if (!isValid) return;

    setPreflightResult({
      isLoading: true,
      success: false,
      errors: [],
      warnings: [],
    });

    try {
      const result = await simulator.checkMint(
        formData.tokenContractId,
        formData.recipientAddress,
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

  const onSubmit = async (_data: MintFormData) => {
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
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="glass-card p-6 space-y-6"
    >
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
          <p className="text-red-400 text-sm mt-1">
            {errors.tokenContractId.message}
          </p>
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
          <p className="text-red-400 text-sm mt-1">
            {errors.recipientAddress.message}
          </p>
        )}
      </div>

      <Controller
        name="amount"
        control={control}
        render={({ field }) => (
          <NumericInput
            label="Amount"
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
            successMessage={
              preflightResult.success ? "Ready to mint tokens" : undefined
            }
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
          disabled={
            !isValid || isSubmitting || !(preflightResult?.success ?? false)
          }
          isLoading={isSubmitting}
        >
          <Rocket className="w-4 h-4" />
          Mint Tokens
        </Button>
      </div>
    </form>
  );
}