"use client";

import { useCallback } from "react";
import * as StellarSdk from "@stellar/stellar-sdk";
import { useWallet } from "./useWallet";

// Generate random bytes for salt
function randomBytes(length: number): Buffer {
  const array = new Uint8Array(length);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(array);
  } else {
    // Fallback for Node.js environment (shouldn't happen in client component)
    for (let i = 0; i < length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Buffer.from(array);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
  "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
  StellarSdk.Networks.TESTNET;
const TOKEN_WASM_HASH = process.env.NEXT_PUBLIC_TOKEN_WASM_HASH;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface DeployTokenParams {
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: number;
  maxSupply?: number;
  adminAddress: string;
  authorizationRequired?: boolean;
  authorizationRevocable?: boolean;
  complianceNodeAddress?: string;
}

export interface DeployTokenResult {
  contractId: string;
  transactionHash: string;
}

export interface DeployTokenError {
  message: string;
  type: "validation" | "simulation" | "wallet" | "broadcast" | "timeout";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Custom hook for deploying a Soroban SEP-41 token contract.
 *
 * Encapsulates the four-step deployment flow:
 * 1. Build the deployment transaction
 * 2. Simulate the transaction
 * 3. Request wallet signature
 * 4. Broadcast and poll for result
 *
 * @example
 * ```tsx
 * const { deployToken, isDeploying } = useDeployToken();
 *
 * const handleDeploy = async () => {
 *   try {
 *     const result = await deployToken({
 *       name: "My Token",
 *       symbol: "MTK",
 *       decimals: 7,
 *       initialSupply: 1000000,
 *       adminAddress: "GABC..."
 *     });
 *     console.log("Deployed:", result.contractId);
 *   } catch (err) {
 *     console.error("Deployment failed:", err);
 *   }
 * };
 * ```
 */
export function useDeployToken() {
  const { connected, publicKey, signTransaction } = useWallet();

  const deployToken = useCallback(
    async (params: DeployTokenParams): Promise<DeployTokenResult> => {
      // ── Step 0: Validation ────────────────────────────────────────────
      if (!connected || !publicKey) {
        throw {
          message: "Wallet not connected. Please connect your wallet and try again.",
          type: "validation",
        } as DeployTokenError;
      }

      if (!TOKEN_WASM_HASH) {
        throw {
          message:
            "Token WASM hash not configured. Please set NEXT_PUBLIC_TOKEN_WASM_HASH in your environment.",
          type: "validation",
        } as DeployTokenError;
      }

      const rpc = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);

      // ── Step 1: Build Transaction ─────────────────────────────────────
      // Load the source account to get the current sequence number
      const sourceAccount = await rpc.getAccount(publicKey);

      // Create a contract deployment transaction using the pre-uploaded WASM hash
      const wasmHashBuffer = Buffer.from(TOKEN_WASM_HASH, "hex");

      // Build the deployment operation
      const deployOp = StellarSdk.Operation.createCustomContract({
        address: new StellarSdk.Address(publicKey),
        wasmHash: wasmHashBuffer,
        salt: randomBytes(32),
      });

      const deployTx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(deployOp)
        .setTimeout(30)
        .build();

      // ── Step 2: Simulate Transaction ──────────────────────────────────
      let simResult: StellarSdk.rpc.Api.SimulateTransactionResponse;
      try {
        simResult = await rpc.simulateTransaction(deployTx);
      } catch (err) {
        throw {
          message: `Simulation request failed: ${err instanceof Error ? err.message : String(err)}`,
          type: "simulation",
        } as DeployTokenError;
      }

      if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
        throw {
          message: `Simulation failed: ${simResult.error}`,
          type: "simulation",
        } as DeployTokenError;
      }

      if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
        throw {
          message: "Simulation did not succeed. Please check your parameters and try again.",
          type: "simulation",
        } as DeployTokenError;
      }

      // Assemble the transaction with simulation results (footprint, auth, fee)
      const assembledDeployTx = StellarSdk.rpc.assembleTransaction(
        deployTx,
        simResult
      ).build();

      // ── Step 3: Sign Transaction ──────────────────────────────────────
      let signedDeployXdr: string;
      try {
        signedDeployXdr = await signTransaction(assembledDeployTx.toXDR(), {
          networkPassphrase: NETWORK_PASSPHRASE,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        // Detect user rejection
        if (
          errorMsg.toLowerCase().includes("user declined") ||
          errorMsg.toLowerCase().includes("user rejected") ||
          errorMsg.toLowerCase().includes("cancelled")
        ) {
          throw {
            message: "Transaction signature was rejected. Please try again.",
            type: "wallet",
          } as DeployTokenError;
        }
        throw {
          message: `Wallet signing failed: ${errorMsg}`,
          type: "wallet",
        } as DeployTokenError;
      }

      const signedDeployTx = StellarSdk.TransactionBuilder.fromXDR(
        signedDeployXdr,
        NETWORK_PASSPHRASE
      ) as StellarSdk.Transaction;

      // ── Step 4: Broadcast and Poll ────────────────────────────────────
      let sendResult: StellarSdk.rpc.Api.SendTransactionResponse;
      try {
        sendResult = await rpc.sendTransaction(signedDeployTx);
      } catch (err) {
        throw {
          message: `Broadcast failed: ${err instanceof Error ? err.message : String(err)}`,
          type: "broadcast",
        } as DeployTokenError;
      }

      if (sendResult.status === "ERROR") {
        throw {
          message: `Transaction submission failed: ${sendResult.errorResult?.toXDR("base64") || "Unknown error"}`,
          type: "broadcast",
        } as DeployTokenError;
      }

      const txHash = sendResult.hash;

      // Poll for transaction result
      let getResult: StellarSdk.rpc.Api.GetTransactionResponse;
      const maxAttempts = 30;
      const pollInterval = 2000; // 2 seconds

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        try {
          getResult = await rpc.getTransaction(txHash);
        } catch {
          // Network error during polling — continue trying
          continue;
        }

        if (getResult.status === "SUCCESS") {
          // Extract the deployed contract ID from the transaction result
          const contractId = extractContractId(getResult);
          if (!contractId) {
            throw {
              message: "Contract deployed but contract ID could not be extracted from result.",
              type: "broadcast",
            } as DeployTokenError;
          }

          // Now initialize the contract
          await initializeContract(
            rpc,
            contractId,
            publicKey,
            params,
            signTransaction
          );

          return {
            contractId,
            transactionHash: txHash,
          };
        }

        if (getResult.status === "FAILED") {
          throw {
            message: `Transaction failed: ${getResult.resultXdr?.toXDR("base64") || "Unknown failure"}`,
            type: "broadcast",
          } as DeployTokenError;
        }

        // Status is NOT_FOUND or PENDING — continue polling
      }

      // Polling timeout
      throw {
        message: `Transaction polling timeout. Hash: ${txHash}. Check the transaction status manually on a Stellar explorer.`,
        type: "timeout",
      } as DeployTokenError;
    },
    [connected, publicKey, signTransaction]
  );

  return { deployToken };
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Extract the deployed contract ID from a successful transaction result.
 */
function extractContractId(
  result: StellarSdk.rpc.Api.GetTransactionResponse
): string | null {
  if (result.status !== "SUCCESS" || !result.resultMetaXdr) {
    return null;
  }

  try {
    const meta = result.resultMetaXdr;
    // The contract ID is typically in the transaction meta's created contract entry
    // For createCustomContract, the contract address is deterministic based on deployer + salt
    // We need to parse the meta to find the created contract

    // This is a simplified extraction — in production, parse the meta XDR properly
    // For now, we'll extract from the sorobanMeta if available
    const sorobanMeta = meta.v3()?.sorobanMeta();
    if (sorobanMeta) {
      const returnValue = sorobanMeta.returnValue();
      if (returnValue) {
        // The return value of createCustomContract is the contract address
        const address = StellarSdk.Address.fromScVal(returnValue);
        return address.toString();
      }
    }

    return null;
  } catch (err) {
    console.error("Failed to extract contract ID:", err);
    return null;
  }
}

/**
 * Initialize the deployed token contract with the provided parameters.
 */
async function initializeContract(
  rpc: StellarSdk.rpc.Server,
  contractId: string,
  sourcePublicKey: string,
  params: DeployTokenParams,
  signTransaction: (xdr: string, opts?: { networkPassphrase?: string }) => Promise<string>
): Promise<void> {
  // Load source account
  const sourceAccount = await rpc.getAccount(sourcePublicKey);

  // Build the initialize() call
  const contract = new StellarSdk.Contract(contractId);

  // Convert parameters to ScVals
  const adminScVal = new StellarSdk.Address(params.adminAddress).toScVal();
  const decimalScVal = StellarSdk.nativeToScVal(params.decimals, { type: "u32" });
  const nameScVal = StellarSdk.nativeToScVal(params.name, { type: "string" });
  const symbolScVal = StellarSdk.nativeToScVal(params.symbol, { type: "string" });
  const initialSupplyScVal = StellarSdk.nativeToScVal(params.initialSupply, { type: "i128" });
  const maxSupplyScVal = params.maxSupply
    ? StellarSdk.nativeToScVal(params.maxSupply, { type: "i128" })
    : StellarSdk.xdr.ScVal.scvVoid();
  const authorizationRequiredScVal = StellarSdk.nativeToScVal(
    params.authorizationRequired ?? false,
    { type: "bool" },
  );
  const authorizationRevocableScVal = StellarSdk.nativeToScVal(
    params.authorizationRevocable ?? false,
    { type: "bool" },
  );
  const complianceNodeScVal =
    params.complianceNodeAddress &&
    params.complianceNodeAddress.trim().length > 0
      ? new StellarSdk.Address(params.complianceNodeAddress.trim()).toScVal()
      : StellarSdk.xdr.ScVal.scvVoid();

  const initTx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "initialize",
        adminScVal,
        decimalScVal,
        nameScVal,
        symbolScVal,
        initialSupplyScVal,
        maxSupplyScVal,
        authorizationRequiredScVal,
        authorizationRevocableScVal,
        complianceNodeScVal,
      )
    )
    .setTimeout(30)
    .build();

  // Simulate
  const simResult = await rpc.simulateTransaction(initTx);

  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    throw {
      message: `Initialization simulation failed: ${simResult.error}`,
      type: "simulation",
    } as DeployTokenError;
  }

  if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
    throw {
      message: "Initialization simulation did not succeed.",
      type: "simulation",
    } as DeployTokenError;
  }

  // Assemble
  const assembledInitTx = StellarSdk.rpc.assembleTransaction(initTx, simResult).build();

  // Sign
  const signedInitXdr = await signTransaction(assembledInitTx.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const signedInitTx = StellarSdk.TransactionBuilder.fromXDR(
    signedInitXdr,
    NETWORK_PASSPHRASE
  ) as StellarSdk.Transaction;

  // Broadcast
  const sendResult = await rpc.sendTransaction(signedInitTx);

  if (sendResult.status === "ERROR") {
    throw {
      message: `Initialization broadcast failed: ${sendResult.errorResult?.toXDR("base64") || "Unknown error"}`,
      type: "broadcast",
    } as DeployTokenError;
  }

  const initHash = sendResult.hash;

  // Poll for initialization result
  const maxAttempts = 30;
  const pollInterval = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const getResult = await rpc.getTransaction(initHash);

      if (getResult.status === "SUCCESS") {
        return; // Initialization successful
      }

      if (getResult.status === "FAILED") {
        throw {
          message: `Initialization failed: ${getResult.resultXdr?.toXDR("base64") || "Unknown failure"}`,
          type: "broadcast",
        } as DeployTokenError;
      }
    } catch {
      // Continue polling on network errors
      continue;
    }
  }

  throw {
    message: `Initialization polling timeout. Hash: ${initHash}`,
    type: "timeout",
  } as DeployTokenError;
}
