import { rpc, Address, xdr } from "@stellar/stellar-sdk";
import { addressToScVal, i128ToScVal, nativeToScVal, daysToLedgers } from "@/lib/soroban";
import { Client as TokenClient } from "@/lib/bindings/token/src/index";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { Client as VestingClient } from "@/lib/bindings/vesting/src/index";
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
  VestingUpgradeData,
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
  tokenClient: TokenClient;
  getVestingClient: (vestingContractId: string) => VestingClient;
}

/** The concrete contract call an action resolves to. */
export type ResolvedCall = AssembledTransaction<any>;

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
  authorize: AccountData;
  "revoke-auth": AccountData;
  revoke: EmptyData;
  upgrade: UpgradeData;
  "vesting-upgrade": VestingUpgradeData;
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
  return daysToLedgers(days, sequence);
}

type AdminActionRegistry = {
  [K in AdminActionKey]: AdminActionDef<AdminActionData[K]>;
};

export const ADMIN_ACTIONS: AdminActionRegistry = {
  /* ── Supply ──────────────────────────────────────────────────── */

  mint: {
    label: "Mint",
    resolve: async (data, ctx) => ctx.tokenClient.mint({
      to: data.to,
      amount: scaleAmount(data.amount, ctx.decimals)
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
    resolve: async (data, ctx) => ctx.tokenClient.mint_batch({
      to: data.entries.map((e) => e.address),
      amounts: data.entries.map((e) => scaleAmount(e.amount, ctx.decimals))
    }),
    preflight: "none",
  },

  clawback: {
    label: "Clawback",
    resolve: async (data, ctx) => ctx.tokenClient.clawback({
      from: data.from,
      amount: scaleAmount(data.amount, ctx.decimals)
    }),
  },

  "burn-admin": {
    label: "Burn (admin)",
    resolve: async (data, ctx) => ctx.tokenClient.burn_admin({
      from: data.from,
      amount: scaleAmount(data.amount, ctx.decimals)
    }),
  },

  /* ── Admin lifecycle ─────────────────────────────────────────── */

  transfer: {
    label: "Propose admin",
    resolve: async (data, ctx) => ctx.tokenClient.propose_admin({
      new_admin: data.newAdmin
    }),
  },

  "cancel-admin": {
    label: "Cancel admin transfer",
    resolve: () => ({
      method: "cancel_admin_proposal",
      args: [],
    }),
  },

  "accept-admin": {
    label: "Accept admin",
    resolve: async (data, ctx) => ctx.tokenClient.accept_admin(),
  },

  revoke: {
    label: "Revoke admin",
    resolve: async (data, ctx) => ctx.tokenClient.revoke_admin(),
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
      const endLedger = daysToLedgers(data.durationDays, cliffLedger);

      return ctx.getVestingClient(data.vestingContract).create_schedule({
        recipient: data.recipient,
        total_amount: scaleAmount(data.amount, ctx.decimals),
        cliff_ledger: cliffLedger,
        end_ledger: endLedger
      });
    },
    preflight: async (data, ctx) => {
      const cliffLedger = await ledgerInDays(ctx.server, data.cliffDays);
      const endLedger = daysToLedgers(data.durationDays, cliffLedger);
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
    resolve: async (data, ctx) => {
      const newCliffLedger = await ledgerInDays(ctx.server, data.newCliffDays);
      return ctx.getVestingClient(data.vestingContract).extend_cliff({
        recipient: data.recipient,
        new_cliff: newCliffLedger,
        index: data.scheduleIndex === "" ? undefined : Number(data.scheduleIndex)
      });
    },
  },

  "vesting-revoke": {
    label: "Revoke schedule",
    resolve: async (data, ctx) => ctx.getVestingClient(data.vestingContract).revoke({
      recipient: data.recipient,
      index: data.scheduleIndex === "" ? undefined : Number(data.scheduleIndex)
    }),
  },

  /* ── Policy ──────────────────────────────────────────────────── */

  "set-whale-cap": {
    label: "Set whale protection cap",
    resolve: async (data, ctx) => ctx.tokenClient.set_max_balance_per_account({
      max_balance_per_account: Number(data.cap)
    }),
  },

  "disable-whale-cap": {
    label: "Disable whale protection",
    resolve: async (data, ctx) => ctx.tokenClient.set_max_balance_per_account({
      max_balance_per_account: undefined
    }),
  },

  "set-compliance-node": {
    label: "Set compliance node",
    resolve: async (data, ctx) => ctx.tokenClient.set_compliance_node({
      node: data.address
    }),
  },

  "clear-compliance-node": {
    label: "Clear compliance node",
    resolve: async (data, ctx) => ctx.tokenClient.set_compliance_node({
      node: undefined
    }),
  },

  "metadata-uri": {
    label: "Update metadata URI",
    resolve: async (data, ctx) => ctx.tokenClient.update_contract_uri({
      uri: data.uri
    }),
  },

  /* ── Security ────────────────────────────────────────────────── */

  pause: {
    label: "Pause",
    resolve: async (data, ctx) => ctx.tokenClient.pause(),
    preflight: "none",
    successToast: {
      title: "Token paused",
      message:
        "All token operations are now halted. Call unpause to resume.",
    },
  },

  unpause: {
    label: "Unpause",
    resolve: async (data, ctx) => ctx.tokenClient.unpause(),
    preflight: "none",
    successToast: {
      title: "Token unpaused",
      message: "All token operations have been resumed.",
    },
  },

  freeze: {
    label: "Freeze account",
    resolve: async (data, ctx) => ctx.tokenClient.freeze_account({
      addr: data.address
    }),
    successToast: {
      title: "Account frozen",
      message:
        "The account can no longer send or burn tokens. It can still receive them.",
    },
  },

  unfreeze: {
    label: "Unfreeze account",
    resolve: async (data, ctx) => ctx.tokenClient.unfreeze_account({
      addr: data.address
    }),
    successToast: {
      title: "Account unfrozen",
      message: "The account can send and burn tokens again.",
    },
  },

  /* ── Authorization ───────────────────────────────────────────── */

  authorize: {
    label: "Authorize holder",
    resolve: async (data, ctx) => ctx.tokenClient.authorize_holder({
      holder: data.address
    }),
    successToast: {
      title: "Holder authorized",
      message: "The account can now receive and hold this token.",
    },
  },

  "revoke-auth": {
    label: "Revoke authorization",
    resolve: async (data, ctx) => ctx.tokenClient.revoke_authorization({
      holder: data.address
    }),
    successToast: {
      title: "Authorization revoked",
      message:
        "The account can no longer receive this token. Its existing balance is unaffected.",
    },
  },

  /* ── Danger ──────────────────────────────────────────────────── */

   upgrade: {
    label: "Upgrade contract",
    resolve: async (data, ctx) => ctx.tokenClient.upgrade({
      new_wasm_hash: Buffer.from(data.wasmHash, "hex")
    }),
    preflight: "none",
    successToast: {
      title: "Contract upgraded",
      message:
        "The contract WASM has been replaced. All holders are now on the new logic.",
    },
  },

  "vesting-upgrade": {
    label: "Upgrade vesting contract",
    resolve: (data) => ({
      contractId: data.vestingContract,
      method: "upgrade",
      args: [xdr.ScVal.scvBytes(Buffer.from(data.wasmHash, "hex"))],
    }),
    preflight: "none",
    successToast: {
      title: "Vesting contract upgraded",
      message:
        "The vesting contract WASM has been replaced. All vesting schedules are now on the new logic.",
    },
  },
};
