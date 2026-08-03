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
import {
  buildRevokeAllowanceTransaction,
  submitTransaction,
} from "@/lib/stellar";
import { useNetwork } from "@/app/providers/NetworkProvider";
import { AlertCircle, CheckCircle, Trash2, Loader2 } from "lucide-react";

const revokeSchema = z.object({
  tokenContractId: z.string().regex(/^C[A-Z0-9]{55}$/, "Invalid token contract ID"),
  spenderAddress: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid spender address"),
});

type RevokeFormData = z.infer<typeof revokeSchema>;

interface RevokeAllowanceFormProps {
  onSuccess?: (txHash: string) => void;
  onError?: (error: string) => void;
}

/**
 * Revoke Allowance Form - Revoke an allowance granted to a spender
 */
export function RevokeAllowanceForm({ onSuccess, onError }: RevokeAllowanceFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preflightResult, setPreflightResult] = useState<{
    isLoading: boolean;
    success: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const { connected, publicKey, signTransaction, connect } = useWallet();
  const { networkConfig } = useNetwork();
  const simulator = useTransactionSimulator();

  const {
    register,
    trigger,
    formState: { errors, isValid },
    watch,
    reset,
  } = useForm<RevokeFormData>({
    resolver: zodResolver(revokeSchema),
    mode: "onChange",
  });

  const formData = watch();

  const handleCheck = async () => {
    const isValid = await trigger();
    if (!isValid) return;

    setPreflightResult({ isLoading: true, success: false, errors: [], warnings: [] });

    try {
      const result = await simulator.checkRevokeAllowance(
        formData.tokenContractId,
        publicKey || "",
        formData.spenderAddress,
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
      const xdr = await buildRevokeAllowanceTransaction({
        tokenContractId: formData.tokenContractId,
        ownerAddress: publicKey,
        spenderAddress: formData.spenderAddress,
        config: networkConfig,
      });

      const signedXdr = await signTransaction(xdr);
      const hash = await submitTransaction(signedXdr, networkConfig);
      setTxHash(hash);
      onSuccess?.(hash);
      reset();
      setPreflightResult(null);
      setShowConfirm(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Revocation failed";
      onError?.(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">Revoke Allowance</h2>
        <p className="text-sm text-gray-400 mb-6">
          Remove the ability of a spender to transfer tokens on your behalf.
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
            <p className="text-sm font-medium text-green-400">Allowance revoked!</p>
            <p className="text-xs text-green-300">TX: {txHash}</p>
          </div>
        </div>
      )}

      {showConfirm && preflightResult?.success && (
        <div className="p-4 bg-yellow-600/10 border border-yellow-600/50 rounded-lg">
          <p className="text-sm text-yellow-300 font-medium mb-3">
            Are you sure? Once revoked, {formData.spenderAddress.slice(0, 8)}... cannot transfer
            your tokens.
          </p>
          <div className="flex gap-2">
            <Button
              onClick={onSubmit}
              disabled={isSubmitting}
              variant="secondary"
              className="flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Revoking...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Confirm Revoke
                </>
              )}
            </Button>
            <Button onClick={() => setShowConfirm(false)} variant="secondary">
              Cancel
            </Button>
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

        {preflightResult?.success && !showConfirm && (
          <Button
            onClick={() => setShowConfirm(true)}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700"
          >
            <Trash2 className="h-4 w-4" />
            Revoke Allowance
          </Button>
        )}
      </div>
    </div>
  );
}
