import * as StellarSdk from "@stellar/stellar-sdk";
import type { NetworkConfig } from "../types/network";
import { fetchTokenInfo } from "./stellar";

export interface ExploreToken {
  contractId: string;
  name: string;
  symbol: string;
  totalSupply: string;
  decimals: number;
  /** Position in the factory registry; higher means deployed later. */
  index: number;
}

export const EXPLORE_WINDOW = 100;

async function simulateRead(
  config: NetworkConfig,
  factoryAddress: string,
  method: string,
  ...args: StellarSdk.xdr.ScVal[]
): Promise<StellarSdk.xdr.ScVal> {
  const rpc = new StellarSdk.rpc.Server(config.rpcUrl);
  // Simulation needs a source account that exists; any funded-agnostic
  // placeholder works for read-only calls when using a random keypair-free
  // account object.
  const account = new StellarSdk.Account(StellarSdk.Keypair.random().publicKey(), "0");
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.passphrase,
  })
    .addOperation(new StellarSdk.Contract(factoryAddress).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  if (!StellarSdk.rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error(`Factory call ${method} failed`);
  }
  return sim.result.retval;
}

/**
 * Read the newest `EXPLORE_WINDOW` launches from the factory registry
 * (`get_deployments_paginated`), newest first, enriched with on-chain
 * name/symbol/supply.
 */
export async function fetchRegistryTokens(
  config: NetworkConfig,
  factoryAddress: string,
): Promise<ExploreToken[]> {
  const count = Number(
    StellarSdk.scValToNative(await simulateRead(config, factoryAddress, "get_deployment_count")),
  );
  if (!count) return [];

  const start = Math.max(0, count - EXPLORE_WINDOW);
  const limit = count - start;
  const addresses = StellarSdk.scValToNative(
    await simulateRead(
      config,
      factoryAddress,
      "get_deployments_paginated",
      StellarSdk.nativeToScVal(start, { type: "u32" }),
      StellarSdk.nativeToScVal(limit, { type: "u32" }),
    ),
  ) as string[];

  const settled = await Promise.allSettled(
    addresses.map((addr) => fetchTokenInfo(addr, config)),
  );

  const tokens: ExploreToken[] = [];
  settled.forEach((res, i) => {
    if (res.status !== "fulfilled") return;
    const info = res.value;
    tokens.push({
      contractId: addresses[i],
      name: info.name,
      symbol: info.symbol,
      totalSupply: info.totalSupply,
      decimals: info.decimals,
      index: start + i,
    });
  });
  return tokens.sort((a, b) => b.index - a.index);
}

export type ExploreSort = "newest" | "oldest";

export function filterAndSort(
  tokens: ExploreToken[],
  query: string,
  sort: ExploreSort,
): ExploreToken[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? tokens.filter(
        (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
      )
    : tokens;
  return [...filtered].sort((a, b) => (sort === "newest" ? b.index - a.index : a.index - b.index));
}
