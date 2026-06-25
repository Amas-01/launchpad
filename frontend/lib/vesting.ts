import * as StellarSdk from "@stellar/stellar-sdk";

/* ── Configuration ─────────────────────────────────────────────────── */

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
  "https://soroban-testnet.stellar.org";

const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
  StellarSdk.Networks.TESTNET;

const server = new StellarSdk.rpc.Server(RPC_URL);

/* ── Types ─────────────────────────────────────────────────────────── */

export interface VestingSchedule {
  recipient: string;
  totalAmount: bigint;
  cliffLedger: number;
  endLedger: number;
  released: bigint;
  revoked: boolean;
}

export interface VestingInfo {
  schedule: VestingSchedule;
  vestedAmount: bigint;
  releasableAmount: bigint;
  currentLedger: number;
}

/* ── XDR Decoders ──────────────────────────────────────────────────── */

function decodeI128(val: StellarSdk.xdr.ScVal): bigint {
  const i128 = val.i128();
  const hi = BigInt(i128.hi().toBigInt());
  const lo = BigInt(i128.lo().toBigInt());
  return (hi << 64n) | lo;
}

function decodeU32(val: StellarSdk.xdr.ScVal): number {
  return val.u32();
}

function decodeAddress(val: StellarSdk.xdr.ScVal): string {
  return StellarSdk.Address.fromScVal(val).toString();
}

function decodeBool(val: StellarSdk.xdr.ScVal): boolean {
  return val.b();
}

/* ── Simulate a read-only contract call ────────────────────────────── */

async function simulateCall(
  contractId: string,
  method: string,
  args: StellarSdk.xdr.ScVal[] = [],
): Promise<StellarSdk.xdr.ScVal> {
  const dummySource =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  const account = new StellarSdk.Account(dummySource, "0");
  const contract = new StellarSdk.Contract(contractId);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);

  if (StellarSdk.rpc.Api.isSimulationError(sim)) {
    throw new Error(
      `Simulation failed: ${(sim as StellarSdk.rpc.Api.SimulateTransactionErrorResponse).error}`,
    );
  }

  const result = (sim as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse)
    .result;
  if (!result) throw new Error("No result from simulation");

  return result.retval;
}

function toU32ScVal(value: number): StellarSdk.xdr.ScVal {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("Invalid u32 value");
  }
  return StellarSdk.nativeToScVal(BigInt(value), { type: "u32" });
}

export async function fetchScheduleCount(
  contractId: string,
  recipientAddress: string,
): Promise<number> {
  const addressVal = new StellarSdk.Address(recipientAddress).toScVal();
  const result = await simulateCall(contractId, "get_schedule_count", [
    addressVal,
  ]);
  return decodeU32(result);
}

async function resolveScheduleIndex(
  contractId: string,
  recipientAddress: string,
  scheduleIndex?: number,
): Promise<number> {
  if (scheduleIndex !== undefined) return scheduleIndex;
  const count = await fetchScheduleCount(contractId, recipientAddress);
  if (count <= 0) {
    throw new Error("no schedule found");
  }
  return count - 1;
}

/* ── Public API ────────────────────────────────────────────────────── */

/** Fetch the full vesting schedule for a recipient from the contract. */
export async function fetchVestingSchedule(
  contractId: string,
  recipientAddress: string,
  scheduleIndex?: number,
): Promise<VestingSchedule> {
  const addressVal = new StellarSdk.Address(recipientAddress).toScVal();
  const resolvedIndex = await resolveScheduleIndex(
    contractId,
    recipientAddress,
    scheduleIndex,
  );
  const result = await simulateCall(contractId, "get_schedule", [
    addressVal,
    toU32ScVal(resolvedIndex),
  ]);

  const fields = result.map();
  if (!fields) throw new Error("Unexpected result type from get_schedule");

  const fieldMap = new Map<string, StellarSdk.xdr.ScVal>();
  for (const entry of fields) {
    const key = entry.key().sym().toString();
    fieldMap.set(key, entry.val());
  }

  return {
    recipient: decodeAddress(fieldMap.get("recipient")!),
    totalAmount: decodeI128(fieldMap.get("total_amount")!),
    cliffLedger: decodeU32(fieldMap.get("cliff_ledger")!),
    endLedger: decodeU32(fieldMap.get("end_ledger")!),
    released: decodeI128(fieldMap.get("released")!),
    revoked: decodeBool(fieldMap.get("revoked")!),
  };
}

/** Fetch the currently vested amount (may or may not have been released). */
export async function fetchVestedAmount(
  contractId: string,
  recipientAddress: string,
  scheduleIndex?: number,
): Promise<bigint> {
  const addressVal = new StellarSdk.Address(recipientAddress).toScVal();
  const resolvedIndex = await resolveScheduleIndex(
    contractId,
    recipientAddress,
    scheduleIndex,
  );
  const result = await simulateCall(contractId, "vested_amount", [
    addressVal,
    toU32ScVal(resolvedIndex),
  ]);
  return decodeI128(result);
}

/** Fetch the amount already released to the recipient. */
export async function fetchReleasedAmount(
  contractId: string,
  recipientAddress: string,
  scheduleIndex?: number,
): Promise<bigint> {
  const addressVal = new StellarSdk.Address(recipientAddress).toScVal();
  const resolvedIndex = await resolveScheduleIndex(
    contractId,
    recipientAddress,
    scheduleIndex,
  );
  const result = await simulateCall(contractId, "released_amount", [
    addressVal,
    toU32ScVal(resolvedIndex),
  ]);
  return decodeI128(result);
}

/** Fetch combined vesting info in a single call batch. */
export async function fetchVestingInfo(
  contractId: string,
  recipientAddress: string,
  scheduleIndex?: number,
): Promise<VestingInfo> {
  const resolvedIndex = await resolveScheduleIndex(
    contractId,
    recipientAddress,
    scheduleIndex,
  );
  const [schedule, vestedAmount] = await Promise.all([
    fetchVestingSchedule(contractId, recipientAddress, resolvedIndex),
    fetchVestedAmount(contractId, recipientAddress, resolvedIndex),
  ]);

  const releasableAmount = vestedAmount - schedule.released;
  const latestLedger = await server.getLatestLedger();

  return {
    schedule,
    vestedAmount,
    releasableAmount,
    currentLedger: latestLedger.sequence,
  };
}

/**
 * Build a release() transaction XDR for signing.
 * The caller should sign via wallet and then submit.
 */
export async function buildReleaseTx(
  contractId: string,
  recipientAddress: string,
  signerAddress: string,
  scheduleIndex?: number,
): Promise<string> {
  const account = await server.getAccount(signerAddress);
  const contract = new StellarSdk.Contract(contractId);
  const addressVal = new StellarSdk.Address(recipientAddress).toScVal();
  const resolvedIndex = await resolveScheduleIndex(
    contractId,
    recipientAddress,
    scheduleIndex,
  );

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("release", addressVal, toU32ScVal(resolvedIndex)))
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);

  if (StellarSdk.rpc.Api.isSimulationError(sim)) {
    throw new Error(
      `Simulation failed: ${(sim as StellarSdk.rpc.Api.SimulateTransactionErrorResponse).error}`,
    );
  }

  const preparedTx = StellarSdk.rpc.assembleTransaction(
    tx,
    sim as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse,
  ).build();

  return preparedTx.toXDR();
}

/** Submit a signed transaction XDR and wait for confirmation. */
export async function submitTx(
  signedXdr: string,
): Promise<StellarSdk.rpc.Api.GetSuccessfulTransactionResponse> {
  const tx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    NETWORK_PASSPHRASE,
  );
  const response = await server.sendTransaction(tx);

  if (response.status === "ERROR") {
    throw new Error(`Transaction submission failed: ${response.status}`);
  }

  // Poll for result
  const hash = response.hash;
  let getResponse: StellarSdk.rpc.Api.GetTransactionResponse;

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    getResponse = await server.getTransaction(hash);

    if (getResponse.status === "SUCCESS") {
      return getResponse as StellarSdk.rpc.Api.GetSuccessfulTransactionResponse;
    }
    if (getResponse.status === "FAILED") {
      throw new Error("Transaction failed on-chain");
    }
  }

  throw new Error("Transaction timed out waiting for confirmation");
}

/** Format a raw i128 token amount with decimals (default 7 for Stellar). */
export function formatTokenAmount(
  raw: bigint,
  decimals: number = 7,
): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;

  if (frac === 0n) return whole.toString();

  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/** Truncate a Stellar address for display. */
export function truncateAddress(
  addr: string,
  chars: number = 4,
): string {
  if (addr.length <= chars * 2 + 1) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}
