import * as StellarSdk from "@stellar/stellar-sdk";
import { type NetworkConfig } from "../types/network";
import { fetchIndexedEvents } from "./indexer";
import { wrapRpcCall } from "./soroban";

// ---------------------------------------------------------------------------
// Config — defaults to Stellar Testnet, overridable via localStorage
// ---------------------------------------------------------------------------
const DEFAULT_HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

function getHorizonUrl(): string {
  if (typeof window !== "undefined") {
    return localStorage.getItem("soropad_horizon_url") || DEFAULT_HORIZON_URL;
  }
  return DEFAULT_HORIZON_URL;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface VerificationResult {
  status: "verified" | "modified" | "unknown";
  deployedHash: string | null;
  referenceHash: string | null;
  referenceVersion: string | null;
  isLocked: boolean;
}

export interface WasmManifestEntry {
  wasm_hash: string;
  source_tag: string;
  build_ledger: string;
}

export interface WasmManifest {
  token: {
    latest: string;
    versions: Record<string, WasmManifestEntry>;
    build_info: { sdk_version: string; rust_version: string; profile: string };
  };
  vesting: {
    latest: string;
    versions: Record<string, WasmManifestEntry>;
    build_info: { sdk_version: string; rust_version: string; profile: string };
  };
}

export async function fetchWasmManifest(): Promise<WasmManifest | null> {
  try {
    const res = await fetch("/api/wasm-manifest");
    if (!res.ok) return null;
    return (await res.json()) as WasmManifest;
  } catch {
    return null;
  }
}

export interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  circulatingSupply: string;
  admin: string;
  contractId: string;
  maxSupply?: string | null;
  contractUri?: string;
  complianceNode?: string | null;
  authorizationRequired?: boolean;
  authorizationRevocable?: boolean;
  isPaused?: boolean;
  isLocked?: boolean;
}

/** Per-wallet authorization/freeze state for a token contract. */
export interface WalletTokenState {
  isAuthorized: boolean;
  isFrozen: boolean;
}

export interface TokenHolder {
  address: string;
  balance: string;
  sharePercent: number;
}

export interface VestingScheduleInfo {
  recipient: string;
  totalAmount: string;
  cliffLedger: number;
  endLedger: number;
  released: string;
  revoked: boolean;
  scheduleIndex?: number;
  scheduleCount?: number;
}

export interface TransactionItem {
  type: "mint" | "burn" | "clawback" | "transfer";
  from?: string;
  to?: string;
  amount: string;
  timestamp: number;
  ledger: number;
  id: string;
}

export interface TokenAllowanceInfo {
  spenderAddress: string;
  amount: string;
  expirationLedger: number;
  isExpired: boolean;
}

// ---------------------------------------------------------------------------
// Soroban RPC helpers
// ---------------------------------------------------------------------------

async function simulateAndAssembleTransaction(
  tx: StellarSdk.Transaction,
  config: NetworkConfig,
) {
  const rpc = new StellarSdk.rpc.Server(config.rpcUrl);
  const simulated = await rpc.simulateTransaction(tx);

  if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  if (!StellarSdk.rpc.Api.isSimulationSuccess(simulated)) {
    throw new Error("Transaction simulation was not successful");
  }

  return StellarSdk.rpc.assembleTransaction(tx, simulated);
}

/**
 * Simulate a read-only Soroban contract invocation and return the result xdr.
 */
export async function simulateCall(
  contractId: string,
  method: string,
  config: NetworkConfig,
  args: StellarSdk.xdr.ScVal[] = [],
): Promise<StellarSdk.xdr.ScVal> {
  return wrapRpcCall(
    async () => {
      const rpc = new StellarSdk.rpc.Server(config.rpcUrl);
      const contract = new StellarSdk.Contract(contractId);
      const account = new StellarSdk.Account(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "0",
      );

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: config.passphrase,
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

      const sim = await rpc.simulateTransaction(tx);

      if (StellarSdk.rpc.Api.isSimulationError(sim)) {
        throw new Error(`Soroban simulation error (${method}): ${sim.error}`);
      }

      if (!StellarSdk.rpc.Api.isSimulationSuccess(sim) || !sim.result) {
        throw new Error(`Soroban simulation failed for ${method}`);
      }

      return sim.result.retval;
    },
    { operation: `simulate ${method}`, silent: true },
  );
}

/**
 * Read the current WASM hash of a deployed Soroban contract.
 *
 * Uses the RPC getLedgerEntries endpoint to fetch the contract instance
 * entry, which contains the executable WASM hash. Returns the hash as a
 * lowercase hex string, or null when the entry cannot be read.
 */
export async function getContractWasmHash(
  contractId: string,
  config: NetworkConfig,
): Promise<string | null> {
  try {
    const rpc = new StellarSdk.rpc.Server(config.rpcUrl);
    const instanceKey = StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance();
    const entry = await rpc.getContractData(contractId, instanceKey);
    const contractData = (entry as { val: StellarSdk.xdr.LedgerEntryData }).val.contractData();
    const scVal = contractData.val();
    if (scVal.switch() !== StellarSdk.xdr.ScValType.scvContractInstance()) {
      return null;
    }
    const instance = scVal.instance();
    const executable = instance.executable();
    if (executable.switch() !== StellarSdk.xdr.ContractExecutableType.contractExecutableWasm()) {
      return null;
    }
    const wasmHashBuf = executable.wasmHash() as Buffer;
    return Buffer.from(wasmHashBuf).toString("hex");
  } catch {
    return null;
  }
}

function encodeTopicSymbol(symbol: string): string {
  return StellarSdk.nativeToScVal(symbol, { type: "symbol" }).toXDR("base64");
}

export function toScVal(value: unknown): StellarSdk.xdr.ScVal | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return StellarSdk.xdr.ScVal.fromXDR(value, "base64");
    } catch {
      return null;
    }
  }

  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StellarSdk.xdr.ScVal).switch === "function"
  ) {
    return value as StellarSdk.xdr.ScVal;
  }

  return null;
}

export function readEventTopics(event: unknown): unknown[] {
  const e = event as { topic?: unknown; topics?: unknown };
  if (Array.isArray(e.topic)) return e.topic;
  if (Array.isArray(e.topics)) return e.topics;
  return [];
}

export function readEventLedger(event: unknown): number {
  const e = event as {
    ledger?: unknown;
    ledger_seq?: unknown;
    ledger_sequence?: unknown;
    ledgerSequence?: unknown;
  };
  const val =
    e.ledger ?? e.ledger_seq ?? e.ledger_sequence ?? e.ledgerSequence ?? 0;
  return typeof val === "number" ? val : Number(val) || 0;
}

export function readEventId(event: unknown, fallback: string): string {
  const e = event as { id?: unknown; event_id?: unknown; eventId?: unknown };
  const val = e.id ?? e.event_id ?? e.eventId;
  return typeof val === "string" ? val : fallback;
}

export function readEventTxHash(event: unknown): string {
  const e = event as { tx_hash?: unknown; txHash?: unknown; hash?: unknown };
  const val = e.tx_hash ?? e.txHash ?? e.hash;
  return typeof val === "string" ? val : "";
}

export function readEventTimestamp(event: unknown): string {
  const e = event as {
    timestamp?: unknown;
    ledger_timestamp?: unknown;
    ledgerTimestamp?: unknown;
    created_at?: unknown;
    createdAt?: unknown;
  };
  const val =
    e.timestamp ??
    e.ledger_timestamp ??
    e.ledgerTimestamp ??
    e.created_at ??
    e.createdAt;

  if (typeof val === "string") return val;
  if (typeof val === "number") return new Date(val * 1000).toISOString();
  return new Date(0).toISOString();
}

export function readEventTimestampNumber(event: unknown): number {
  const iso = readEventTimestamp(event);
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

export async function fetchTokenAllowance(
  contractId: string,
  ownerAddress: string,
  spenderAddress: string,
  config: NetworkConfig,
): Promise<bigint> {
  const args = [
    new StellarSdk.Address(ownerAddress).toScVal(),
    new StellarSdk.Address(spenderAddress).toScVal(),
  ];
  const allowanceVal = await simulateCall(
    contractId,
    "allowance",
    config,
    args,
  );
  return BigInt(decodeI128(allowanceVal));
}

export interface AllowanceWithExpiration {
  amount: bigint;
  expirationLedger: number;
}

export async function fetchAllowanceWithExpiration(
  contractId: string,
  ownerAddress: string,
  spenderAddress: string,
  config: NetworkConfig,
): Promise<AllowanceWithExpiration> {
  const args = [
    new StellarSdk.Address(ownerAddress).toScVal(),
    new StellarSdk.Address(spenderAddress).toScVal(),
  ];
  const allowanceVal = await simulateCall(
    contractId,
    "allowance",
    config,
    args,
  );

  const amount = BigInt(decodeI128(allowanceVal));

  let expirationLedger = 0;
  try {
    if (
      allowanceVal.switch() ===
      StellarSdk.xdr.ScValType.scvVec()
    ) {
      const items = allowanceVal.vec();
      if (items && items.length >= 2) {
        expirationLedger = decodeU32(items[1]);
      }
    }
  } catch {
    // If parsing the tuple fails, default to 0
  }

  return { amount, expirationLedger };
}

export async function fetchApprovedSpendersFromEvents(params: {
  contractId: string;
  ownerAddress: string;
  config: NetworkConfig;
  maxPages?: number;
}): Promise<string[]> {
  const { contractId, ownerAddress, config, maxPages = 5 } = params;
  const spenders = new Set<string>();

  const topicApprove = encodeTopicSymbol("approve");
  const pageSize = 200;

  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const { events, nextCursor } = await fetchIndexedEvents(
      contractId,
      config,
      {
        topics: [topicApprove],
        limit: pageSize,
        cursor,
      },
    );

    if (events.length === 0) break;

    for (const event of events) {
      try {
        if (event.topic.length < 3) continue;

        const topic0 = toScVal(event.topic[0]);
        const topic1 = toScVal(event.topic[1]);
        const topic2 = toScVal(event.topic[2]);
        if (!topic0 || !topic1 || !topic2) continue;

        const symbol = decodeString(topic0);
        if (symbol !== "approve") continue;

        const from = decodeAddress(topic1);
        const spender = decodeAddress(topic2);

        if (from === ownerAddress) {
          spenders.add(spender);
        }
      } catch {
        // ignore malformed events
      }
    }

    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return Array.from(spenders);
}

/** Decode an ScVal string (symbol or string type). */
export function decodeString(val: StellarSdk.xdr.ScVal): string {
  switch (val.switch()) {
    case StellarSdk.xdr.ScValType.scvSymbol():
      return val.sym().toString();
    case StellarSdk.xdr.ScValType.scvString():
      return val.str().toString();
    default:
      return val.value()?.toString() ?? "";
  }
}

/** Decode an ScVal 128-bit integer to a bigint string. */
export function decodeI128(val: StellarSdk.xdr.ScVal): string {
  const parts = val.i128();
  const hi = BigInt(parts.hi().toString());
  const lo = BigInt(parts.lo().toString());
  return ((hi << BigInt(64)) + lo).toString();
}

/** Decode an ScVal u32. */
export function decodeU32(val: StellarSdk.xdr.ScVal): number {
  return val.u32();
}

/** Decode an ScVal address to a string. */
export function decodeAddress(val: StellarSdk.xdr.ScVal): string {
  return StellarSdk.Address.fromScVal(val).toString();
}

function toU32ScVal(value: number): StellarSdk.xdr.ScVal {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("Invalid u32 value");
  }
  return StellarSdk.nativeToScVal(BigInt(value), { type: "u32" });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch full token metadata from a Soroban SEP-41 token contract.
 */
/**
 * Validate if a contract implements the SEP-41 token standard.
 * This function attempts to call the required SEP-41 methods to verify
 * that the contract is a valid token contract.
 */
export async function validateTokenContract(
  contractId: string,
  config: NetworkConfig,
): Promise<{ isValid: boolean; error?: string }> {
  try {
    // Try to call the required SEP-41 methods
    const [nameResult, symbolResult, decimalsResult] = await Promise.allSettled(
      [
        simulateCall(contractId, "name", config),
        simulateCall(contractId, "symbol", config),
        simulateCall(contractId, "decimals", config),
      ],
    );

    // Check if all required methods are available
    if (nameResult.status === "rejected") {
      return {
        isValid: false,
        error: "Contract does not implement 'name()' method",
      };
    }

    if (symbolResult.status === "rejected") {
      return {
        isValid: false,
        error: "Contract does not implement 'symbol()' method",
      };
    }

    if (decimalsResult.status === "rejected") {
      return {
        isValid: false,
        error: "Contract does not implement 'decimals()' method",
      };
    }

    // Try to decode the values to ensure they return the correct types
    try {
      decodeString(nameResult.value);
      decodeString(symbolResult.value);
      decodeU32(decimalsResult.value);
    } catch {
      return {
        isValid: false,
        error: "Contract methods return invalid data types",
      };
    }

    // Optionally check for other common SEP-41 methods
    const [balanceResult, totalSupplyResult] = await Promise.allSettled([
      simulateCall(contractId, "balance", config, [
        StellarSdk.Address.fromString(
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        ).toScVal(),
      ]),
      simulateCall(contractId, "total_supply", config),
    ]);

    if (
      balanceResult.status === "rejected" &&
      totalSupplyResult.status === "rejected"
    ) {
      return {
        isValid: false,
        error: "Contract does not implement required balance or supply methods",
      };
    }

    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error:
        error instanceof Error ? error.message : "Unknown validation error",
    };
  }
}

export async function fetchTokenInfo(
  contractId: string,
  config: NetworkConfig,
): Promise<TokenInfo> {
  return wrapRpcCall(() => _fetchTokenInfo(contractId, config), {
    operation: "Fetch token info",
  });
}

async function _fetchTokenInfo(
  contractId: string,
  config: NetworkConfig,
): Promise<TokenInfo> {
  // First validate that this is a SEP-41 token contract
  const validation = await validateTokenContract(contractId, config);
  if (!validation.isValid) {
    throw new Error(`Invalid token contract: ${validation.error}`);
  }

  const [nameVal, symbolVal, decimalsVal, adminVal] = await Promise.all([
    simulateCall(contractId, "name", config),
    simulateCall(contractId, "symbol", config),
    simulateCall(contractId, "decimals", config),
    simulateCall(contractId, "admin", config).catch(() => null),
  ]);

  const decimals = decodeU32(decimalsVal);

  let totalSupply = "N/A";
  let circulatingSupply = "N/A";
  try {
    const supplyVal = await simulateCall(contractId, "total_supply", config);
    const rawSupply = decodeI128(supplyVal);
    totalSupply = formatTokenAmount(rawSupply, decimals);
    circulatingSupply = totalSupply;
  } catch {
    // total_supply not implemented on this contract
  }

  let maxSupply: string | null = null;
  try {
    const maxVal = await simulateCall(contractId, "max_supply", config);
    if (maxVal && maxVal.switch() !== StellarSdk.xdr.ScValType.scvVoid()) {
      const rawMax = decodeI128(maxVal);
      maxSupply = formatTokenAmount(rawMax, decimals);
    }
  } catch {
    // max_supply not implemented or not accessible
  }

  let contractUri: string | undefined;
  try {
    const uriVal = await simulateCall(contractId, "contract_uri", config);
    contractUri = decodeString(uriVal);
  } catch {
    // contract_uri not set or not accessible
  }

  let complianceNode: string | null = null;
  try {
    const nodeVal = await simulateCall(contractId, "compliance_node", config);
    if (nodeVal && nodeVal.switch() !== StellarSdk.xdr.ScValType.scvVoid()) {
      complianceNode = decodeAddress(nodeVal);
    }
  } catch {
    // compliance_node may not be implemented or accessible; ignore.
  }

  let authorizationRequired = false;
  let authorizationRevocable = false;
  try {
    const reqVal = await simulateCall(contractId, "authorization_required", config);
    if (reqVal) authorizationRequired = Boolean(reqVal.b());
    const revVal = await simulateCall(contractId, "authorization_revocable", config);
    if (revVal) authorizationRevocable = Boolean(revVal.b());
  } catch {
    // authorization checks not implemented or accessible; ignore.
  }

  let isPaused = false;
  try {
    const pausedVal = await simulateCall(contractId, "is_paused", config);
    isPaused = Boolean(pausedVal.b());
  } catch {
    // is_paused not implemented on this contract; assume not paused.
  }

  let isLocked = false;
  try {
    const lockedVal = await simulateCall(contractId, "is_locked", config);
    isLocked = Boolean(lockedVal.b());
  } catch {
    // is_locked not implemented on this contract; assume not locked.
  }

  return {
    name: decodeString(nameVal),
    symbol: decodeString(symbolVal),
    decimals,
    totalSupply,
    circulatingSupply,
    admin:
      adminVal &&
      typeof (adminVal as StellarSdk.xdr.ScVal).switch === "function" &&
      (adminVal as StellarSdk.xdr.ScVal).switch() !==
        StellarSdk.xdr.ScValType.scvVoid()
        ? decodeAddress(adminVal as StellarSdk.xdr.ScVal)
        : "N/A",
    contractId,
    maxSupply,
    contractUri,
    complianceNode,
    authorizationRequired,
    authorizationRevocable,
    isPaused,
    isLocked,
  };
}

/**
 * Fetch a specific wallet's authorization/freeze state on a token contract.
 * Guarded so contracts missing `is_authorized`/`is_frozen` degrade to the
 * permissive defaults (authorized, not frozen).
 */
export async function fetchWalletTokenState(
  contractId: string,
  address: string,
  config: NetworkConfig,
): Promise<WalletTokenState> {
  const addressScVal = new StellarSdk.Address(address).toScVal();

  let isAuthorized = true;
  try {
    const authVal = await simulateCall(
      contractId,
      "is_authorized",
      config,
      [addressScVal],
    );
    isAuthorized = Boolean(authVal.b());
  } catch {
    // is_authorized not implemented; assume authorized.
  }

  let isFrozen = false;
  try {
    const frozenVal = await simulateCall(contractId, "is_frozen", config, [
      addressScVal,
    ]);
    isFrozen = Boolean(frozenVal.b());
  } catch {
    // is_frozen not implemented; assume not frozen.
  }

  return { isAuthorized, isFrozen };
}

/**
 * Fetch a specific account's balance from a Soroban SEP-41 token contract.
 */
export async function fetchTokenBalance(
  contractId: string,
  accountId: string,
  config: NetworkConfig,
): Promise<string> {
  try {
    const args = [StellarSdk.nativeToScVal(accountId, { type: "address" })];
    const res = await simulateCall(contractId, "balance", config, args);

    if (!res) return "0.00";

    const rawBalance = decodeI128(res);

    const decimalsRes = await simulateCall(contractId, "decimals", config);
    const decimals = decimalsRes ? decodeU32(decimalsRes) : 7;

    return formatTokenAmount(rawBalance, decimals);
  } catch (err) {
    console.error(`Failed to fetch and decode balance for ${accountId}:`, err);
    return "0.00";
  }
}

/**
 * Fetch the top token holders.
 */
export async function fetchTopHolders(
  contractId: string,
  config: NetworkConfig,
  symbolHint?: string,
  issuerHint?: string,
  limit = 10,
): Promise<TokenHolder[]> {
  try {
    // Soroban-native token contracts do not have a Horizon asset issuer.
    // Returning an empty list here avoids accidentally mixing in holders
    // from an unrelated wrapped asset that happens to share the same symbol.
    if (contractId.startsWith("C")) {
      return [];
    }

    const horizon = new StellarSdk.Horizon.Server(config.horizonUrl);
    const symbol =
      symbolHint ??
      decodeString(await simulateCall(contractId, "symbol", config));
    const decimals = decodeU32(
      await simulateCall(contractId, "decimals", config),
    );

    let issuer = issuerHint;
    if (!issuer) {
      // Resolve issuer for this asset code from Horizon stats.
      // If multiple issuers exist for same code, prefer one with largest supply.
      const assetsPage = await horizon
        .assets()
        .forCode(symbol)
        .limit(200)
        .call();
      if (assetsPage.records.length === 0) {
        return [];
      }
      const getAssetAmount = (record: unknown): string => {
        const raw = (record as { amount?: unknown }).amount;
        return typeof raw === "string" ? raw : "0";
      };
      issuer = assetsPage.records
        .slice()
        .sort(
          (a, b) =>
            parseFloat(getAssetAmount(b)) - parseFloat(getAssetAmount(a)),
        )[0].asset_issuer;
    }

    const asset = new StellarSdk.Asset(symbol, issuer);
    const [holdersPage, assetStats] = await Promise.all([
      horizon.accounts().forAsset(asset).limit(limit).order("desc").call(),
      horizon.assets().forCode(symbol).forIssuer(issuer).limit(1).call(),
    ]);

    const toRawAmount = (amount: string, tokenDecimals: number): bigint => {
      const [wholePart, fracPart = ""] = amount.split(".");
      const normalizedFrac = fracPart
        .padEnd(tokenDecimals, "0")
        .slice(0, tokenDecimals);
      return BigInt(`${wholePart}${normalizedFrac}`);
    };

    const totalSupplyRaw =
      assetStats.records.length > 0
        ? toRawAmount(
            (assetStats.records[0] as { amount?: string }).amount ?? "0",
            decimals,
          )
        : BigInt(0);

    const parsed = holdersPage.records
      .map((acc) => {
        const bal = acc.balances.find(
          (b) =>
            "asset_code" in b &&
            b.asset_code === symbol &&
            "asset_issuer" in b &&
            b.asset_issuer === issuer,
        );
        const rawBalance = toRawAmount(bal ? bal.balance : "0", decimals);
        return { address: acc.account_id, rawBalance };
      })
      .filter((row) => row.rawBalance > BigInt(0))
      .sort((a, b) =>
        a.rawBalance > b.rawBalance ? -1 : a.rawBalance < b.rawBalance ? 1 : 0,
      );

    return parsed.map(({ address, rawBalance }) => ({
      address,
      balance: formatTokenAmount(rawBalance.toString(), decimals),
      sharePercent:
        totalSupplyRaw > BigInt(0)
          ? Number((rawBalance * BigInt(10000)) / totalSupplyRaw) / 100
          : 0,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Vesting helpers
// ---------------------------------------------------------------------------

function getStructField(
  entries: StellarSdk.xdr.ScMapEntry[],
  name: string,
): StellarSdk.xdr.ScVal {
  const entry = entries.find((e) => decodeString(e.key()) === name);
  if (!entry) throw new Error(`Missing struct field: ${name}`);
  return entry.val();
}

/**
 * Fetch the current ledger sequence number.
 */
export async function fetchCurrentLedger(
  config: NetworkConfig,
): Promise<number> {
  return wrapRpcCall(
    async () => {
      const rpc = new StellarSdk.rpc.Server(config.rpcUrl);
      const result = await rpc.getLatestLedger();
      return result.sequence;
    },
    { operation: "Fetch latest ledger" },
  );
}

export async function fetchVestingScheduleCount(
  vestingContractId: string,
  recipient: string,
  config: NetworkConfig,
): Promise<number> {
  const recipientScVal = new StellarSdk.Address(recipient).toScVal();
  const result = await simulateCall(
    vestingContractId,
    "get_schedule_count",
    config,
    [recipientScVal],
  );
  return decodeU32(result);
}

async function resolveVestingScheduleIndex(params: {
  vestingContractId: string;
  recipient: string;
  config: NetworkConfig;
  scheduleIndex?: number;
}): Promise<{ scheduleIndex: number; scheduleCount: number }> {
  const { vestingContractId, recipient, config, scheduleIndex } = params;
  if (scheduleIndex !== undefined) {
    const scheduleCount = await fetchVestingScheduleCount(
      vestingContractId,
      recipient,
      config,
    );
    if (scheduleCount <= 0) {
      throw new Error("no schedule found");
    }
    if (scheduleIndex < 0 || scheduleIndex >= scheduleCount) {
      throw new Error("schedule index out of bounds");
    }
    return { scheduleIndex, scheduleCount };
  }

  const scheduleCount = await fetchVestingScheduleCount(
    vestingContractId,
    recipient,
    config,
  );
  if (scheduleCount <= 0) {
    throw new Error("no schedule found");
  }
  return { scheduleIndex: scheduleCount - 1, scheduleCount };
}

/**
 * Fetch a vesting schedule.
 */
export async function fetchVestingSchedule(
  vestingContractId: string,
  recipient: string,
  config: NetworkConfig,
  scheduleIndex?: number,
): Promise<VestingScheduleInfo> {
  const resolved = await resolveVestingScheduleIndex({
    vestingContractId,
    recipient,
    config,
    scheduleIndex,
  });
  const recipientScVal = new StellarSdk.Address(recipient).toScVal();
  const result = await simulateCall(vestingContractId, "get_schedule", config, [
    recipientScVal,
    toU32ScVal(resolved.scheduleIndex),
  ]);

  const fields = result.map()!;
  return {
    recipient: decodeAddress(getStructField(fields, "recipient")),
    totalAmount: decodeI128(getStructField(fields, "total_amount")),
    cliffLedger: decodeU32(getStructField(fields, "cliff_ledger")),
    endLedger: decodeU32(getStructField(fields, "end_ledger")),
    released: decodeI128(getStructField(fields, "released")),
    revoked: getStructField(fields, "revoked").b(),
    scheduleIndex: resolved.scheduleIndex,
    scheduleCount: resolved.scheduleCount,
  };
}

/**
 * Fetch transaction history (events) for a token contract via the Mercury indexer.
 * Uses cursor-based pagination to walk past the Soroban RPC retention window.
 */
/** All event topic names the indexer and live-poll hooks subscribe to. */
export const TRACKED_EVENT_TOPICS = [
  "init",
  "transfer",
  "mint",
  "burn",
  "clawback",
  "freeze",
  "unfreeze",
  "pause",
  "unpause",
  "authorize",
  "revoke_auth",
  "revoked",
  "upgrade",
  "approve",
  "set_max_b",
  "set_cnode",
  "prop_admin",
  "set_admin",
  "update_uri",
] as const;

type TrackedTopic = (typeof TRACKED_EVENT_TOPICS)[number];

function isTrackedTopic(s: string): s is TrackedTopic {
  return (TRACKED_EVENT_TOPICS as readonly string[]).includes(s);
}

/**
 * Decode a single raw event into a partial TokenActivityInfo.
 * Returns null for topics we don't recognise.
 */
function decodeActivityEvent(
  topicStrings: string[],
  value: string | undefined,
  meta: { id: string; txHash: string; ledger: number; timestamp: string },
): TokenActivityInfo | null {
  if (topicStrings.length === 0) return null;
  const topic0 = toScVal(topicStrings[0]);
  if (!topic0) return null;
  const typePath = decodeString(topic0);

  const base: TokenActivityInfo = {
    id: meta.id,
    pagingToken: meta.id,
    type: "other",
    amount: "-",
    from: "-",
    to: "-",
    txHash: meta.txHash,
    timestamp: meta.timestamp,
  };

  if (isTrackedTopic(typePath)) {
    base.type = typePath;
  } else {
    // Gracefully label unknowns instead of dropping them
    base.type = "other";
  }

  const data = toScVal(value);

  switch (typePath) {
    case "mint": {
      if (data) base.amount = decodeI128(data);
      // SEP-41: topics are ("mint", admin, to)
      if (topicStrings.length > 2) {
        const adminVal = toScVal(topicStrings[1]);
        const toVal = toScVal(topicStrings[2]);
        if (adminVal) base.from = decodeAddress(adminVal);
        if (toVal) base.to = decodeAddress(toVal);
      }
      break;
    }
    case "burn": {
      if (data) base.amount = decodeI128(data);
      if (topicStrings.length > 1) {
        const fromVal = toScVal(topicStrings[1]);
        if (fromVal) base.from = decodeAddress(fromVal);
      }
      break;
    }
    case "clawback": {
      if (data) base.amount = decodeI128(data);
      // SEP-41: topics are ("clawback", admin, from)
      if (topicStrings.length > 2) {
        const adminVal = toScVal(topicStrings[1]);
        const fromVal = toScVal(topicStrings[2]);
        if (adminVal) base.to = decodeAddress(adminVal);
        if (fromVal) base.from = decodeAddress(fromVal);
      }
      break;
    }
    case "transfer": {
      if (data) base.amount = decodeI128(data);
      if (topicStrings.length > 2) {
        const fromVal = toScVal(topicStrings[1]);
        const toVal = toScVal(topicStrings[2]);
        if (fromVal) base.from = decodeAddress(fromVal);
        if (toVal) base.to = decodeAddress(toVal);
      }
      break;
    }
    case "freeze":
    case "unfreeze":
    case "authorize":
    case "revoke_auth": {
      // topic[1] = account address being acted on
      if (topicStrings.length > 1) {
        const addrVal = toScVal(topicStrings[1]);
        if (addrVal) base.subject = decodeAddress(addrVal);
      }
      break;
    }
    case "prop_admin": {
      // topics are ("prop_admin", current_admin, new_admin)
      if (topicStrings.length > 2) {
        const currentVal = toScVal(topicStrings[1]);
        const newVal = toScVal(topicStrings[2]);
        if (currentVal) base.from = decodeAddress(currentVal);
        if (newVal) base.to = decodeAddress(newVal);
      }
      break;
    }
    case "set_admin": {
      // topics are ("set_admin", old_admin, new_admin)
      if (topicStrings.length > 2) {
        const oldVal = toScVal(topicStrings[1]);
        const newVal = toScVal(topicStrings[2]);
        if (oldVal) base.from = decodeAddress(oldVal);
        if (newVal) base.to = decodeAddress(newVal);
      }
      break;
    }
    case "revoked":
    case "pause":
    case "unpause":
    case "upgrade":
    case "init":
    case "approve":
    case "set_max_b":
    case "set_cnode":
    case "update_uri":
      // No address payload or special handling needed for activity feed
      break;
    default:
      break;
  }

  return base;
}

export async function fetchTransactionHistory(
  contractId: string,
  config: NetworkConfig,
  options: { cursor?: string; limit?: number } = {},
): Promise<{ items: TransactionItem[]; nextCursor: string | null }> {
  const { cursor, limit = 200 } = options;

  const topicFilters = TRACKED_EVENT_TOPICS.map(encodeTopicSymbol);

  const { events, nextCursor } = await fetchIndexedEvents(contractId, config, {
    topics: topicFilters,
    cursor,
    limit,
  });

  const items: TransactionItem[] = [];

  for (const event of events) {
    const topic0 = toScVal(event.topic[0]);
    if (!topic0) continue;

    const typePath = decodeString(topic0);
    // fetchTransactionHistory returns only the classic token-transfer types
    if (
      typePath !== "mint" &&
      typePath !== "burn" &&
      typePath !== "clawback" &&
      typePath !== "transfer"
    ) {
      continue;
    }

    const data = toScVal(event.value);
    if (!data) continue;

    const item: Partial<TransactionItem> = {
      type: typePath as TransactionItem["type"],
      ledger: event.ledger,
      timestamp: Math.floor(Date.parse(event.timestamp) / 1000) || 0,
      id: event.id || `${event.tx_hash}-${event.ledger}`,
    };

    item.amount = decodeI128(data);

    if (typePath === "mint" && event.topic.length > 2) {
      // SEP-41: topics are ("mint", admin, to)
      const admin = toScVal(event.topic[1]);
      const to = toScVal(event.topic[2]);
      if (admin) item.from = decodeAddress(admin);
      if (to) item.to = decodeAddress(to);
    } else if (typePath === "burn" && event.topic.length > 1) {
      const from = toScVal(event.topic[1]);
      if (from) item.from = decodeAddress(from);
    } else if (typePath === "clawback" && event.topic.length > 2) {
      // SEP-41: topics are ("clawback", admin, from)
      const admin = toScVal(event.topic[1]);
      const from = toScVal(event.topic[2]);
      if (admin) item.to = decodeAddress(admin);
      if (from) item.from = decodeAddress(from);
    } else if (typePath === "transfer" && event.topic.length > 2) {
      const from = toScVal(event.topic[1]);
      const to = toScVal(event.topic[2]);
      if (from) item.from = decodeAddress(from);
      if (to) item.to = decodeAddress(to);
    }

    items.push(item as TransactionItem);
  }

  return { items: items.reverse(), nextCursor };
}

export type TokenActivityType =
  | "mint"
  | "transfer"
  | "burn"
  | "clawback"
  | "freeze"
  | "unfreeze"
  | "pause"
  | "unpause"
  | "authorize"
  | "unauthorize"
  | "set_admin"
  | "revoke_admin"
  | "upgrade"
  | "other";

export interface TokenActivityInfo {
  id: string;
  pagingToken: string;
  type: TokenActivityType;
  amount: string;
  from: string;
  to: string;
  /** address or subject involved in admin/compliance events */
  subject?: string;
  timestamp: string;
  txHash: string;
}

/**
 * Fetch token activity operations for a given account or contract ID.
 * Parses classic `payment` and Soroban `invoke_host_function` operations.
 */
export async function fetchAccountOperations(
  accountId: string,
  config: NetworkConfig,
  cursor?: string,
  limit = 10,
): Promise<{ records: TokenActivityInfo[]; nextCursor: string | null }> {
  try {
    // For contract IDs, use indexer events instead of Horizon.
    if (accountId.startsWith("C")) {
      const topicFilters = TRACKED_EVENT_TOPICS.map(encodeTopicSymbol);
      const pageSize = Math.min(limit, 200);

      const { events, nextCursor: nextIndexerCursor } =
        await fetchIndexedEvents(accountId, config, {
          topics: topicFilters,
          limit: pageSize,
          cursor: cursor ?? undefined,
        });

      const records: TokenActivityInfo[] = [];

      for (const event of events) {
        const decoded = decodeActivityEvent(
          // IndexedEvent.topic is unknown[]; the decoder re-parses each entry
          // as an XDR-encoded string, so normalize before handing it over.
          event.topic.map((t) => String(t)),
          typeof event.value === "string" ? event.value : undefined,
          {
            id: event.id || `${event.tx_hash}-${event.ledger}`,
            txHash: event.tx_hash,
            ledger: event.ledger,
            timestamp: event.timestamp,
          },
        );
        if (decoded) records.push(decoded);
      }

      return { records, nextCursor: nextIndexerCursor };
    }

    const horizon = new StellarSdk.Horizon.Server(getHorizonUrl());

    // Horizon's .forAccount() only accepts Ed25519 public keys (starting with G).
    if (!accountId.startsWith("G") && !accountId.startsWith("M")) {
      return { records: [], nextCursor: null };
    }

    let callBuilder = horizon
      .operations()
      .forAccount(accountId)
      .limit(limit)
      .order("desc");
    if (cursor) {
      callBuilder = callBuilder.cursor(cursor);
    }

    const response = await callBuilder.call();

    // Extract paging token for the next page, from the last record fetched
    // (since order is desc, the last record in this array is the oldest).
    const nextCursor =
      response.records.length > 0
        ? response.records[response.records.length - 1].paging_token
        : null;

    const parsed: TokenActivityInfo[] = [];

    for (const record of response.records) {
      // Classic Native/Asset Payments
      if (record.type === "payment") {
        const r = record as unknown as Record<string, unknown>; // Horizon.ServerApi.PaymentOperationRecord
        // Native mints aren't strictly 'payment' but for asset payments:
        const isMint = r.from === r.asset_issuer;
        const isBurn = r.to === r.asset_issuer; // simplified burn heuristic
        let typeInfo: "mint" | "transfer" | "burn" = "transfer";
        if (isMint) typeInfo = "mint";
        else if (isBurn) typeInfo = "burn";

        parsed.push({
          id: record.id,
          pagingToken: record.paging_token,
          type: typeInfo,
          amount: typeof r.amount === "string" ? r.amount : "0",
          from: typeof r.from === "string" ? r.from : "Unknown",
          to: typeof r.to === "string" ? r.to : "Unknown",
          timestamp: record.created_at,
          txHash: record.transaction_hash,
        });
      }
      // Soroban Contract Invokes
      else if (record.type === "invoke_host_function") {
        const r = record as unknown as Record<string, unknown>;
        // Check for balance changes (requires Soroban RPC / Horizon with Soroban ingestion)
        // Note: Soroban Horizon responses might include `asset_balance_changes` if it was a token transfer
        const balChanges = r.asset_balance_changes;
        if (Array.isArray(balChanges) && balChanges.length > 0) {
          // Find the transfer or mint that is most relevant.
          // This is a simplified heuristic. We pick the first transfer for now.
          const transfer = balChanges.find((c: unknown) => {
            if (!c || typeof c !== "object") return false;
            const cast = c as Record<string, unknown>;
            return (
              cast.type === "transfer" ||
              cast.type === "mint" ||
              cast.type === "burn"
            );
          }) as Record<string, unknown> | undefined;

          if (transfer) {
            let actType: "mint" | "transfer" | "burn" = "transfer";
            if (transfer.from === r.source_account && transfer.type === "mint")
              actType = "mint"; // very rough heuristic, actual type is in transfer.type
            if (transfer.type === "mint" || transfer.type === "burn")
              actType = transfer.type as "mint" | "burn";

            parsed.push({
              id: record.id,
              pagingToken: record.paging_token,
              type: actType,
              amount:
                typeof transfer.amount === "string" ? transfer.amount : "0",
              from:
                typeof transfer.from === "string"
                  ? transfer.from
                  : typeof r.source_account === "string"
                    ? r.source_account
                    : "Unknown",
              to: typeof transfer.to === "string" ? transfer.to : "Unknown",
              timestamp: record.created_at,
              txHash: record.transaction_hash,
            });
            continue; // parsed successfully via balance changes
          }
        }

        // If we couldn't parse balance changes, mark as generic
        parsed.push({
          id: record.id,
          pagingToken: record.paging_token,
          type: "other",
          amount: "-",
          from:
            typeof r.source_account === "string" ? r.source_account : "Unknown",
          to: "-",
          timestamp: record.created_at,
          txHash: record.transaction_hash,
        });
      }
    }

    // Filter out "other" if we only want token activity, but keeping it helps visibility
    const filtered = parsed.filter((p) => p.type !== "other");

    return { records: filtered.length > 0 ? filtered : parsed, nextCursor };
  } catch (error) {
    console.error("Error fetching account operations from Horizon:", error);
    return { records: [], nextCursor: null };
  }
}

export interface AccountBalance {
  assetType: "native" | "credit_alphanum4" | "credit_alphanum12";
  assetCode: string;
  assetIssuer: string;
  balance: string;
}

/**
 * Fetch all balances for a Stellar account from Horizon.
 */
export async function fetchAccountBalances(
  publicKey: string,
  config: NetworkConfig,
): Promise<AccountBalance[]> {
  const horizon = new StellarSdk.Horizon.Server(config.horizonUrl);
  const account = await horizon.loadAccount(publicKey);

  return account.balances.map((bal) => {
    if (bal.asset_type === "native") {
      return {
        assetType: "native" as const,
        assetCode: "XLM",
        assetIssuer: "",
        balance: bal.balance,
      };
    }
    const b = bal as unknown as {
      asset_type: string;
      asset_code: string;
      asset_issuer: string;
      balance: string;
    };
    return {
      assetType: b.asset_type as AccountBalance["assetType"],
      assetCode: b.asset_code,
      assetIssuer: b.asset_issuer,
      balance: b.balance,
    };
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatTokenAmount(raw: string, decimals: number): string {
  if (raw === "N/A") return raw;
  const num = BigInt(raw);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = num / divisor;
  const frac = num % divisor;

  if (frac === BigInt(0)) return whole.toLocaleString();

  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}.${fracStr}`;
}

export function parseTokenAmount(amount: string, decimals: number): bigint {
  const trimmed = amount.trim().replace(/,/g, "");
  if (!trimmed) {
    throw new Error("Amount is required");
  }

  if (trimmed.startsWith("-")) {
    throw new Error("Amount must be positive");
  }

  const [wholeRaw, fracRaw = ""] = trimmed.split(".");
  if (!/^\d+$/.test(wholeRaw || "0")) {
    throw new Error("Invalid amount");
  }
  if (fracRaw && !/^\d+$/.test(fracRaw)) {
    throw new Error("Invalid amount");
  }

  if (fracRaw.length > decimals) {
    throw new Error(`Too many decimal places (max ${decimals})`);
  }

  const whole = BigInt(wholeRaw || "0");
  const fracPadded = (fracRaw || "").padEnd(decimals, "0");
  const frac = fracPadded ? BigInt(fracPadded) : BigInt(0);
  const scale = BigInt(10) ** BigInt(decimals);
  return whole * scale + frac;
}

export async function fetchTokenDecimals(
  tokenContractId: string,
  config: NetworkConfig,
): Promise<number> {
  const result = await simulateCall(tokenContractId, "decimals", config);
  return decodeU32(result);
}

export function truncateAddress(addr: string, chars = 4): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars + 1)}...${addr.slice(-chars)}`;
}

// ---------------------------------------------------------------------------
// Stellar Expert link helpers
// ---------------------------------------------------------------------------

/**
 * Generate a Stellar Expert URL for various blockchain entities.
 *
 * @param type - The type of entity: 'account', 'contract', or 'tx'
 * @param identifier - The public key, contract ID, or transaction hash
 * @param network - The network type ('testnet' or 'mainnet')
 * @returns The full Stellar Expert URL
 */
export function getStellarExpertUrl(
  type: "account" | "contract" | "tx",
  identifier: string,
  network: "testnet" | "mainnet" = "testnet",
): string {
  const baseUrl = "https://stellar.expert/explorer";
  return `${baseUrl}/${network}/${type}/${identifier}`;
}

// ---------------------------------------------------------------------------
// Supply breakdown helpers
// ---------------------------------------------------------------------------

export interface SupplyBreakdown {
  circulating: number;
  locked: number;
  burned: number;
  burnedAvailable: boolean;
  total: number;
}

/**
 * Calculate supply breakdown for a token.
 *
 * @param tokenContractId - The token contract ID
 * @param vestingContractId - Optional vesting contract ID to calculate locked supply
 * @returns Supply breakdown with circulating, locked, and burned amounts
 */
export async function fetchSupplyBreakdown(
  tokenContractId: string,
  config: NetworkConfig,
  vestingContractId?: string,
): Promise<SupplyBreakdown> {
  try {
    // Fetch total supply from token contract
    const totalSupplyVal = await simulateCall(
      tokenContractId,
      "total_supply",
      config,
    );
    const totalSupply = Number(decodeI128(totalSupplyVal));

    // Fetch total burned from token contract (tracked explicitly on-chain)
    let burnedSupply = 0;
    let burnedAvailable = false;
    try {
      const burnedVal = await simulateCall(
        tokenContractId,
        "total_burned",
        config,
      );
      burnedSupply = Number(decodeI128(burnedVal));
      burnedAvailable = true;
    } catch {
      burnedSupply = 0;
      burnedAvailable = false;
    }

    // Locked supply is modeled as the token balance held by the vesting
    // contract (or contracts). When a vesting schedule is created, tokens
    // are transferred to the vesting contract address and remain there
    // until released.
    let lockedSupply = 0;
    if (vestingContractId) {
      try {
        const vestingAddr = new StellarSdk.Address(vestingContractId).toScVal();
        const lockedVal = await simulateCall(
          tokenContractId,
          "balance",
          config,
          [vestingAddr],
        );
        lockedSupply = Number(decodeI128(lockedVal));
      } catch {
        // If the vesting contract or balance call fails, fall back to 0
        lockedSupply = 0;
      }
    }

    const circulatingSupply = totalSupply - lockedSupply - burnedSupply;

    return {
      circulating: circulatingSupply,
      locked: lockedSupply,
      burned: burnedSupply,
      burnedAvailable,
      total: totalSupply,
    };
  } catch (error) {
    console.error("[fetchSupplyBreakdown] Error:", error);
    throw new Error("Failed to fetch supply breakdown");
  }
}

// Transaction building and submission
// ---------------------------------------------------------------------------

/**
 * Build a transaction XDR for revoking a vesting schedule.
 * Returns the unsigned transaction XDR string.
 */
export async function buildRevokeTransaction(
  vestingContractId: string,
  recipientAddress: string,
  sourcePublicKey: string,
  config: NetworkConfig,
  scheduleIndex?: number,
): Promise<string> {
  const contract = new StellarSdk.Contract(vestingContractId);
  const resolved = await resolveVestingScheduleIndex({
    vestingContractId,
    recipient: recipientAddress,
    config,
    scheduleIndex,
  });
  const recipientScVal = new StellarSdk.Address(recipientAddress).toScVal();
  const indexScVal = toU32ScVal(resolved.scheduleIndex);

  // Get source account
  const horizon = new StellarSdk.Horizon.Server(config.horizonUrl);
  const sourceAccount = await horizon.loadAccount(sourcePublicKey);

  // Build transaction
  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.passphrase,
  })
    .addOperation(contract.call("revoke", recipientScVal, indexScVal))
    .setTimeout(30)
    .build();

  // Simulate to get resource fees
  const assembled = await simulateAndAssembleTransaction(tx, config);
  return assembled.build().toXDR();
}

/**
 * Build a transaction XDR for SEP-41 approve (grant/revoke allowance).
 * Returns the unsigned transaction XDR string.
 */
export async function buildApproveTransaction(params: {
  tokenContractId: string;
  ownerAddress: string;
  spenderAddress: string;
  amount: bigint;
  expirationLedger: number;
  config: NetworkConfig;
}): Promise<string> {
  const {
    tokenContractId,
    ownerAddress,
    spenderAddress,
    amount,
    expirationLedger,
    config,
  } = params;

  const contract = new StellarSdk.Contract(tokenContractId);
  const ownerScVal = new StellarSdk.Address(ownerAddress).toScVal();
  const spenderScVal = new StellarSdk.Address(spenderAddress).toScVal();
  const amountScVal = StellarSdk.nativeToScVal(BigInt(amount), {
    type: "i128",
  });
  const expirationScVal = StellarSdk.nativeToScVal(BigInt(expirationLedger), {
    type: "u32",
  });

  const horizon = new StellarSdk.Horizon.Server(config.horizonUrl);
  const sourceAccount = await horizon.loadAccount(ownerAddress);

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.passphrase,
  })
    .addOperation(
      contract.call(
        "approve",
        ownerScVal,
        spenderScVal,
        amountScVal,
        expirationScVal,
      ),
    )
    .setTimeout(30)
    .build();

  const assembled = await simulateAndAssembleTransaction(tx, config);
  return assembled.build().toXDR();
}

/**
 * Build a transaction XDR for SEP-41 transfer_from.
 * Returns the unsigned transaction XDR string.
 */
export async function buildTransferFromTransaction(params: {
  tokenContractId: string;
  spenderAddress: string;
  fromAddress: string;
  toAddress: string;
  amount: bigint;
  config: NetworkConfig;
}): Promise<string> {
  const {
    tokenContractId,
    spenderAddress,
    fromAddress,
    toAddress,
    amount,
    config,
  } = params;

  const contract = new StellarSdk.Contract(tokenContractId);
  const spenderScVal = new StellarSdk.Address(spenderAddress).toScVal();
  const fromScVal = new StellarSdk.Address(fromAddress).toScVal();
  const toScVal = new StellarSdk.Address(toAddress).toScVal();
  const amountScVal = StellarSdk.nativeToScVal(BigInt(amount), {
    type: "i128",
  });

  const horizon = new StellarSdk.Horizon.Server(config.horizonUrl);
  const sourceAccount = await horizon.loadAccount(spenderAddress);

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.passphrase,
  })
    .addOperation(
      contract.call(
        "transfer_from",
        spenderScVal,
        fromScVal,
        toScVal,
        amountScVal,
      ),
    )
    .setTimeout(30)
    .build();

  const assembled = await simulateAndAssembleTransaction(tx, config);
  return assembled.build().toXDR();
}

/**
 * Build a transaction XDR for burning tokens.
 * Returns the unsigned transaction XDR string.
 */
export async function buildBurnTransaction(
  tokenContractId: string,
  fromAddress: string,
  amount: string,
  decimals: number,
  config: NetworkConfig,
): Promise<string> {
  const contract = new StellarSdk.Contract(tokenContractId);
  const fromScVal = new StellarSdk.Address(fromAddress).toScVal();
  const rawAmount = parseTokenAmount(amount, decimals);
  const amountScVal = StellarSdk.xdr.ScVal.scvI128(
    new StellarSdk.xdr.Int128Parts({
      hi: StellarSdk.xdr.Int64.fromString((rawAmount >> BigInt(64)).toString()),
      lo: StellarSdk.xdr.Uint64.fromString(
        (rawAmount & ((BigInt(1) << BigInt(64)) - BigInt(1))).toString(),
      ),
    }),
  );

  const rpc = new StellarSdk.rpc.Server(config.rpcUrl);
  const horizon = new StellarSdk.Horizon.Server(config.horizonUrl);

  const sourceAccount = await horizon.loadAccount(fromAddress);

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.passphrase,
  })
    .addOperation(contract.call("burn_self", fromScVal, amountScVal))
    .setTimeout(30)
    .build();

  const simulated = await rpc.simulateTransaction(tx);

  if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  if (!StellarSdk.rpc.Api.isSimulationSuccess(simulated)) {
    throw new Error("Transaction simulation was not successful");
  }

  const assembled = StellarSdk.rpc.assembleTransaction(tx, simulated);
  return assembled.build().toXDR();
}

/**
 * Submit a signed transaction XDR to the network.
 * Returns the transaction hash on success.
 */
export async function submitTransaction(
  signedXdr: string,
  config: NetworkConfig,
): Promise<string> {
  return wrapRpcCall(
    async () => {
      const tx = StellarSdk.TransactionBuilder.fromXDR(
        signedXdr,
        config.passphrase,
      );

      const rpc = new StellarSdk.rpc.Server(config.rpcUrl);
      const result = await rpc.sendTransaction(tx as StellarSdk.Transaction);

      if (result.status === "ERROR") {
        throw new Error(
          `Transaction failed: ${result.errorResult?.toXDR("base64")}`,
        );
      }

      // Poll for transaction result
      let getResponse = await rpc.getTransaction(result.hash);
      let attempts = 0;
      const maxAttempts = 30;

      while (getResponse.status === "NOT_FOUND" && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        getResponse = await rpc.getTransaction(result.hash);
        attempts++;
      }

      if (getResponse.status === "NOT_FOUND") {
        throw new Error("Transaction not found after polling");
      }

      if (getResponse.status === "FAILED") {
        throw new Error(
          `Transaction failed: ${getResponse.resultXdr?.toXDR("base64")}`,
        );
      }

      return result.hash;
    },
    { operation: "Submit transaction" },
  );
}
