"use client";

import { useCallback, useMemo } from "react";
import { TransactionBuilder, rpc, Contract, xdr } from "@stellar/stellar-sdk";
import { useNetwork } from "../../../providers/NetworkProvider";
import { scValToNative } from "@/lib/soroban";

/**
 * One RPC client per network, plus a read-only simulation helper.
 *
 * Everything on the dashboard that needs to call a contract getter shares this
 * so a mid-session network switch moves every caller at once, rather than
 * leaving stale clients pointed at the previous endpoint.
 */

/**
 * A deterministic dummy account, used as the source for read-only simulations
 * so getters work before (or without) a connected wallet.
 */
const READ_ONLY_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export type ContractReadFn = (
  method: string,
  args?: xdr.ScVal[],
) => Promise<unknown>;

export function useContractRead(contractId: string): {
  server: rpc.Server;
  read: ContractReadFn;
} {
  const { networkConfig } = useNetwork();

  const server = useMemo(
    () => new rpc.Server(networkConfig.rpcUrl),
    [networkConfig.rpcUrl],
  );

  const read = useCallback<ContractReadFn>(
    async (method, args = []) => {
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

  return { server, read };
}
