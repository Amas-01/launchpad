"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useWallet } from "../../../hooks/useWallet";
import { useNetwork } from "../../../providers/NetworkProvider";
import { useToast } from "../../../providers/ToastProvider";
import { useTransactionSimulator } from "@/hooks/useTransactionSimulator";
import {
  addressToScVal,
  i128ToScVal,
  nativeToScVal,
  scValToNative,
  wrapRpcCall,
} from "@/lib/soroban";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import {
  parseBatchMintData,
  parseBatchMintFile,
  BatchMintEntry,
} from "@/lib/batch";
import {
  TransactionBuilder,
  rpc,
  Contract,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import {
  Coins,
  Flame,
  UserPlus,
  ShieldAlert,
  CheckCircle2,
  ExternalLink,
  Clock,
  Lock,
  AlertTriangle,
  Percent,
  CircleAlert,
} from "lucide-react";
import { VestingCurveChart } from "@/components/VestingCurveChart";
import { PreflightCheckDisplay } from "@/components/ui/PreflightCheck";
import type { PreflightCheckResult } from "@/lib/transactionSimulator";

/** String the admin must type to confirm permanent revocation. */
const REVOKE_CONFIRM_PHRASE = "REVOKE";

/**
 * Encode an optional vesting schedule index as Soroban `Option<u32>`.
 * Soroban represents `None` as a Void ScVal and `Some(n)` as the inner value.
 */
function indexToScVal(scheduleIndex: string): xdr.ScVal {
  return scheduleIndex === ""
    ? xdr.ScVal.scvVoid()
    : nativeToScVal(Number(scheduleIndex), { type: "u32" });
}

/* ── Validation Schemas ────────────────────────────────────────── */

const mintSchema = z.object({
  to: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address"),
  amount: z
    .string()
    .refine(
      (val) => !isNaN(Number(val)) && Number(val) > 0,
      "Amount must be positive",
    ),
});

const burnSchema = z.object({
  from: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address"),
  amount: z
    .string()
    .refine(
      (val) => !isNaN(Number(val)) && Number(val) > 0,
      "Amount must be positive",
    ),
});

const transferAdminSchema = z.object({
  newAdmin: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address"),
});

const vestingSchema = z.object({
  vestingContract: z
    .string()
    .regex(/^C[A-Z2-7]{55}$/, "Invalid contract address (must start with C)"),
  recipient: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address"),
  amount: z
    .string()
    .refine(
      (val) => !isNaN(Number(val)) && Number(val) > 0,
      "Amount must be positive",
    ),
  cliffDays: z
    .string()
    .refine(
      (val) => !isNaN(Number(val)) && Number(val) >= 0,
      "Days must be 0 or more",
    ),
  durationDays: z
    .string()
    .refine(
      (val) => !isNaN(Number(val)) && Number(val) > 0,
      "Duration must be positive",
    ),
});

// Manage an existing vesting schedule (extend cliff / revoke). The schedule
// index is optional — empty means the contract's default (first) schedule.
const manageVestingSchema = z.object({
  vestingContract: z
    .string()
    .regex(/^C[A-Z2-7]{55}$/, "Invalid contract address (must start with C)"),
  recipient: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address"),
  scheduleIndex: z
    .string()
    .refine(
      (val) =>
        val === "" || (Number.isInteger(Number(val)) && Number(val) >= 0),
      "Index must be a whole number ≥ 0",
    ),
  // Only required for "Extend Cliff"; validated in the handler so "Revoke"
  // can submit with this left blank.
  newCliffDays: z
    .string()
    .refine(
      (val) => val === "" || (!isNaN(Number(val)) && Number(val) > 0),
      "Cliff extension must be positive",
    ),
});

const metadataUriSchema = z.object({
  uri: z
    .string()
    .url("Must be a valid URL")
    .min(1, "URI is required"),
});

type MintData = z.infer<typeof mintSchema>;
type BurnData = z.infer<typeof burnSchema>;
type TransferAdminData = z.infer<typeof transferAdminSchema>;
type VestingData = z.infer<typeof vestingSchema>;
type ManageVestingData = z.infer<typeof manageVestingSchema>;
type MetadataUriData = z.infer<typeof metadataUriSchema>;

const whaleCapSchema = z.object({
  cap: z
    .string()
    .refine(
      (val) => {
        const num = Number(val);
        return !isNaN(num) && Number.isInteger(num) && num >= 1 && num <= 100;
      },
      "Cap must be an integer between 1 and 100",
    ),
});

const complianceNodeSchema = z.object({
  address: z.string().regex(/^C[A-Z2-7]{55}$/, "Invalid contract address (must start with C)"),
});

type WhaleCapData = z.infer<typeof whaleCapSchema>;
type ComplianceNodeData = z.infer<typeof complianceNodeSchema>;
type DisableWhaleCapData = Record<string, never>;
type ClearComplianceNodeData = Record<string, never>;

type AcceptAdminData = Record<string, never>;
type AdminActionData =
  | MintData
  | BurnData
  | TransferAdminData
  | VestingData
  | ManageVestingData
  | MetadataUriData
  | AcceptAdminData
  | WhaleCapData
  | ComplianceNodeData
  | DisableWhaleCapData
  | ClearComplianceNodeData;

/* ── AdminPanel Component ───────────────────────────────────────── */

interface AdminPanelProps {
    contractId: string;
    maxSupply?: string | null;
    totalSupply?: string;
    decimals: number;
}

export function AdminPanel({ contractId, maxSupply, totalSupply, decimals }: AdminPanelProps) {
    const { signTransaction, publicKey } = useWallet();
    const { networkConfig } = useNetwork();
    const toast = useToast();
    const [loading, setLoading] = useState<string | null>(null);
    const [lastTxHash, setLastTxHash] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState("");
    const [showTransferConfirm, setShowTransferConfirm] = useState(false);
    const [locked, setLocked] = useState(false);
    const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
    const [revokePhrase, setRevokePhrase] = useState("");
    const [paused, setPaused] = useState(false);
    const [showPauseConfirm, setShowPauseConfirm] = useState(false);
    const [whaleCap, setWhaleCap] = useState<number | null>(null);
    const [complianceNode, setComplianceNode] = useState<string | null>(null);
    const [pendingAdmin, setPendingAdmin] = useState<string | null>(null);

    // Clawback card supports two admin-initiated removals that share one form:
    //   "clawback" → confiscate tokens into the admin balance (reversible)
    //   "burn"     → permanently destroy tokens, reducing supply (irreversible)
    const [burnMode, setBurnMode] = useState<"clawback" | "burn">("clawback");

    const [mintMode, setMintMode] = useState<"single" | "batch">("single");
    const [batchData, setBatchData] = useState("");
    const [batchErrors, setBatchErrors] = useState<string[]>([]);
    const [parsedEntries, setParsedEntries] = useState<BatchMintEntry[]>([]);

    // Forms
    const mintForm = useForm<MintData>({ resolver: zodResolver(mintSchema) });
    const burnForm = useForm<BurnData>({ resolver: zodResolver(burnSchema) });
    const transferForm = useForm<TransferAdminData>({ resolver: zodResolver(transferAdminSchema) });
    const vestingForm = useForm<VestingData>({ resolver: zodResolver(vestingSchema) });
    const manageVestingForm = useForm<ManageVestingData>({ resolver: zodResolver(manageVestingSchema) });
    const metadataUriForm = useForm<MetadataUriData>({ resolver: zodResolver(metadataUriSchema) });
    const whaleForm = useForm<WhaleCapData>({ resolver: zodResolver(whaleCapSchema) });
    const complianceForm = useForm<ComplianceNodeData>({ resolver: zodResolver(complianceNodeSchema) });

    // Revoke is destructive, so it sits behind an explicit confirmation step.
    const [showVestingRevokeConfirm, setShowVestingRevokeConfirm] = useState(false);

    // Live values for the vesting curve preview chart.
    const [watchedCliff, watchedDuration] = vestingForm.watch(["cliffDays", "durationDays"]);
    const chartCliffDays = Math.max(0, Number(watchedCliff) || 0);
    const chartDurationDays = Math.max(0, Number(watchedDuration) || 0);

    /* ── Lock state: simulate is_locked() so we can disable admin ops. ── */
    const refreshLocked = useCallback(async () => {
        try {
            const value = await wrapRpcCall(
                async () => {
                    const server = new rpc.Server(networkConfig.rpcUrl);
                    const contract = new Contract(contractId);
                    // Use a deterministic dummy account for read-only simulation.
                    const dummy = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
                    const account = new (
                        await import("@stellar/stellar-sdk")
                    ).Account(dummy, "0");
                    const tx = new TransactionBuilder(account, {
                        fee: "100",
                        networkPassphrase: networkConfig.passphrase,
                    })
                        .addOperation(contract.call("is_locked"))
                        .setTimeout(30)
                        .build();
                    const sim = await server.simulateTransaction(tx);
                    if (rpc.Api.isSimulationError(sim)) {
                        // Older deployments without is_locked just stay unlocked.
                        return false;
                    }
                    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return false;
                    return Boolean(sim.result.retval.b());
                },
                { operation: "Check lock state", silent: true },
            );
            setLocked(value);
        } catch {
            // Best effort — if it fails we leave the panel enabled.
        }
    }, [contractId, networkConfig.rpcUrl, networkConfig.passphrase]);

    const refreshPaused = useCallback(async () => {
        try {
            const value = await wrapRpcCall(
                async () => {
                    const server = new rpc.Server(networkConfig.rpcUrl);
                    const contract = new Contract(contractId);
                    const dummy = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
                    const account = new (
                        await import("@stellar/stellar-sdk")
                    ).Account(dummy, "0");
                    const tx = new TransactionBuilder(account, {
                        fee: "100",
                        networkPassphrase: networkConfig.passphrase,
                    })
                        .addOperation(contract.call("is_paused"))
                        .setTimeout(30)
                        .build();
                    const sim = await server.simulateTransaction(tx);
                    if (rpc.Api.isSimulationError(sim)) {
                        return false;
                    }
                    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return false;
                    return Boolean(sim.result.retval.b());
                },
                { operation: "Check pause state", silent: true },
            );
            setPaused(value);
        } catch {
            // Best effort
        }
    }, [contractId, networkConfig.rpcUrl, networkConfig.passphrase]);

    /* ── Pending admin: read pending_admin() to surface two-step transfer. ── */
    const refreshPendingAdmin = useCallback(async () => {
        try {
            const value = await wrapRpcCall(
                async () => {
                    const server = new rpc.Server(networkConfig.rpcUrl);
                    const contract = new Contract(contractId);
                    const dummy = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
                    const account = new (
                        await import("@stellar/stellar-sdk")
                    ).Account(dummy, "0");
                    const tx = new TransactionBuilder(account, {
                        fee: "100",
                        networkPassphrase: networkConfig.passphrase,
                    })
                        .addOperation(contract.call("pending_admin"))
                        .setTimeout(30)
                        .build();
                    const sim = await server.simulateTransaction(tx);
                    if (rpc.Api.isSimulationError(sim)) {
                        // Older deployments without pending_admin: treat as none.
                        return null;
                    }
                    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return null;
                    // Option<Address> decodes to the strkey string, or null for None.
                    const decoded = scValToNative(sim.result.retval);
                    return typeof decoded === "string" ? decoded : null;
                },
                { operation: "Check pending admin", silent: true },
            );
            setPendingAdmin(value);
        } catch {
            // Best effort — leave pending state unknown on failure.
        }
    }, [contractId, networkConfig.rpcUrl, networkConfig.passphrase]);

    const refreshWhaleCap = useCallback(async () => {
        try {
            const value = await wrapRpcCall(
                async () => {
                    const server = new rpc.Server(networkConfig.rpcUrl);
                    const contract = new Contract(contractId);
                    const dummy = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
                    const account = new (
                        await import("@stellar/stellar-sdk")
                    ).Account(dummy, "0");
                    const tx = new TransactionBuilder(account, {
                        fee: "100",
                        networkPassphrase: networkConfig.passphrase,
                    })
                        .addOperation(contract.call("max_balance_per_account"))
                        .setTimeout(30)
                        .build();
                    const sim = await server.simulateTransaction(tx);
                    if (rpc.Api.isSimulationError(sim)) {
                        return null;
                    }
                    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return null;
                    const native = scValToNative(sim.result.retval);
                    return typeof native === "number" ? native : null;
                },
                { operation: "Check whale cap state", silent: true },
            );
            setWhaleCap(value);
        } catch {
            // Best effort
        }
    }, [contractId, networkConfig.rpcUrl, networkConfig.passphrase]);

    const refreshComplianceNode = useCallback(async () => {
        try {
            const value = await wrapRpcCall(
                async () => {
                    const server = new rpc.Server(networkConfig.rpcUrl);
                    const contract = new Contract(contractId);
                    const dummy = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
                    const account = new (
                        await import("@stellar/stellar-sdk")
                    ).Account(dummy, "0");
                    const tx = new TransactionBuilder(account, {
                        fee: "100",
                        networkPassphrase: networkConfig.passphrase,
                    })
                        .addOperation(contract.call("compliance_node"))
                        .setTimeout(30)
                        .build();
                    const sim = await server.simulateTransaction(tx);
                    if (rpc.Api.isSimulationError(sim)) {
                        return null;
                    }
                    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return null;

                    const native = scValToNative(sim.result.retval);
                    if (native && typeof native === "object" && "toString" in native) {
                        return native.toString();
                    }
                    return typeof native === "string" ? native : null;
                },
                { operation: "Check compliance node state", silent: true },
            );
            setComplianceNode(value);
        } catch {
            // Best effort
        }
    }, [contractId, networkConfig.rpcUrl, networkConfig.passphrase]);

    useEffect(() => {
        refreshLocked();
    }, [refreshLocked]);

    useEffect(() => {
        refreshPaused();
    }, [refreshPaused]);

    useEffect(() => {
        refreshPendingAdmin();
    }, [refreshPendingAdmin]);

    useEffect(() => {
        refreshWhaleCap();
    }, [refreshWhaleCap]);

    useEffect(() => {
        refreshComplianceNode();
    }, [refreshComplianceNode]);

    const submitSignedTransaction = useCallback(
        async (signedXdr: