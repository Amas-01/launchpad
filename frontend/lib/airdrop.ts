/**
 * Soroban RPC helpers for the airdrop contract (`contracts/airdrop`).
 *
 * Mirrors the shape of `lib/vesting.ts`: read-only calls go through
 * `simulateCall`, and state-changing calls build a prepared XDR for the
 * wallet to sign.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { fromHex } from "@/lib/merkle";

/* ── Configuration ─────────────────────────────────────────────────── */

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
  "https://soroban-testnet.stellar.org";

const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? StellarSdk.Networks.TESTNET;

const server = new StellarSdk.rpc.Server(RPC_URL);

/** Soroban contract IDs: 56 characters of base32 starting with `C`. */
export const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

/* ── Types ─────────────────────────────────────────────────────────── */

/** Everything the claim page needs about an airdrop, in one shot. */
export interface AirdropInfo {
  token: string;
  admin: string;
  merkleRoot: string;
  deadlineLedger: number;
  currentLedger: number;
  totalClaimed: bigint;
  remainingBalance: bigint;
  isReclaimed: boolean;
}

/** The connected wallet's position in a given airdrop. */
export interface ClaimStatus {
  claimed: boolean;
  claimedAmount: bigint;
  /** False when the proof does not authenticate against the on-chain root. */
  eligible: boolean;
}

/* ── ScVal helpers ─────────────────────────────────────────────────── */

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

function decodeBytes(val: StellarSdk.xdr.ScVal): string {
  return Buffer.from(val.bytes()).toString("hex");
}

function toAddressScVal(address: string): StellarSdk.xdr.ScVal {
  return new StellarSdk.Address(address).toScVal();
}

function toI128ScVal(amount: bigint): StellarSdk.xdr.ScVal {
  return StellarSdk.nativeToScVal(amount, { type: "i128" });
}

function toU32ScVal(value: number): StellarSdk.xdr.ScVal {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("Invalid u32 value");
  }
  return StellarSdk.nativeToScVal(value, { type: "u32" });
}

function toBytes32ScVal(hex: string): StellarSdk.xdr.ScVal {
  const bytes = fromHex(hex);
  if (bytes.length !== 32) {
    throw new Error("Expected a 32-byte hex value");
  }
  return StellarSdk.xdr.ScVal.scvBytes(Buffer.from(bytes));
}

/** A `Vec<BytesN<32>>` of sibling hashes, as the contract expects. */
function toProofScVal(proof: string[]): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvVec(proof.map(toBytes32ScVal));
}

/* ── Read-only calls ───────────────────────────────────────────────── */

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

/** Fetch an airdrop's configuration and live totals. */
export async function fetchAirdropInfo(
  contractId: string,
): Promise<AirdropInfo> {
  const [
    token,
    admin,
    merkleRoot,
    deadlineLedger,
    totalClaimed,
    remainingBalance,
    isReclaimed,
    latestLedger,
  ] = await Promise.all([
    simulateCall(contractId, "get_token").then(decodeAddress),
    simulateCall(contractId, "get_admin").then(decodeAddress),
    simulateCall(contractId, "get_merkle_root").then(decodeBytes),
    simulateCall(contractId, "get_deadline_ledger").then(decodeU32),
    simulateCall(contractId, "total_claimed").then(decodeI128),
    simulateCall(contractId, "remaining_balance").then(decodeI128),
    simulateCall(contractId, "is_reclaimed").then(decodeBool),
    server.getLatestLedger(),
  ]);

  return {
    token,
    admin,
    merkleRoot,
    deadlineLedger,
    currentLedger: latestLedger.sequence,
    totalClaimed,
    remainingBalance,
    isReclaimed,
  };
}

/**
 * Whether `recipient` has claimed, and whether the proof they hold is
 * actually accepted by the deployed contract.
 *
 * The eligibility check runs against the chain rather than only against the
 * local root, so a stale or hand-edited proof file is caught before the user
 * is asked to sign anything.
 */
export async function fetchClaimStatus(
  contractId: string,
  recipient: string,
  amount: bigint,
  proof: string[],
): Promise<ClaimStatus> {
  const [claimed, claimedAmount, eligible] = await Promise.all([
    simulateCall(contractId, "is_claimed", [toAddressScVal(recipient)]).then(
      decodeBool,
    ),
    simulateCall(contractId, "claimed_amount", [
      toAddressScVal(recipient),
    ]).then(decodeI128),
    simulateCall(contractId, "verify_proof", [
      toAddressScVal(recipient),
      toI128ScVal(amount),
      toProofScVal(proof),
    ]).then(decodeBool),
  ]);

  return { claimed, claimedAmount, eligible };
}

/** The token's decimals, used to render allocations at human scale. */
export async function fetchTokenDecimals(tokenId: string): Promise<number> {
  return decodeU32(await simulateCall(tokenId, "decimals"));
}

/* ── Transaction builders ──────────────────────────────────────────── */

async function prepare(
  signerAddress: string,
  operation: StellarSdk.xdr.Operation,
): Promise<string> {
  const account = await server.getAccount(signerAddress);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);

  if (StellarSdk.rpc.Api.isSimulationError(sim)) {
    throw new Error(
      `Simulation failed: ${(sim as StellarSdk.rpc.Api.SimulateTransactionErrorResponse).error}`,
    );
  }

  return StellarSdk.rpc
    .assembleTransaction(
      tx,
      sim as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse,
    )
    .build()
    .toXDR();
}

/** Build a `claim(recipient, amount, proof)` transaction for signing. */
export async function buildClaimTx(
  contractId: string,
  recipient: string,
  amount: bigint,
  proof: string[],
): Promise<string> {
  const contract = new StellarSdk.Contract(contractId);
  return prepare(
    recipient,
    contract.call(
      "claim",
      toAddressScVal(recipient),
      toI128ScVal(amount),
      toProofScVal(proof),
    ),
  );
}

/** Build an `initialize(token, admin, merkle_root, deadline_ledger)` transaction. */
export async function buildInitializeTx(
  contractId: string,
  tokenId: string,
  admin: string,
  merkleRoot: string,
  deadlineLedger: number,
): Promise<string> {
  const contract = new StellarSdk.Contract(contractId);
  return prepare(
    admin,
    contract.call(
      "initialize",
      toAddressScVal(tokenId),
      toAddressScVal(admin),
      toBytes32ScVal(merkleRoot),
      toU32ScVal(deadlineLedger),
    ),
  );
}

/** Build a `fund(from, amount)` transaction. */
export async function buildFundTx(
  contractId: string,
  from: string,
  amount: bigint,
): Promise<string> {
  const contract = new StellarSdk.Contract(contractId);
  return prepare(
    from,
    contract.call("fund", toAddressScVal(from), toI128ScVal(amount)),
  );
}

/** Build a `reclaim_unclaimed()` transaction. */
export async function buildReclaimTx(
  contractId: string,
  admin: string,
): Promise<string> {
  const contract = new StellarSdk.Contract(contractId);
  return prepare(admin, contract.call("reclaim_unclaimed"));
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

  const hash = response.hash;

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const getResponse = await server.getTransaction(hash);

    if (getResponse.status === "SUCCESS") {
      return getResponse as StellarSdk.rpc.Api.GetSuccessfulTransactionResponse;
    }
    if (getResponse.status === "FAILED") {
      throw new Error("Transaction failed on-chain");
    }
  }

  throw new Error("Transaction timed out waiting for confirmation");
}

/* ── Formatting ────────────────────────────────────────────────────── */

/** Format a raw i128 token amount with decimals (default 7 for Stellar). */
export function formatTokenAmount(raw: bigint, decimals: number = 7): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const sign = negative ? "-" : "";

  if (frac === 0n) return `${sign}${whole}`;

  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${sign}${whole}.${fracStr}`;
}

/**
 * Roughly how long until `deadlineLedger`, assuming Stellar's ~5s ledger
 * close time. Approximate by nature — it is a "you have about a week left"
 * hint, not a countdown to trust.
 */
export function ledgersToApproxDuration(ledgers: number): string {
  if (ledgers <= 0) return "0m";
  const seconds = ledgers * 5;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
