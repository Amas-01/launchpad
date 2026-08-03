"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PreflightCheckDisplay } from "@/components/ui/PreflightCheck";
import { useTransactionSimulator } from "@/hooks/useTransactionSimulator";
import { useWallet } from "@/app/hooks/useWallet";
import { buildApproveTransaction, fetchCurrentLedger, fetchTokenDecimals, parseTokenAmount, submitTransaction } from "@/lib/stellar";
import { daysToLedgers } from "@/lib/soroban";
import { useNetwork } from "@/app/providers/NetworkProvider";
import { AlertCircle, CheckCircle, Rocket, Loader2 } from "lucide-react";

const approveSchema = z.object({
  tokenContractId: z.string().regex(/^C[A-Z0-9]{55}$/, "Invalid token contract ID"),
  spenderAddress: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid spender address"),
  amount: z
    .string()
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, "Amount must be positive"),
  expirationDays: z.string().refine(
    (v) => !isNaN(parseInt(v)) && parseInt(v) >= 0,
    "Expiration days must be 0 or more",
  ),
});

type ApproveFormData = z.infer<typeof approveSchema>;

interface ApproveFormProps {
  onSuccess?: (txHash: string) => void;
  onError?: (error: string) => void;
}

/**
 * Approve Form - Grant an allowance to a spender address
 */
export function ApproveForm({ onSuccess, onError }: ApproveFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preflightResult, setPreflightResult] = useState<{
    isLoading: boolean;
    success: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const { connected, publicKey, signTransaction, connect } = useWallet();
  const { networkConfig } = useNetwork();
  const simulator = useTransactionSimulator();

  const {
    register,
    trigger,
    formState: { errors, isValid },
    watch,
    reset,
  } = useForm<ApproveFormData>({
    resolver: zodResolver(approveSchema),
    mode: "onChange",
    defaultValues: {
      expirationDays: "365",
    },
  });

  const formData = watch();

  const getExpirationLedger = async (days: string): Promise<number> => {
    const currentLedger = await fetchCurrentLedger(networkConfig);
    return daysToLedgers(days || "365", currentLedger);
  };

  const handleCheck = async () => {
    const isValid = await trigger();
    if (!isValid) return;

    setPreflightResult({ isLoading: true, success: false, errors: [], warnings: [] });

    try {
      const ledger = await getExpirationLedger(formData.expirationDays);
      const decimals = await fetchTokenDecimals(formData.tokenContractId, simulator.networkConfig);
      const rawAmount = parseTokenAmount(formData.amount, decimals);
      const result = await simulator.checkApprove(
        formData.tokenContractId,
        publicKey || "",
        formData.spenderAddress,
        rawAmount,
        ledger,
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

  const onSubmit = async () => {
    if (!preflightResult?.success) {
      onError?.("Please run preflight check first");
      return;
    }

    if (!connected || !publicKey) {
      onError?.("Please connect your wallet first");
      await connect();
      return;
    }

    setIsSubmitting(true);
    try {
      const expirationLedger = await getExpirationLedger(formData.expirationDays);
      const decimals = await fetchTokenDecimals(formData.tokenContractId, simulator.networkConfig);
      const rawAmount = parseTokenAmount(formData.amount, decimals);

      const xdr = await buildApproveTransaction({
        tokenContractId: formData.tokenContractId,
        ownerAddress: publicKey,
        spenderAddress: formData.spenderAddress,
        amount: rawAmount,
        expirationLedger,
        config: networkConfig,
      });

      const signedXdr = await signTransaction(xdr);
      const hash = await submitTransaction(signedXdr, networkConfig);
      setTxHash(hash);
      onSuccess?.(hash);
      reset();
      setPreflightResult(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction failed";
      onError?.(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">Grant Allowance</h2>
        <p className="text-sm text-gray-400 mb-6">
          Grant a spender address the right to transfer tokens on your behalf.
        </p>
      </div>

      <div className="space-y-4">
        <Input
          label="Token Contract ID"
          {...register("tokenContractId")}
          placeholder="C..."
          className="font-mono text-sm"
          error={errors.tokenContractId?.message}
        />

        <Input
          label="Spender Address"
          {...register("spenderAddress")}
          placeholder="G..."
          className="font-mono text-sm"
          error={errors.spenderAddress?.message}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Amount"
            {...register("amount")}
            placeholder="0.00"
            type="number"
            step="0.01"
            error={errors.amount?.message}
          />

          <Input
            label="Expiration (Days)"
            {...register("expirationDays")}
            placeholder="365"
            type="number"
            min="0"
            error={errors.expirationDays?.message}
          />
        </div>
      </div>

      {preflightResult && (
        <PreflightCheckDisplay
          errors={preflightResult.errors}
          warnings={preflightResult.warnings}
          isLoading={preflightResult.isLoading}
        />
      )}

      {txHash && (
        <div className="flex items-center gap-3 p-4 bg-green-600/10 border border-green-600/50 rounded-lg">
          <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-400">Allowance granted!</p>
            <p className="text-xs text-green-300">TX: {txHash}</p>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          onClick={handleCheck}
          disabled={!isValid || simulator.isLoading}
          variant="secondary"
          className="flex items-center gap-2"
        >
          {simulator.isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking...
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4" />
              Run Preflight Check
            </>
          )}
        </Button>

        <Button
          onClick={onSubmit}
          disabled={!preflightResult?.success || isSubmitting}
          className="flex items-center gap-2"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Approving...
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4" />
              Sign & Approve
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
