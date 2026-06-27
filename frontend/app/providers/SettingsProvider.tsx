"use client";

import {
  createContext,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useNetwork } from "./NetworkProvider";
import { NETWORKS, type NetworkType } from "../../types/network";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

function getDefaultRpcUrl(network: NetworkType): string {
  if (network === "mainnet") {
    return (
      process.env.NEXT_PUBLIC_MAINNET_SOROBAN_RPC_URL ??
      process.env.NEXT_PUBLIC_MAINNET_RPC_URL ??
      NETWORKS.mainnet.rpcUrl
    );
  }

  return (
    process.env.NEXT_PUBLIC_TESTNET_SOROBAN_RPC_URL ??
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
    NETWORKS.testnet.rpcUrl
  );
}

function getDefaultHorizonUrl(network: NetworkType): string {
  if (network === "mainnet") {
    return (
      process.env.NEXT_PUBLIC_MAINNET_HORIZON_URL ?? NETWORKS.mainnet.horizonUrl
    );
  }

  return (
    process.env.NEXT_PUBLIC_TESTNET_HORIZON_URL ??
    process.env.NEXT_PUBLIC_HORIZON_URL ??
    NETWORKS.testnet.horizonUrl
  );
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------
export interface SettingsContextValue {
  rpcUrl: string;
  horizonUrl: string;
  defaultRpcUrl: string;
  defaultHorizonUrl: string;
  setRpcUrl: (url: string) => void;
  setHorizonUrl: (url: string) => void;
  resetToDefaults: () => void;
}

export const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined,
);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function SettingsProvider({ children }: { children: ReactNode }) {
  const {
    networkConfig,
    customRpcUrl,
    customHorizonUrl,
    setCustomRpcUrl,
    setCustomHorizonUrl,
  } = useNetwork();

  const defaultRpcUrl = useMemo(
    () => getDefaultRpcUrl(networkConfig.network),
    [networkConfig.network],
  );
  const defaultHorizonUrl = useMemo(
    () => getDefaultHorizonUrl(networkConfig.network),
    [networkConfig.network],
  );

  const rpcUrl = customRpcUrl ?? defaultRpcUrl;
  const horizonUrl = customHorizonUrl ?? defaultHorizonUrl;

  const setRpcUrl = useCallback(
    (url: string) => {
      setCustomRpcUrl(url);
    },
    [setCustomRpcUrl],
  );

  const setHorizonUrl = useCallback(
    (url: string) => {
      setCustomHorizonUrl(url);
    },
    [setCustomHorizonUrl],
  );

  const resetToDefaults = useCallback(() => {
    setCustomRpcUrl(null);
    setCustomHorizonUrl(null);
  }, [setCustomRpcUrl, setCustomHorizonUrl]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      rpcUrl,
      horizonUrl,
      defaultRpcUrl,
      defaultHorizonUrl,
      setRpcUrl,
      setHorizonUrl,
      resetToDefaults,
    }),
    [
      defaultHorizonUrl,
      defaultRpcUrl,
      rpcUrl,
      horizonUrl,
      setRpcUrl,
      setHorizonUrl,
      resetToDefaults,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
