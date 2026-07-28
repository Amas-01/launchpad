import { rpc, Address, xdr } from "@stellar/stellar-sdk";
import { addressToScVal, i128ToScVal, nativeToScVal } from "@/lib/soroban";
import type { PreflightCheckResult } from "@/lib/transactionSimulator";
import type { useTransactionSimulator } from "@/hooks/useTransactionSimulator";
import type { BatchMintEntry } from "@/lib/batch";
import type {
  MintData,
  BurnData,
  TransferAdminData,
  VestingData,
  ManageVestingData,
  MetadataUriData,
  UpgradeData,
  WhaleCapData,
  ComplianceNodeData,
  AccountData,
  EmptyData,
} from "./schemas";

/**
 * Declarative registry of every admin capability.
 *
 * `AdminPanel` used to dispatch these through a 14-branch if/else chain, with
 * a second parallel chain for success handling. Both had to be kept in sync by
 * hand, which is how capabilities went missing. Each action now declares the
 * contract call it makes, how to preflight it, and what to say afterwards, and
 * `useAdminAction` runs the one shared build → simulate → sign → submit →
 * toast → refresh sequence over that declaration.
 *
 * Adding a capability means adding one entry here plus the UI that calls it.
 */

/** Soroban ledgers per day, assuming 5-second ledgers. */
const LEDGERS_PER_DAY = 17280;

type Simulator = ReturnType<typeof useTransactionSimulator>;

export interface AdminActionContext {
  /** The token contract being administered. */
  contractId: string;
  decimals: number;
  /** Connected admin wallet. */
  publicKey: string;
  /** The single shared RPC client. */
  server: rpc.Server;
  simulator: Simulator;
}

/** The concrete contract call an action resolves to. */
export interface ResolvedCall {
  method: string;
  args: xdr.ScVal[];
  /** Defaults to the token contract; vesting actions target their own. */
  contractId?: string;
}

export interface AdminActionDef<TData> {
  /** Used in toast titles and the screen-reader announcement. */
  label: string;
  resolve: (
    data: TData,
    ctx: AdminActionContext,
  ) => ResolvedCall | Promise<ResolvedCall>;
  /**
   * How to preflight before asking the wallet to sign.
   * - `"simulate"` (default) runs the generic contract simulation.
   * - `"none"` skips it, for calls that take no user input.
   * - a function runs a capability-specific check with richer diagnostics.
   */
  preflight?:
    | "simulate"
    | "none"
    | ((
        data: TData,
        ctx: AdminActionContext,
      ) => Promise<PreflightCheckResult | null>);
  /** Extra toast on success, for actions with consequences worth restating. */
  successToast?: { title: string; message: string };
}

/** Maps each action key to the shape of the form data it consumes. */
export interface AdminActionData {
  mint: MintData;
  "batch-mint": { entries: BatchMintEntry[] };
  clawback: BurnData;
  "burn-admin": BurnData;
  transfer: TransferAdminData;
  "cancel-admin": EmptyData;
  "accept-admin": EmptyData;
  vesting: VestingData;
  "metadata-uri": MetadataUriData;
  "extend-cliff": ManageVestingData;
  "vesting-revoke": ManageVestingData;
  "set-whale-cap": WhaleCapData;
  "disable-whale-cap": EmptyData;
  "set-compliance-node": ComplianceNodeData;
  "clear-compliance-node": EmptyData;
  pause: EmptyData;
  unpause: EmptyData;
  freeze: AccountData;
  unfreeze: AccountData;
  revoke: EmptyData;
  upgrade: UpgradeData;
}

export type AdminActionKey = keyof AdminActionData;

/** Scale a human-entered decimal string into the token's base units. */
export function scaleAmount(amount: string, decimals: number): bigint {
  return BigInt(Math.round(parseFloat(amount) * 10 ** decimals));
}

/**
 * Encode an optional vesting schedule index as Soroban `Option<u32>`.
 * Soroban represents `None` as a Void ScVal and `Some(n)` as the inner value.
 */
function indexToScVal(scheduleIndex: string): xdr.ScVal {
  return scheduleIndex === ""
    ? xdr.ScVal.scvVoid()
    : nativeToScVal(Number(scheduleIndex), { type: "u32" });
}

/** "N days from now" as an absolute ledger sequence. */
async function ledgerInDays(server: rpc.Server, days: string | number) {
  const { sequence } = await server.getLatestLedger();
  return sequence + Math.round(Number(days) * LEDGERS_PER_DAY);
}

type AdminActionRegistry = {
  [K in AdminActionKey]: AdminActionDef<AdminActionData[K]>;
};

export const ADMIN_ACTIONS: AdminActionRegistry = {
  /* ── Supply ──────────────────────────────────────────────────── */

  mint: {
    label: "Mint",
    resolve: (data, ctx) => ({
      method: "mint",
      args: [
        addressToScVal(data.to),
        i128ToScVal(scaleAmount(data.amount, ctx.decimals)),
      ],
    }),
    preflight: (data, ctx) =>
      ctx.simulator.checkMint(
        ctx.contractId,
        data.to,
        scaleAmount(data.amount, ctx.decimals),
        ctx.publicKey,
      ),
  },

  "batch-mint": {
    label: "Batch mint",
    resolve: (data, ctx) => ({
      method: "mint_batch",
      args: [
        nativeToScVal(
          data.entries.map((e) => new Address(e.address)),
          { type: "vec" },
        ),
        nativeToScVal(
          data.entries.map((e) => scaleAmount(e.amount, ctx.decimals)),
          { type: "vec" },
        ),
      ],
    }),
    preflight: "none",
  },

  clawback: {
    label: "Clawback",
    resolve: (data, ctx) => ({
      method: "clawback",
      args: [
        addressToScVal(data.from),
        i128ToScVal(scaleAmount(data.amount, ctx.decimals)),
      ],
    }),
  },

  "burn-admin": {
    label: "Burn (admin)",
    resolve: (data, ctx) => ({
      method: "burn_admin",
      args: [
        addressToScVal(data.from),
        i128ToScVal(scaleAmount(data.amount, ctx.decimals)),
      ],
    }),
  },

  /* ── Admin lifecycle ─────────────────────────────────────────── */

  transfer: {
    label: "Propose admin",
    resolve: (data) => ({
      method: "propose_admin",
      args: [addressToScVal(data.newAdmin)],
    }),
  },

  "cancel-admin": {
    label: "Cancel admin transfer",
    // No dedicated cancel exists on-chain, so overwrite the pending proposal
    // with the current admin's own address. This neutralizes the transfer —
    // the previously proposed admin can no longer accept.
    resolve: (_data, ctx) => ({
      method: "propose_admin",
      args: [addressToScVal(ctx.publicKey)],
    }),
  },

  "accept-admin": {
    label: "Accept admin",
    resolve: () => ({ method: "accept_admin", args: [] }),
  },

  revoke: {
    label: "Revoke admin",
    resolve: () => ({ method: "revoke_admin", args: [] }),
    preflight: "none",
    successToast: {
      title: "Admin revoked",
      message:
        "The token contract is now locked. Admin operations can no longer be performed.",
    },
  },

  /* ── Vesting ─────────────────────────────────────────────────── */

  vesting: {
    label: "Vesting",
    resolve: async (data, ctx) => {
      const cliffLedger = await ledgerInDays(ctx.server, data.cliffDays);
      const endLedger =
        cliffLedger + Math.round(Number(data.durationDays) * LEDGERS_PER_DAY);

      return {
        contractId: data.vestingContract,
        method: "create_schedule",
        args: [
          addressToScVal(data.recipient),
          i128ToScVal(scaleAmount(data.amount, ctx.decimals)),
          nativeToScVal(cliffLedger, { type: "u32" }),
          nativeToScVal(endLedger, { type: "u32" }),
        ],
      };
    },
    preflight: async (data, ctx) => {
      const cliffLedger = await ledgerInDays(ctx.server, data.cliffDays);
      const endLedger =
        cliffLedger + Math.round(Number(data.durationDays) * LEDGERS_PER_DAY);
      return ctx.simulator.checkCreateSchedule(
        data.vestingContract,
        data.recipient,
        scaleAmount(data.amount, ctx.decimals),
        cliffLedger,
        endLedger,
        ctx.publicKey,
      );
    },
  },

  "extend-cliff": {
    label: "Extend cliff",
    resolve: async (data, ctx) => ({
      contractId: data.vestingContract,
      method: "extend_cliff",
      args: [
        addressToScVal(data.recipient),
        // Same ledger math as create_schedule: the new cliff is an absolute
        // ledger computed as "now + N days".
        nativeToScVal(await ledgerInDays(ctx.server, data.newCliffDays), {
          type: "u32",
        }),
        indexToScVal(data.scheduleIndex),
      ],
    }),
  },

  "vesting-revoke": {
    label: "Revoke schedule",
    resolve: (data) => ({
      contractId: data.vestingContract,
      method: "revoke",
      args: [
        addressToScVal(data.recipient),
        indexToScVal(data.scheduleIndex),
      ],
    }),
  },

  /* ── Policy ──────────────────────────────────────────────────── */

  "set-whale-cap": {
    label: "Set whale protection cap",
    resolve: (data) => ({
      method: "set_max_balance_per_account",
      args: [nativeToScVal(Number(data.cap), { type: "u32" })],
    }),
  },

  "disable-whale-cap": {
    label: "Disable whale protection",
    resolve: () => ({
      method: "set_max_balance_per_account",
      args: [xdr.ScVal.scvVoid()],
    }),
  },

  "set-compliance-node": {
    label: "Set compliance node",
    resolve: (data) => ({
      method: "set_compliance_node",
      args: [addressToScVal(data.address)],
    }),
  },

  "clear-compliance-node": {
    label: "Clear compliance node",
    resolve: () => ({
      method: "set_compliance_node",
      args: [xdr.ScVal.scvVoid()],
    }),
  },

  "metadata-uri": {
    label: "Update metadata URI",
    resolve: (data) => ({
      method: "update_contract_uri",
      args: [nativeToScVal(data.uri, { type: "string" })],
    }),
  },

  /* ── Security ────────────────────────────────────────────────── */

  pause: {
    label: "Pause",
    resolve: () => ({ method: "pause", args: [] }),
    preflight: "none",
    successToast: {
      title: "Token paused",
      message:
        "All token operations are now halted. Call unpause to resume.",
    },
  },

  unpause: {
    label: "Unpause",
    resolve: () => ({ method: "unpause", args: [] }),
    preflight: "none",
    successToast: {
      title: "Token unpaused",
      message: "All token operations have been resumed.",
    },
  },

  freeze: {
    label: "Freeze account",
    resolve: (data) => ({
      method: "freeze_account",
      args: [addressToScVal(data.address)],
    }),
    successToast: {
      title: "Account frozen",
      message:
        "The account can no longer send or burn tokens. It can still receive them.",
    },
  },

  unfreeze: {
    label: "Unfreeze account",
    resolve: (data) => ({
      method: "unfreeze_account",
      args: [addressToScVal(data.address)],
    }),
    successToast: {
      title: "Account unfrozen",
      message: "The account can send and burn tokens again.",
    },
  },

  /* ── Danger ──────────────────────────────────────────────────── */

  upgrade: {
    label: "Upgrade contract",
    resolve: (data) => ({
      method: "upgrade",
      args: [xdr.ScVal.scvBytes(Buffer.from(data.wasmHash, "hex"))],
    }),
    preflight: "none",
    successToast: {
      title: "Contract upgraded",
      message:
        "The contract WASM has been replaced. All holders are now on the new logic.",
    },
  },
};
