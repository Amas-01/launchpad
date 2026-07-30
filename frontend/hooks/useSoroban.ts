"use client";

import { useCallback, useMemo } from "react";
import { useNetwork } from "../app/providers/NetworkProvider";
import * as stellar from "../lib/stellar";

/**
 * A hook that provides network-aware Soroban functions.
 * These functions automatically use the current network configuration
 * from the NetworkProvider.
 */
export function useSoroban() {
  const { networkConfig } = useNetwork();

  const fetchTokenInfo = useCallback(
    (contractId: string) => stellar.fetchTokenInfo(contractId, networkConfig),
    [networkConfig],
  );

  const validateTokenContract = useCallback(
    (contractId: string) => stellar.validateTokenContract(contractId, networkConfig),
    [networkConfig],
  );

  const fetchTokenBalance = useCallback(
    (contractId: string, accountId: string) =>
      stellar.fetchTokenBalance(contractId, accountId, networkConfig),
    [networkConfig],
  );

  const fetchTopHolders = useCallback(
    (contractId: string, symbol?: string, issuer?: string, limit?: number) =>
      stellar.fetchTopHolders(contractId, networkConfig, symbol, issuer, limit),
    [networkConfig],
  );

  const fetchCurrentLedger = useCallback(
    () => stellar.fetchCurrentLedger(networkConfig),
    [networkConfig],
  );

  const fetchVestingSchedule = useCallback(
    (vestingContractId: string, recipient: string, scheduleIndex?: number) =>
      stellar.fetchVestingSchedule(vestingContractId, recipient, networkConfig, scheduleIndex),
    [networkConfig],
  );

  const fetchVestedAmount = useCallback(
    (vestingContractId: string, recipient: string, scheduleIndex?: number) =>
      stellar.fetchVestedAmount(vestingContractId, recipient, networkConfig, scheduleIndex),
    [networkConfig],
  );

  const fetchVestingScheduleCount = useCallback(
    (vestingContractId: string, recipient: string) =>
      stellar.fetchVestingScheduleCount(vestingContractId, recipient, networkConfig),
    [networkConfig],
  );
  const fetchSupplyBreakdown = useCallback(
    (tokenContractId: string, vestingContractId?: string) =>
      stellar.fetchSupplyBreakdown(
        tokenContractId,
        networkConfig,
        vestingContractId,
      ),
    [networkConfig],
  );

  const fetchAccountBalances = useCallback(
    (publicKey: string) =>
      stellar.fetchAccountBalances(publicKey, networkConfig),
    [networkConfig],
  );

  const buildBurnTransaction = useCallback(
    (tokenContractId: string, fromAddress: string, amount: string, decimals: number) =>
      stellar.buildBurnTransaction(tokenContractId, fromAddress, amount, decimals, networkConfig),
    [networkConfig],
  );

  const fetchTransactionHistory = useCallback(
    (contractId: string, options?: { cursor?: string; limit?: number }) =>
      stellar.fetchTransactionHistory(contractId, networkConfig, options),
    [networkConfig],
  );

  const fetchAccountOperations = useCallback(
    (accountId: string, cursor?: string, limit?: number) =>
      stellar.fetchAccountOperations(accountId, networkConfig, cursor, limit),
    [networkConfig],
  );

  const submitTransaction = useCallback(
    (signedXdr: string) => stellar.submitTransaction(signedXdr, networkConfig),
    [networkConfig],
  );
  return useMemo(
    () => ({
      fetchTokenInfo,
      validateTokenContract,
      fetchTokenBalance,
      fetchTopHolders,
      fetchCurrentLedger,
      fetchVestingSchedule,
      fetchVestedAmount,
      fetchVestingScheduleCount,
      fetchSupplyBreakdown,
      fetchAccountBalances,
      fetchTransactionHistory,
      fetchAccountOperations,
      buildBurnTransaction,
      submitTransaction,
      networkConfig,
      // Pass through formatting helpers which don't need config
      formatTokenAmount: stellar.formatTokenAmount,
      truncateAddress: stellar.truncateAddress,
    }),
    [
      fetchTokenInfo,
      validateTokenContract,
      fetchTokenBalance,
      fetchTopHolders,
      fetchCurrentLedger,
      fetchVestingSchedule,
      fetchVestedAmount,
      fetchVestingScheduleCount,
      fetchSupplyBreakdown,
      fetchAccountBalances,
      fetchTransactionHistory,
      fetchAccountOperations,
      buildBurnTransaction,
      submitTransaction,
      networkConfig,
    ],
  );
}
