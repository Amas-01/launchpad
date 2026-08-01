"use client";

import { useCallback, useState } from "react";
import { TransactionBuilder, rpc, Contract } from "@stellar/stellar-sdk";
import { Client as TokenClient } from "@/lib/bindings/token/src/index";
import { Client as VestingClient } from "@/lib/bindings/vesting/src/index";
import { parseSorobanError } from "@/lib/transactionSimulator";
import { useWallet } from "../../../hooks/useWallet";
import { useNetwork } from "../../../providers/NetworkProvider";
import { useToast } from "../../../providers/ToastProvider";
import { useTransactionSimulator } from "@/hooks/useTransactionSimulator";
import type { PreflightCheckResult } from "@/lib/transactionSimulator";
import { useContractRead, type ContractReadFn } from "./useContractRead";
import {
  ADMIN_ACTIONS,
  type AdminActionContext,
  type AdminActionData,
  type AdminActionKey,
} from "../components/admin/adminActions";

/**
 * The shared admin transaction pipeline.
 *
 * Every admin capability follows the same sequence: resolve the contract call,
 * preflight it, build it, simulate it, ask the wallet to sign, submit, poll for
 * the result, then toast and refresh. `AdminPanel` used to inline that sequence
 * once per capability and constructed a fresh `rpc.Server` eleven separate
 * times — which meant a network switch mid-session could leave different
 * actions pointed at different endpoints. The hook now owns one client and one
 * copy of the sequence.
 */

export interface UseAdminActionResult {
  /** The single shared RPC client, derived from the active network. */
  server: rpc.Server;
  /** Key of the action currently in flight, or `null`. */
  loading: AdminActionKey | null;
  /** Key of the action that most recently succeeded, or `null`. */
  success: AdminActionKey | null;
  lastTxHash: string | null;
  /** Screen-reader announcement for the panel's aria-live region. */
  announcement: string;
  /** Preflight results keyed by action, so each card renders its own. */
  preflight: Partial<Record<AdminActionKey, PreflightCheckResult | null>>;
  clearPreflight: (action: AdminActionKey) => void;
  /** True while a preflight simulation is running. */
  isSimulating: boolean;
  /**
   * Run an admin action end to end. Resolves `true` when the transaction was
   * submitted successfully, `false` on any failure (already toasted).
   */
  run: <K extends AdminActionKey>(
    action: K,
    data: AdminActionData[K],
  ) => Promise<boolean>;
  /**
   * Simulate a read-only contract getter and return its decoded value.
   * Resolves `null` when the call is unavailable or fails, so callers can
   * degrade gracefully on older deployments.
   */
  read: ContractReadFn;
}

export function useAdminAction(
  contractId: string,
  decimals: number,
): UseAdminActionResult {
  const { signTransaction, publicKey } = useWallet();
  const { networkConfig } = useNetwork();
  const toast = useToast();
  const simulator = useTransactionSimulator();
  // One client per network, not one per call site.
  const { server, read } = useContractRead(contractId);

  const [loading, setLoading] = useState<AdminActionKey | null>(null);
  const [success, setSuccess] = useState<AdminActionKey | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [preflight, setPreflight] = useState<
    Partial<Record<AdminActionKey, PreflightCheckResult | null>>
  >({});

  const clearPreflight = useCallback((action: AdminActionKey) => {
    setPreflight((prev) => ({ ...prev, [action]: null }));
  }, []);

  /** Submit a signed transaction and poll until it settles. */
  const submitSigned = useCallback(
    async (signedXdr: string) => {
      const signedTx = TransactionBuilder.fromXDR(
        signedXdr,
        networkConfig.passphrase,
      );
      const send = await server.sendTransaction(
        signedTx as Parameters<typeof server.sendTransaction>[0],
      );
      if (send.status === "ERROR") {
        throw new Error(
          `Submit failed: ${send.errorResult?.toXDR("base64") ?? "unknown"}`,
        );
      }

      let response = await server.getTransaction(send.hash);
      let attempts = 0;
      while (response.status === "NOT_FOUND" && attempts < 30) {
        await new Promise((r) => setTimeout(r, 1000));
        response = await server.getTransaction(send.hash);
        attempts += 1;
      }

      if (response.status === "FAILED") {
        throw new Error("Transaction failed on-chain");
      }

      return send.hash;
    },
    [networkConfig.passphrase, server],
  );

  const run = useCallback(
    async <K extends AdminActionKey>(
      action: K,
      data: AdminActionData[K],
    ): Promise<boolean> => {
      if (!publicKey) return false;

      const def = ADMIN_ACTIONS[action];
      setLoading(action);
      setSuccess(null);
      setLastTxHash(null);

      const ctx: AdminActionContext = {
        contractId,
        decimals,
        publicKey,
        server,
        simulator,
        tokenClient: new TokenClient({
          networkPassphrase: networkConfig.passphrase,
          contractId,
          rpcUrl: server.serverURL.toString(),
          publicKey,
        }),
        getVestingClient: (vestingContractId: string) => new VestingClient({
          networkPassphrase: networkConfig.passphrase,
          contractId: vestingContractId,
          rpcUrl: server.serverURL.toString(),
          publicKey,
        })
      };

      try {
        // 1. Preflight
        if (typeof def.preflight === "function") {
          const result = await def.preflight(data, ctx);
          if (result) {
            setPreflight((prev) => ({ ...prev, [action]: result }));
          }
          if (result?.errors?.length) {
            toast.show({
              title: `${def.label} simulation failed`,
              message: result.errors[0],
              variant: "error",
            });
            return false;
          }
        }

        // 2. Build and simulate using typed bindings
        let assembledTx;
        try {
          assembledTx = await def.resolve(data, ctx);
        } catch (simErr) {
          const errorMessage = simErr instanceof Error ? simErr.message : String(simErr);
          const userFriendlyError = parseSorobanError(errorMessage);
          
          setPreflight((prev) => ({
            ...prev,
            [action]: {
              success: false,
              warnings: [],
              errors: [userFriendlyError],
            },
          }));
          
          toast.show({
            title: `${def.label} simulation failed`,
            message: userFriendlyError,
            variant: "error",
          });
          return false;
        }

        const prepared = assembledTx.built!;

        // 3. Sign and submit.
        let signedXdr: string;
        try {
          signedXdr = await signTransaction(prepared.toXDR(), {
            networkPassphrase: networkConfig.passphrase,
          });
        } catch (signError) {
          setAnnouncement(`${def.label} signing failed.`);
          throw signError;
        }

        const txHash = await submitSigned(signedXdr);

        setLastTxHash(txHash);
        setSuccess(action);
        setAnnouncement(
          `${def.label} transaction submitted successfully. Transaction hash ${txHash}.`,
        );
        if (def.successToast) {
          toast.show({
            ...def.successToast,
            variant: "success",
            duration: 8_000,
            txHash,
          });
        }
        return true;
      } catch (err) {
        const error = err as Error;
        console.error(`${action} failed:`, error);
        setAnnouncement(`${def.label} transaction failed.`);
        toast.show({
          title: `${def.label} failed`,
          message: error.message,
          variant: "error",
        });
        return false;
      } finally {
        setLoading(null);
      }
    },
    [
      contractId,
      decimals,
      networkConfig.passphrase,
      publicKey,
      server,
      signTransaction,
      simulator,
      submitSigned,
      toast,
    ],
  );

  return {
    server,
    loading,
    success,
    lastTxHash,
    announcement,
    preflight,
    clearPreflight,
    isSimulating: simulator.isLoading,
    run,
    read,
  };
}
