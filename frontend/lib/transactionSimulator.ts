import * as StellarSdk from "@stellar/stellar-sdk";
import { type NetworkConfig } from "../types/network";

/**
 * Pre-flight check result
 */
export interface PreflightCheckResult {
  success: boolean;
  warnings: string[];
  errors: string[];
  simulationDetails?: {
    cost: string;
    footprint: string;
  };
  estimatedFee?: string;
}

/**
 * Error message mapping for common Soroban contract errors.
 * Parse contract panic messages and return user-friendly descriptions.
 */
const ERROR_MESSAGE_MAP: Record<string, string> = {
  "already initialized": "Contract is already initialized. Check if it was deployed previously.",
  "insufficient balance": "Insufficient token balance for this operation.",
  "insufficient allowance": "Insufficient allowance approved for the spender.",
  "amount must be positive": "Amount must be greater than zero.",
  "max_supply exceeded": "Operation would exceed the maximum supply cap.",
  "mint would exceed max_supply": "Minting this amount would exceed the maximum supply cap.",
  "account is frozen": "The account is frozen and cannot perform transfers.",
  "not initialized": "Contract is not initialized. This token may not exist.",
  "no pending admin": "No pending admin to accept. Did you propose_admin first?",
  "insufficient balance to burn": "Cannot burn more tokens than the account holds.",
  "trade blocked by compliance node": "The compliance node rejected this transfer.",
  "vesting contract is paused": "The vesting contract is paused and cannot process this action.",
  "schedule already exists": "A vesting schedule already exists for this recipient.",
  "no schedule found": "No vesting schedule found for this recipient.",
  "schedule has been revoked": "This vesting schedule has been revoked.",
  "nothing to release": "No vested tokens are available to release.",
  "schedule already revoked": "This schedule has already been revoked.",
  "end_ledger must be after cliff_ledger": "End ledger must be after cliff ledger.",
  "total_amount must be positive": "Total amount must be greater than zero.",
  "Invalid Stellar public key": "The provided Stellar address is not valid.",
  "max_supply must be positive": "Maximum supply must be greater than zero.",
  "initial_supply exceeds max_supply": "Initial supply cannot exceed maximum supply.",
  "allowance would overflow": "Allowance amount is too large and would overflow.",
  "approval would exceed max_supply": "Approval amount cannot exceed the token's maximum supply.",
};

/**
 * Parse a Soroban error message and return a user-friendly description.
 */
export function parseSorobanError(errorMessage: string): string {
  const lowerError = errorMessage.toLowerCase();

  // Check for exact matches first
  for (const [key, message] of Object.entries(ERROR_MESSAGE_MAP)) {
    if (lowerError.includes(key.toLowerCase())) {
      return message;
    }
  }

  // Check for panic-related errors
  if (lowerError.includes("invocation failed")) {
    return "Contract invocation failed. The transaction may have invalid parameters.";
  }

  if (lowerError.includes("insufficient funds")) {
    return "Insufficient XLM balance to pay transaction fees.";
  }

  if (lowerError.includes("timeout")) {
    return "The operation timed out. Please try again.";
  }

  if (lowerError.includes("deadline exceeded")) {
    return "Transaction deadline exceeded. Please try again.";
  }

  if (lowerError.includes("build failed")) {
    return "Failed to build transaction. Please check your inputs.";
  }

  // Return the original error if no mapping found
  return errorMessage;
}

/**
 * Simulate a Soroban transaction invocation for pre-flight checks.
 * Does NOT submit the transaction, just simulates it to detect errors.
 */
export async function simulateTransaction(
  contractId: string,
  method: string,
  args: StellarSdk.xdr.ScVal[],
  config: NetworkConfig,
  sourcePublicKey: string = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
): Promise<PreflightCheckResult> {
  try {
    const rpc = new StellarSdk.rpc.Server(config.rpcUrl);
    const contract = new StellarSdk.Contract(contractId);

    // Create a dummy account for simulation
    const account = new StellarSdk.Account(sourcePublicKey, "0");

    // Build the transaction
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: config.passphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    // Simulate the transaction
    const sim = await rpc.simulateTransaction(tx);

    // Check simulation response
    if (StellarSdk.rpc.Api.isSimulationError(sim)) {
      const friendlyError = parseSorobanError(sim.error);
      return {
        success: false,
        warnings: [],
        errors: [friendlyError],
      };
    }

    // Check for simulation success but with issues
    if (!StellarSdk.rpc.Api.isSimulationSuccess(sim) || !sim.result) {
      return {
        success: false,
        warnings: [],
        errors: ["Transaction simulation failed. Please check your inputs."],
      };
    }

    // Success!
    return {
      success: true,
      warnings: [],
      errors: [],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const friendlyError = parseSorobanError(errorMessage);

    return {
      success: false,
      warnings: [],
      errors: [friendlyError],
    };
  }
}

/**
 * Simulate a token transfer pre-flight check.
 */
export async function simulateTransfer(
  contractId: string,
  fromAddress: string,
  toAddress: string,
  amount: bigint | string,
  config: NetworkConfig,
): Promise<PreflightCheckResult> {
  const args = [
    new StellarSdk.Address(fromAddress).toScVal(),
    new StellarSdk.Address(toAddress).toScVal(),
    StellarSdk.nativeToScVal(BigInt(amount), { type: "i128" }),
  ];

  return simulateTransaction(contractId, "transfer", args, config, fromAddress);
}

/**
 * Simulate a token mint pre-flight check.
 */
export async function simulateMint(
  contractId: string,
  toAddress: string,
  amount: bigint | string,
  adminAddress: string,
  config: NetworkConfig,
): Promise<PreflightCheckResult> {
  const args = [
    new StellarSdk.Address(toAddress).toScVal(),
    StellarSdk.nativeToScVal(BigInt(amount), { type: "i128" }),
  ];

  return simulateTransaction(contractId, "mint", args, config, adminAddress);
}

/**
 * Simulate a token burn pre-flight check.
 */
export async function simulateBurn(
  contractId: string,
  fromAddress: string,
  amount: bigint | string,
  adminAddress: string,
  config: NetworkConfig,
): Promise<PreflightCheckResult> {
  const args = [
    new StellarSdk.Address(fromAddress).toScVal(),
    StellarSdk.nativeToScVal(BigInt(amount), { type: "i128" }),
  ];

  return simulateTransaction(contractId, "burn", args, config, adminAddress);
}

/**
 * Simulate a token transfer_from pre-flight check.
 */
export async function simulateTransferFrom(
  contractId: string,
  spenderAddress: string,
  fromAddress: string,
  toAddress: string,
  amount: bigint | string,
  config: NetworkConfig,
): Promise<PreflightCheckResult> {
  const args = [
    new StellarSdk.Address(spenderAddress).toScVal(),
    new StellarSdk.Address(fromAddress).toScVal(),
    new StellarSdk.Address(toAddress).toScVal(),
    StellarSdk.nativeToScVal(BigInt(amount), { type: "i128" }),
  ];

  return simulateTransaction(contractId, "transfer_from", args, config, spenderAddress);
}

/**
 * Simulate a vesting release pre-flight check.
 */
export async function simulateVestingRelease(
  vestingContractId: string,
  recipientAddress: string,
  config: NetworkConfig,
  scheduleIndex?: number,
): Promise<PreflightCheckResult> {
  const args = [new StellarSdk.Address(recipientAddress).toScVal()];
  if (scheduleIndex !== undefined) {
    args.push(StellarSdk.nativeToScVal(BigInt(scheduleIndex), { type: "u32" }));
  }

  return simulateTransaction(vestingContractId, "release", args, config);
}

/**
 * Simulate a vesting revoke pre-flight check.
 */
export async function simulateVestingRevoke(
  vestingContractId: string,
  recipientAddress: string,
  adminAddress: string,
  config: NetworkConfig,
  scheduleIndex?: number,
): Promise<PreflightCheckResult> {
  const args = [new StellarSdk.Address(recipientAddress).toScVal()];
  if (scheduleIndex !== undefined) {
    args.push(StellarSdk.nativeToScVal(BigInt(scheduleIndex), { type: "u32" }));
  }

  return simulateTransaction(vestingContractId, "revoke", args, config, adminAddress);
}

/**
 * Placeholder contract ID used solely to exercise the RPC pathway during
 * deployment pre-flight. A new token has no contract address yet, so we use
 * the all-zeros Soroban address and treat "contract not found" as the
 * expected outcome – it confirms the RPC is reachable and our ScVal arguments
 * are well-formed. Any other simulation error reveals a real problem.
 */
const PLACEHOLDER_CONTRACT_ID =
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/**
 * Errors that indicate the placeholder contract doesn't exist on-chain.
 * These are expected during deployment pre-flight and should be treated as
 * "RPC is healthy, parameters look valid".
 */
const EXPECTED_PREFLIGHT_ERRORS = [
  "missingvalue",
  "missing value",
  "does not exist",
  "contract not found",
  "no such contract",
  "invalid contract",
  "wasmvm",
];

function isExpectedPreflightError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return EXPECTED_PREFLIGHT_ERRORS.some((s) => lower.includes(s));
}

/**
 * Simulate the token `initialize` call as a deployment pre-flight check.
 *
 * Because the contract does not yet exist, we simulate against a placeholder
 * address. A "contract not found" result means the RPC is live and our args
 * are well-typed – both conditions we need to confirm before asking the user
 * to sign. Any other error (bad argument types, network unreachable, …) is
 * surfaced as a real failure.
 */
export async function simulateTokenDeployment(
  adminAddress: string,
  name: string,
  symbol: string,
  decimals: number,
  initialSupply: bigint,
  maxSupply: bigint | null,
  config: NetworkConfig,
  authorizationRequired: boolean = false,
  authorizationRevocable: boolean = false,
  complianceNodeAddress: string | null = null,
  sourcePublicKey?: string,
): Promise<PreflightCheckResult> {
  try {
    const rpc = new StellarSdk.rpc.Server(config.rpcUrl);

    // ── 1. Connectivity check ──────────────────────────────────────────
    // getLatestLedger is a lightweight read that confirms the RPC is up.
    await rpc.getLatestLedger();

    // ── 2. Admin / signer account checks ───────────────────────────────
    const horizon = new StellarSdk.Horizon.Server(config.horizonUrl);
    const sourceAddress = sourcePublicKey ?? (adminAddress.startsWith("G") ? adminAddress : "");
    if (!sourceAddress) {
      return {
        success: false,
        warnings: [],
        errors: [
          "Connect a wallet to deploy when using a contract or multisig admin address.",
        ],
      };
    }

    try {
      await horizon.loadAccount(sourceAddress);
    } catch {
      return {
        success: false,
        warnings: [],
        errors: [
          "Deployment signer account not found on the network. Ensure it is funded before deploying.",
        ],
      };
    }

    if (adminAddress.startsWith("G")) {
      try {
        await horizon.loadAccount(adminAddress);
      } catch {
        return {
          success: false,
          warnings: [],
          errors: [
            "Admin account not found on the network. Ensure it is funded before deploying.",
          ],
        };
      }
    }

    // ── 3. Simulate initialize via Soroban RPC ─────────────────────────
    // Build the ScVal arguments that match the contract's initialize
    // signature: (admin, decimal, name, symbol, initial_supply, max_supply,
    //             authorization_required, authorization_revocable,
    //             compliance_node)
    const maxSupplyScVal =
      maxSupply !== null
        ? StellarSdk.nativeToScVal(maxSupply, { type: "i128" })
        : StellarSdk.xdr.ScVal.scvVoid();
    const complianceNodeScVal =
      complianceNodeAddress && complianceNodeAddress.trim().length > 0
        ? new StellarSdk.Address(complianceNodeAddress.trim()).toScVal()
        : StellarSdk.xdr.ScVal.scvVoid();

    const args: StellarSdk.xdr.ScVal[] = [
      new StellarSdk.Address(adminAddress).toScVal(),
      StellarSdk.nativeToScVal(decimals, { type: "u32" }),
      StellarSdk.nativeToScVal(name, { type: "string" }),
      StellarSdk.nativeToScVal(symbol, { type: "string" }),
      StellarSdk.nativeToScVal(initialSupply, { type: "i128" }),
      maxSupplyScVal,
      StellarSdk.nativeToScVal(authorizationRequired, { type: "bool" }),
      StellarSdk.nativeToScVal(authorizationRevocable, { type: "bool" }),
      complianceNodeScVal,
    ];

    const account = new StellarSdk.Account(sourceAddress, "0");
    const contract = new StellarSdk.Contract(PLACEHOLDER_CONTRACT_ID);
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: config.passphrase,
    })
      .addOperation(contract.call("initialize", ...args))
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);

    let estimatedFee = "0.01";
    let simulationCost = "0.01";
    const simulationFootprint = "";
    
    if (StellarSdk.rpc.Api.isSimulationSuccess(sim)) {
      try {
        const minResourceFee = Number(sim.minResourceFee || "0");
        const baseFee = Number(StellarSdk.BASE_FEE);
        const totalFee = (minResourceFee + baseFee) / 10_000_000;
        estimatedFee = totalFee >= 1 ? totalFee.toFixed(2) : totalFee.toFixed(4);
        simulationCost = estimatedFee;
      } catch {
        estimatedFee = "0.01";
      }
    }

    const simulationDetails = {
      cost: simulationCost,
      footprint: simulationFootprint,
    };

    // "Contract not found" is the expected outcome for a not-yet-deployed
    // token – it means connectivity and argument encoding are both fine.
    if (StellarSdk.rpc.Api.isSimulationError(sim)) {
      if (isExpectedPreflightError(sim.error)) {
        return { success: true, warnings: [], errors: [], estimatedFee, simulationDetails };
      }
      const friendlyError = parseSorobanError(sim.error);
      return { success: false, warnings: [], errors: [friendlyError], estimatedFee, simulationDetails };
    }

    // An unexpected success (shouldn't happen with placeholder) is fine too.
    return { success: true, warnings: [], errors: [], estimatedFee, simulationDetails };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (isExpectedPreflightError(msg)) {
      return { success: true, warnings: [], errors: [], estimatedFee: "0.01", simulationDetails: { cost: "0.01", footprint: "" } };
    }
    return {
      success: false,
      warnings: [],
      errors: [parseSorobanError(msg)],
      estimatedFee: "0.01",
      simulationDetails: { cost: "0.01", footprint: "" },
    };
  }
}

/**
 * Simulate a vesting create_schedule pre-flight check.
 */
export async function simulateCreateSchedule(
  vestingContractId: string,
  recipientAddress: string,
  totalAmount: bigint | string,
  cliffLedger: number,
  endLedger: number,
  adminAddress: string,
  config: NetworkConfig,
): Promise<PreflightCheckResult> {
  const args = [
    new StellarSdk.Address(recipientAddress).toScVal(),
    StellarSdk.nativeToScVal(BigInt(totalAmount), { type: "i128" }),
    StellarSdk.nativeToScVal(BigInt(cliffLedger), { type: "u32" }),
    StellarSdk.nativeToScVal(BigInt(endLedger), { type: "u32" }),
  ];

  return simulateTransaction(vestingContractId, "create_schedule", args, config, adminAddress);
}

/**
 * Simulate a token approve (allowance grant) pre-flight check.
 */
export async function simulateApprove(
  contractId: string,
  ownerAddress: string,
  spenderAddress: string,
  amount: bigint | string,
  expirationLedger: number = 10000000,
  config?: NetworkConfig,
): Promise<PreflightCheckResult> {
  if (!config) {
    return {
      success: false,
      warnings: [],
      errors: ["Network configuration is required"],
    };
  }

  const args = [
    new StellarSdk.Address(ownerAddress).toScVal(),
    new StellarSdk.Address(spenderAddress).toScVal(),
    StellarSdk.nativeToScVal(BigInt(amount), { type: "i128" }),
    StellarSdk.nativeToScVal(BigInt(expirationLedger), { type: "u32" }),
  ];

  return simulateTransaction(contractId, "approve", args, config, ownerAddress);
}

/**
 * Simulate a token revoke allowance pre-flight check.
 * Revoke is implemented as approve with 0 amount.
 */
export async function simulateRevokeAllowance(
  contractId: string,
  ownerAddress: string,
  spenderAddress: string,
  config?: NetworkConfig,
): Promise<PreflightCheckResult> {
  if (!config) {
    return {
      success: false,
      warnings: [],
      errors: ["Network configuration is required"],
    };
  }

  const args = [
    new StellarSdk.Address(ownerAddress).toScVal(),
    new StellarSdk.Address(spenderAddress).toScVal(),
    StellarSdk.nativeToScVal(BigInt(0), { type: "i128" }),
    StellarSdk.nativeToScVal(BigInt(1000), { type: "u32" }),
  ];

  return simulateTransaction(contractId, "approve", args, config, ownerAddress);
}
