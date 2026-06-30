"use client";

import { useState, useCallback } from "react";
import { useNetwork } from "@/app/providers/NetworkProvider";
import {
  simulateTransaction,
  simulateTransfer,
  simulateMint,
  simulateBurn,
  simulateTransferFrom,
  simulateVestingRelease,
  simulateVestingRevoke,
  simulateCreateSchedule,
  simulateApprove,
  simulateRevokeAllowance,
  simulateTokenDeployment,
  type PreflightCheckResult,
} from "@/lib/transactionSimulator";
import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * useTransactionSimulator - A hook for running pre-flight transaction checks
 *
 * Provides methods to simulate different types of transactions and get
 * user-friendly error feedback before prompting the user to sign.
 */
export function useTransactionSimulator() {
  const { networkConfig } = useNetwork();
  const [isLoading, setIsLoading] = useState(false);

  const runSimulation = useCallback(
    async (
      fn: () => Promise<PreflightCheckResult>,
    ): Promise<PreflightCheckResult> => {
      setIsLoading(true);
      try {
        return await fn();
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return {
    isLoading,
    networkConfig,

    /**
     * Simulate a generic transaction
     */
    async simulateContract(
      contractId: string,
      method: string,
      args: StellarSdk.xdr.ScVal[],
      sourcePublicKey?: string,
    ): Promise<PreflightCheckResult> {
      return runSimulation(() =>
        simulateTransaction(contractId, method, args, networkConfig, sourcePublicKey),
      );
    },

    /**
     * Simulate a transfer operation
     */
    async checkTransfer(
      contractId: string,
      fromAddress: string,
      toAddress: string,
      amount: bigint | string,
    ): Promise<PreflightCheckResult> {
      return runSimulation(() =>
        simulateTransfer(contractId, fromAddress, toAddress, amount, networkConfig),
      );
    },

    /**
     * Simulate a mint operation
     */
    async checkMint(
      contractId: string,
      toAddress: string,
      amount: bigint | string,
      adminAddress: string,
    ): Promise<PreflightCheckResult> {
      return runSimulation(() =>
        simulateMint(contractId, toAddress, amount, adminAddress, networkConfig),
      );
    },

    /**
     * Simulate a burn operation
     */
    async checkBurn(
      contractId: string,
      fromAddress: string,
      amount: bigint | string,
      adminAddress: string,
    ): Promise<PreflightCheckResult> {
      return runSimulation(() =>
        simulateBurn(contractId, fromAddress, amount, adminAddress, networkConfig),
      );
    },

    /**
     * Simulate a transfer_from operation
     */
    async checkTransferFrom(
      contractId: string,
      spenderAddress: string,
      fromAddress: string,
      toAddress: string,
      amount: bigint | string,
    ): Promise<PreflightCheckResult> {
      return runSimulation(() =>
        simulateTransferFrom(
          contractId,
          spenderAddress,
          fromAddress,
          toAddress,
          amount,
          networkConfig,
        ),
      );
    },

    /**
     * Simulate a vesting release operation
     */
    async checkVestingRelease(
      vestingContractId: string,
      recipientAddress: string,
      scheduleIndex?: number,
    ): Promise<PreflightCheckResult> {
      return runSimulation(() =>
        simulateVestingRelease(vestingContractId, recipientAddress, networkConfig, scheduleIndex),
      );
    },

    /**
     * Simulate a vesting revoke operation
     */
    async checkVestingRevoke(
      vestingContractId: string,
      recipientAddress: string,
      adminAddress: string,
      scheduleIndex?: number,
    ): Promise<PreflightCheckResult> {
      return runSimulation(() =>
        simulateVestingRevoke(
          vestingContractId,
          recipientAddress,
          adminAddress,
          networkConfig,
          scheduleIndex,
        ),
      );
    },

    /**
     * Simulate a token deployment pre-flight check.
     * Validates RPC connectivity, admin account existence, and argument
     * encoding without submitting any transaction.
     */
    async checkTokenDeployment(
      adminAddress: string,
      name: string,
      symbol: string,
      decimals: number,
      initialSupply: bigint,
      maxSupply: bigint | null,
      authorizationRequired: boolean = false,
      authorizationRevocable: boolean = false,
      complianceNodeAddress: string | null = null,
      sourcePublicKey?: string,
    ): Promise<PreflightCheckResult> {
      return runSimulation(() =>
        simulateTokenDeployment(
          adminAddress,
          name,
          symbol,
          decimals,
          initialSupply,
          maxSupply,
          networkConfig,
          authorizationRequired,
          authorizationRevocable,
          complianceNodeAddress,
          sourcePublicKey,
        ),
      );
    },

    /**
     * Simulate a create vesting schedule operation
     */
    async checkCreateSchedule(
      vestingContractId: string,
      recipientAddress: string,
      totalAmount: bigint | string,
      cliffLedger: number,
      endLedger: number,
      adminAddress: string,
    ): Promise<PreflightCheckResult> {
      return runSimulation(() =>
        simulateCreateSchedule(
          vestingContractId,
          recipientAddress,
          totalAmount,
          cliffLedger,
          endLedger,
          adminAddress,
          networkConfig,
        ),
      );
    },

    /**
     * Simulate an approve (grant allowance) operation
     */
    async checkApprove(
      contractId: string,
      ownerAddress: string,
      spenderAddress: string,
      amount: bigint | string,
      expirationLedger?: number,
    ): Promise<PreflightCheckResult> {
      return runSimulation(() =>
        simulateApprove(
          contractId,
          ownerAddress,
          spenderAddress,
          amount,
          expirationLedger,
          networkConfig,
        ),
      );
    },

    /**
     * Simulate a revoke allowance operation
     */
    async checkRevokeAllowance(
      contractId: string,
      ownerAddress: string,
      spenderAddress: string,
    ): Promise<PreflightCheckResult> {
      return runSimulation(() =>
        simulateRevokeAllowance(contractId, ownerAddress, spenderAddress, networkConfig),
      );
    },
  };
}
