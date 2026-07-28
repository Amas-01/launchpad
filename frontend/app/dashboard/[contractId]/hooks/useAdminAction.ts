"use client";

import { useCallback, useMemo, useState } from "react";
import { TransactionBuilder, rpc, Contract, xdr } from "@stellar/stellar-sdk";
import { useWallet } from "../../../hooks/useWallet";
import { useNetwork } from "../../../providers/NetworkProvider";
import { useToast } from "../../../providers/ToastProvider";
import { useTransactionSimulator } from "@/hooks/useTransactionSimulator";
import { scValToNative } from "@/lib/soroban";
import type { PreflightCheckResult } from "@/lib/transactionSimulator";
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

/**
 * A deterministic dummy account, used as the source for read-only simulations
 * so getters work before (or without) a connected wallet.
 */
const READ_ONLY_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

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
  read: (method: string, args?: xdr.ScVal[]) => Promise<unknown>;
}

export function useAdminAction(
  contractId: string,
  decimals: number,
): UseAdminActionResult {
  const { signTransaction, publicKey } = useWallet();
  const { networkConfig } = useNetwork();
  const toast = useToast();
  const simulator = useTransactionSimulator();

  const [loading, setLoading] = useState<AdminActionKey | null>(null);
  const [success, setSuccess] = useState<AdminActionKey | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [preflight, setPreflight] = useState<
    Partial<Record<AdminActionKey, PreflightCheckResult | null>>
  >({});

  // One client per network, not one per call site.
  const server = useMemo(
    () => new rpc.Server(networkConfig.rpcUrl),
    [networkConfig.rpcUrl],
  );

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

  const read = useCallback(
    async (method: string, args: xdr.ScVal[] = []): Promise<unknown> => {
      try {
        const { Account } = await import("@stellar/stellar-sdk");
        const tx = new TransactionBuilder(new Account(READ_ONLY_SOURCE, "0"), {
          fee: "100",
          networkPassphrase: networkConfig.passphrase,
        })
          .addOperation(new Contract(contractId).call(method, ...args))
          .setTimeout(30)
          .build();

        const sim = await server.simulateTransaction(tx);
        // A simulation error usually means an older deployment without this
        // getter. Callers treat `null` as "unknown" rather than surfacing it.
        if (rpc.Api.isSimulationError(sim)) return null;
        if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return null;
        return scValToNative(sim.result.retval);
      } catch {
        return null;
      }
    },
    [contractId, networkConfig.passphrase, server],
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
      };

      try {
        const call = await def.resolve(data, ctx);
        const targetContractId = call.contractId ?? contractId;

        // 1. Preflight — capability-specific where it adds diagnostics,
        //    generic simulation otherwise, skipped for input-free calls.
        const mode = def.preflight ?? "simulate";
        let result: PreflightCheckResult | null = null;
        if (typeof mode === "function") {
          result = await mode(data, ctx);
        } else if (mode === "simulate") {
          result = await simulator.simulateContract(
            targetContractId,
            call.method,
            call.args,
            publicKey,
          );
        }

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

        // 2. Build, simulate, assemble.
        const account = await server.getAccount(publicKey);
        const tx = new TransactionBuilder(account, {
          fee: "1000",
          networkPassphrase: networkConfig.passphrase,
        })
          .addOperation(
            new Contract(targetContractId).call(call.method, ...call.args),
          )
          .setTimeout(30)
          .build();

        const sim = await server.simulateTransaction(tx);
        if (rpc.Api.isSimulationError(sim)) {
          throw new Error(`Simulation failed: ${sim.error}`);
        }
        const prepared = rpc.assembleTransaction(tx, sim).build();

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
