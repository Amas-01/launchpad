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
  wrapRpcCall,
} from "@/lib/soroban";
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
  Upload,
} from "lucide-react";
import { VestingCurveChart } from "@/components/VestingCurveChart";
import { PreflightCheckDisplay } from "@/components/ui/PreflightCheck";
import type { PreflightCheckResult } from "@/lib/transactionSimulator";

/** String the admin must type to confirm permanent revocation. */
const REVOKE_CONFIRM_PHRASE = "REVOKE";

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

const metadataUriSchema = z.object({
  uri: z
    .string()
    .url("Must be a valid URL")
    .min(1, "URI is required"),
});

const upgradeSchema = z.object({
  wasmHash: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "Must be a 64-character hex string (32-byte WASM hash)"),
  confirmSymbol: z.string().min(1, "Type the token symbol to confirm"),
});

type MintData = z.infer<typeof mintSchema>;
type BurnData = z.infer<typeof burnSchema>;
type TransferAdminData = z.infer<typeof transferAdminSchema>;
type VestingData = z.infer<typeof vestingSchema>;
type MetadataUriData = z.infer<typeof metadataUriSchema>;
type UpgradeData = z.infer<typeof upgradeSchema>;

type AcceptAdminData = Record<string, never>;
type AdminActionData = MintData | BurnData | TransferAdminData | VestingData | MetadataUriData | AcceptAdminData;

/* ── AdminPanel Component ───────────────────────────────────────── */

interface AdminPanelProps {
    contractId: string;
    maxSupply?: string | null;
    totalSupply?: string;
    decimals: number;
    tokenSymbol?: string;
}

export function AdminPanel({ contractId, maxSupply, totalSupply, decimals, tokenSymbol }: AdminPanelProps) {
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

    // Upgrade state
    const [showUpgradeConfirm, setShowUpgradeConfirm] = useState(false);

    const [mintMode, setMintMode] = useState<"single" | "batch">("single");
    const [batchData, setBatchData] = useState("");
    const [batchErrors, setBatchErrors] = useState<string[]>([]);
    const [parsedEntries, setParsedEntries] = useState<BatchMintEntry[]>([]);

    // Forms
    const mintForm = useForm<MintData>({ resolver: zodResolver(mintSchema) });
    const burnForm = useForm<BurnData>({ resolver: zodResolver(burnSchema) });
    const transferForm = useForm<TransferAdminData>({ resolver: zodResolver(transferAdminSchema) });
    const vestingForm = useForm<VestingData>({ resolver: zodResolver(vestingSchema) });
    const metadataUriForm = useForm<MetadataUriData>({ resolver: zodResolver(metadataUriSchema) });
    const upgradeForm = useForm<UpgradeData>({ resolver: zodResolver(upgradeSchema) });

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

    useEffect(() => {
        refreshLocked();
    }, [refreshLocked]);

    useEffect(() => {
        refreshPaused();
    }, [refreshPaused]);

    const submitSignedTransaction = useCallback(
        async (signedXdr: string) => {
            const server = new rpc.Server(networkConfig.rpcUrl);
            const signedTx = TransactionBuilder.fromXDR(
                signedXdr,
                networkConfig.passphrase,
            );
            const send = await server.sendTransaction(
                signedTx as Parameters<typeof server.sendTransaction>[0],
            );
            if (send.status === "ERROR") {
                throw new Error(
                    `Submit failed: ${send.errorResult?.toXDR("base64") ?? "unknown"}`,
                );
            }

            let response = await server.getTransaction(send.hash);
            let attempts = 0;
            while (response.status === "NOT_FOUND" && attempts < 30) {
                await new Promise((r) => setTimeout(r, 1000));
                response = await server.getTransaction(send.hash);
                attempts += 1;
            }

            if (response.status === "FAILED") {
                throw new Error("Transaction failed on-chain");
            }

            return send.hash;
        },
        [networkConfig.passphrase, networkConfig.rpcUrl],
    );

    const handleBatchMint = async (entries: BatchMintEntry[]) => {
        if (!publicKey) return;

        if (entries.length > 50) {
            toast.show({
                title: "Batch too large",
                message: `Maximum batch size is 50 recipients. You have ${entries.length}.`,
                variant: "error",
            });
            return;
        }

        setLoading("batch-mint");
        setSuccess(null);
        setLastTxHash(null);
        const statusLabel = "Batch mint";

        try {
            const server = new rpc.Server(networkConfig.rpcUrl);
            const account = await server.getAccount(publicKey);
            const contract = new Contract(contractId);

            // Prepare ScVals for the new mint_batch function
            const addressesScVal = nativeToScVal(entries.map(e => new Address(e.address)), { type: "vec" });
            const amountsScVal = nativeToScVal(entries.map(e => BigInt(Math.round(parseFloat(e.amount) * 10 ** decimals))), { type: "vec" });

            const tx = new TransactionBuilder(account, {
                fee: "1000",
                networkPassphrase: networkConfig.passphrase
            })
                .addOperation(contract.call("mint_batch", addressesScVal, amountsScVal))
                .setTimeout(30)
                .build();

            const xdrEncoded = tx.toXDR();

            let signedXdr: string;
            try {
                signedXdr = await signTransaction(xdrEncoded, { networkPassphrase: networkConfig.passphrase });
            } catch (signError) {
                setAnnouncement(`${statusLabel} signing failed.`);
                throw signError;
            }

            const txHash = await submitSignedTransaction(signedXdr);
            setLastTxHash(txHash);
            setSuccess("batch-mint");
            setAnnouncement(`${statusLabel} transaction submitted successfully. Transaction hash ${txHash}.`);

        } catch (err) {
            const error = err as Error;
            console.error(`batch-mint failed:`, error);
            setAnnouncement(`${statusLabel} transaction failed.`);
            toast.show({
                title: `${statusLabel} failed`,
                message: error.message,
                variant: "error",
            });
        } finally {
            setLoading(null);
        }
    };

    const simulator = useTransactionSimulator();
    const [mintPreflight, setMintPreflight] = useState<PreflightCheckResult | null>(null);
    const [burnPreflight, setBurnPreflight] = useState<PreflightCheckResult | null>(null);
    const [transferPreflight, setTransferPreflight] = useState<PreflightCheckResult | null>(null);
    const [vestingPreflight, setVestingPreflight] = useState<PreflightCheckResult | null>(null);

    const handleAction = async (action: string, data: AdminActionData) => {
        if (!publicKey) return;

        setLoading(action);
        setSuccess(null);
        setLastTxHash(null);

        const statusLabel =
            action === "mint"
                ? "Mint"
                : action === "clawback"
                  ? "Clawback"
                  : action === "transfer"
                    ? "Propose admin"
                    : action === "accept-admin"
                      ? "Accept admin"
                      : action === "metadata-uri"
                        ? "Update metadata URI"
                        : "Vesting";

        try {
            const server = new rpc.Server(networkConfig.rpcUrl);

            let method = "";
            let args: xdr.ScVal[] = [];
            let targetContractId = contractId;
            let simulationResult: PreflightCheckResult | null = null;

            if (action === "mint") {
                const mintData = data as MintData;
                method = "mint";
                const scaledAmount =
                    BigInt(Math.round(parseFloat(mintData.amount) * 10 ** decimals));
                args = [addressToScVal(mintData.to), i128ToScVal(scaledAmount)];

                simulationResult = await simulator.checkMint(
                    contractId,
                    mintData.to,
                    scaledAmount,
                    publicKey,
                );
                setMintPreflight(simulationResult);
            } else if (action === "clawback") {
                const burnData = data as BurnData;
                method = "clawback";
                const scaledAmount =
                    BigInt(Math.round(parseFloat(burnData.amount) * 10 ** decimals));
                args = [addressToScVal(burnData.from), i128ToScVal(scaledAmount)];

                simulationResult = await simulator.simulateContract(
                    contractId,
                    method,
                    args,
                    publicKey,
                );
                setBurnPreflight(simulationResult);
            } else if (action === "transfer") {
                const transferData = data as TransferAdminData;
                method = "propose_admin";
                args = [addressToScVal(transferData.newAdmin)];

                simulationResult = await simulator.simulateContract(
                    contractId,
                    method,
                    args,
                    publicKey,
                );
                setTransferPreflight(simulationResult);
            } else if (action === "accept-admin") {
                method = "accept_admin";
                args = [];
                simulationResult = await simulator.simulateContract(
                    contractId,
                    method,
                    args,
                    publicKey,
                );
            } else if (action === "vesting") {
                const vestingData = data as VestingData;
                method = "create_schedule";
                targetContractId = vestingData.vestingContract;

                const currentLedgerRes = await server.getLatestLedger();
                const currentLedger = currentLedgerRes.sequence;

                const cliffLedgers = Math.round(Number(vestingData.cliffDays) * 17280);
                const durationLedgers = Math.round(Number(vestingData.durationDays) * 17280);

                const cliffLedger = currentLedger + cliffLedgers;
                const endLedger = cliffLedger + durationLedgers;

                const scaledAmount =
                    BigInt(Math.round(parseFloat(vestingData.amount) * 10 ** decimals));

                args = [
                    addressToScVal(vestingData.recipient),
                    i128ToScVal(scaledAmount),
                    nativeToScVal(cliffLedger, { type: "u32" }),
                    nativeToScVal(endLedger, { type: "u32" }),
                ];

                simulationResult = await simulator.checkCreateSchedule(
                    vestingData.vestingContract,
                    vestingData.recipient,
                    scaledAmount,
                    cliffLedger,
                    endLedger,
                    publicKey,
                );
                setVestingPreflight(simulationResult);
            } else if (action === "metadata-uri") {
                const metadataData = data as MetadataUriData;
                method = "update_contract_uri";
                args = [nativeToScVal(metadataData.uri, { type: "string" })];

                simulationResult = await simulator.simulateContract(
                    contractId,
                    method,
                    args,
                    publicKey,
                );
            } else {
                throw new Error("Unsupported action");
            }

            if (simulationResult?.errors?.length) {
                toast.show({
                    title: `${statusLabel} simulation failed`,
                    message: simulationResult.errors[0],
                    variant: "error",
                });
                return;
            }

            const account = await server.getAccount(publicKey);
            const contract = new Contract(targetContractId);

            const tx = new TransactionBuilder(account, {
                fee: "1000",
                networkPassphrase: networkConfig.passphrase,
            })
                .addOperation(contract.call(method, ...args))
                .setTimeout(30)
                .build();

            const sim = await server.simulateTransaction(tx);
            if (rpc.Api.isSimulationError(sim)) {
                throw new Error(`Simulation failed: ${sim.error}`);
            }
            const prepared = rpc.assembleTransaction(tx, sim).build();

            const signedXdr = await signTransaction(prepared.toXDR(), {
                networkPassphrase: networkConfig.passphrase,
            });

            const txHash = await submitSignedTransaction(signedXdr);
            setLastTxHash(txHash);
            setSuccess(action);
            setAnnouncement(
                `${statusLabel} transaction submitted successfully. Transaction hash ${txHash}.`,
            );

            if (action === "mint") {
                mintForm.reset();
                setMintPreflight(null);
            }
            if (action === "clawback") {
                burnForm.reset();
                setBurnPreflight(null);
            }
            if (action === "transfer") {
                transferForm.reset();
                setShowTransferConfirm(false);
                setTransferPreflight(null);
            }
            if (action === "metadata-uri") {
                metadataUriForm.reset();
            }
            if (action === "vesting") {
                vestingForm.reset();
                setVestingPreflight(null);
            }
        } catch (err) {
            const error = err as Error;
            console.error(`${action} failed:`, error);
            setAnnouncement(`${statusLabel} transaction failed.`);
            toast.show({
                title: `${statusLabel} failed`,
                message: error.message,
                variant: "error",
            });
        } finally {
            setLoading(null);
        }
    };

  /* ── Revoke admin / lock token ─────────────────────────────────── */
  const handleRevokeAdmin = async () => {
    if (!publicKey) return;
    if (revokePhrase.trim() !== REVOKE_CONFIRM_PHRASE) return;

    setLoading("revoke");
    try {
      const txHash = await wrapRpcCall(
        async () => {
          const server = new rpc.Server(networkConfig.rpcUrl);
          const account = await server.getAccount(publicKey);
          const contract = new Contract(contractId);

          const built = new TransactionBuilder(account, {
            fee: "1000",
            networkPassphrase: networkConfig.passphrase,
          })
            .addOperation(contract.call("revoke_admin"))
            .setTimeout(60)
            .build();

          const sim = await server.simulateTransaction(built);
          if (rpc.Api.isSimulationError(sim)) {
            throw new Error(`Simulation failed: ${sim.error}`);
          }
          const prepared = rpc.assembleTransaction(built, sim).build();

          const signedXdr = await signTransaction(prepared.toXDR(), {
            networkPassphrase: networkConfig.passphrase,
          });
          const signedTx = TransactionBuilder.fromXDR(
            signedXdr,
            networkConfig.passphrase,
          );
          const send = await server.sendTransaction(
            signedTx as Parameters<typeof server.sendTransaction>[0],
          );
          if (send.status === "ERROR") {
            throw new Error(
              `Submit failed: ${send.errorResult?.toXDR("base64") ?? "unknown"}`,
            );
          }

          let response = await server.getTransaction(send.hash);
          let attempts = 0;
          while (response.status === "NOT_FOUND" && attempts < 30) {
            await new Promise((r) => setTimeout(r, 1000));
            response = await server.getTransaction(send.hash);
            attempts += 1;
          }
          if (response.status === "FAILED") {
            throw new Error("Revoke transaction failed on-chain");
          }
          return send.hash;
        },
        { operation: "Revoke admin", toastTitle: "Revoke failed" },
      );

      setLastTxHash(txHash);
      setSuccess("revoke");
      setLocked(true);
      setShowRevokeConfirm(false);
      setRevokePhrase("");
      toast.show({
        title: "Admin revoked",
        message:
          "The token contract is now locked. Admin operations can no longer be performed.",
        variant: "success",
        duration: 8_000,
      });
    } catch {
      // Toast already surfaced via wrapRpcCall.
    } finally {
      setLoading(null);
    }
  };

  const handlePauseToggle = async () => {
    if (!publicKey) return;

    const action = paused ? "unpause" : "pause";
    setLoading(action);
    setSuccess(null);
    try {
      const txHash = await wrapRpcCall(
        async () => {
          const server = new rpc.Server(networkConfig.rpcUrl);
          const account = await server.getAccount(publicKey);
          const contract = new Contract(contractId);

          const built = new TransactionBuilder(account, {
            fee: "1000",
            networkPassphrase: networkConfig.passphrase,
          })
            .addOperation(contract.call(action))
            .setTimeout(30)
            .build();

          const sim = await server.simulateTransaction(built);
          if (rpc.Api.isSimulationError(sim)) {
            throw new Error(`Simulation failed: ${sim.error}`);
          }
          const prepared = rpc.assembleTransaction(built, sim).build();

          const signedXdr = await signTransaction(prepared.toXDR(), {
            networkPassphrase: networkConfig.passphrase,
          });

          return await submitSignedTransaction(signedXdr);
        },
        { operation: paused ? "Unpause" : "Pause", toastTitle: paused ? "Unpause failed" : "Pause failed" },
      );

      setLastTxHash(txHash);
      setSuccess(action);
      setPaused(!paused);
      setShowPauseConfirm(false);
      toast.show({
        title: paused ? "Token unpaused" : "Token paused",
        message: paused
          ? "All token operations have been resumed."
          : "All token operations are now halted. Call unpause to resume.",
        variant: "success",
        duration: 8_000,
      });
    } catch {
      // Toast already surfaced via wrapRpcCall
    } finally {
      setLoading(null);
    }
  };

  const handleUpgrade = async (data: UpgradeData) => {
    if (!publicKey) return;

    const expectedSymbol = (tokenSymbol ?? "").toUpperCase();
    if (data.confirmSymbol.trim().toUpperCase() !== expectedSymbol) {
      upgradeForm.setError("confirmSymbol", {
        message: `Type "${expectedSymbol}" exactly to confirm.`,
      });
      return;
    }

    setLoading("upgrade");
    setSuccess(null);
    try {
      const txHash = await wrapRpcCall(
        async () => {
          const server = new rpc.Server(networkConfig.rpcUrl);
          const account = await server.getAccount(publicKey);
          const contract = new Contract(contractId);

          // Convert the 64-char hex string to a BytesN<32> ScVal
          const hashBytes = Buffer.from(data.wasmHash, "hex");
          const { xdr: xdrLib } = await import("@stellar/stellar-sdk");
          const hashScVal = xdrLib.ScVal.scvBytes(hashBytes);

          const built = new TransactionBuilder(account, {
            fee: "1000",
            networkPassphrase: networkConfig.passphrase,
          })
            .addOperation(contract.call("upgrade", hashScVal))
            .setTimeout(30)
            .build();

          const sim = await server.simulateTransaction(built);
          if (rpc.Api.isSimulationError(sim)) {
            throw new Error(`Simulation failed: ${sim.error}`);
          }
          const prepared = rpc.assembleTransaction(built, sim).build();

          const signedXdr = await signTransaction(prepared.toXDR(), {
            networkPassphrase: networkConfig.passphrase,
          });

          return await submitSignedTransaction(signedXdr);
        },
        { operation: "Upgrade contract", toastTitle: "Upgrade failed" },
      );

      setLastTxHash(txHash);
      setSuccess("upgrade");
      setShowUpgradeConfirm(false);
      upgradeForm.reset();
      setAnnouncement(`Contract upgrade submitted. Transaction hash ${txHash}.`);
      toast.show({
        title: "Contract upgraded",
        message: "The contract WASM has been replaced. All holders are now on the new logic.",
        variant: "success",
        duration: 8_000,
      });
    } catch {
      // Toast already surfaced via wrapRpcCall.
    } finally {
      setLoading(null);
    }
  };

  const adminDisabled = !!loading || locked;

  return (
    <section className="mt-12 w-full max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-700">
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </p>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-6 h-6 text-stellar-400" />
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Admin Console
          </h2>
        </div>
        {lastTxHash && (
          <a
            href={`https://stellar.expert/explorer/${networkConfig.network}/tx/${lastTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-stellar-400 hover:text-stellar-300 transition-colors bg-stellar-400/10 px-3 py-1.5 rounded-full border border-stellar-400/20"
          >
            Last Tx: {lastTxHash.slice(0, 8)}...{" "}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {locked && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-yellow-400" />
          <div className="text-sm">
            <p className="font-semibold text-yellow-200">
              Admin permanently revoked
            </p>
            <p className="mt-1 text-xs leading-relaxed text-yellow-100/80">
              This token contract is now immutable. Mint, burn, freeze, and
              admin-transfer operations are permanently disabled. Holders can
              still transfer and self-burn their tokens.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">
        {/* ── Mint Form ─────────────────────────────────────── */}
        {(!maxSupply ||
          maxSupply === "N/A" ||
          (totalSupply &&
            totalSupply !== "N/A" &&
            parseFloat(totalSupply.replace(/,/g, "")) <
              parseFloat(maxSupply.replace(/,/g, "")))) && (
          <div className="glass-card p-6 flex flex-col hover:border-stellar-500/30 transition-all duration-300 group">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2 text-stellar-300">
                <div className="p-2 bg-stellar-500/10 rounded-lg group-hover:scale-110 transition-transform">
                  <Coins className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-lg">Mint Assets</h3>
              </div>
              <div className="flex bg-white/5 p-1 rounded-lg border border-white/10">
                <button
                  onClick={() => setMintMode("single")}
                  className={`px-3 py-1 text-xs rounded-md transition-all ${mintMode === "single" ? "bg-stellar-500 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                >
                  Single
                </button>
                <button
                  onClick={() => setMintMode("batch")}
                  className={`px-3 py-1 text-xs rounded-md transition-all ${mintMode === "batch" ? "bg-stellar-500 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}
                >
                  Batch
                </button>
              </div>
            </div>

            {mintMode === "single" ? (
              <form
                onSubmit={mintForm.handleSubmit((data) =>
                  handleAction("mint", data),
                )}
                className="space-y-4 flex-grow"
              >
                <Input
                  label="Recipient Address"
                  placeholder="G..."
                  className="bg-white/5 border-white/10"
                  {...mintForm.register("to")}
                  error={mintForm.formState.errors.to?.message}
                />
                <Input
                  label="Amount"
                  type="number"
                  placeholder="0.00"
                  className="bg-white/5 border-white/10"
                  {...mintForm.register("amount")}
                  error={mintForm.formState.errors.amount?.message}
                />
                {mintPreflight && (
                  <PreflightCheckDisplay
                    isLoading={simulator.isLoading}
                    errors={mintPreflight.errors}
                    warnings={mintPreflight.warnings}
                    successMessage={
                      !mintPreflight.errors?.length &&
                      !mintPreflight.warnings?.length
                        ? "Mint transaction is ready"
                        : undefined
                    }
                  />
                )}
                <Button
                  type="submit"
                  className="w-full mt-4 shadow-lg shadow-stellar-500/20"
                  isLoading={loading === "mint"}
                  disabled={adminDisabled}
                >
                  {success === "mint" ? (
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> Success
                    </span>
                  ) : (
                    "Mint Tokens"
                  )}
                </Button>
              </form>
            ) : (
              <div className="space-y-4 flex-grow">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-300">
                    Manual Entry (Address, Amount)
                  </label>
                  <textarea
                    className="w-full h-32 bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-stellar-100 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-stellar-500/50 resize-none"
                    placeholder="GC7... , 100.0&#10;GD2... , 50.5"
                    value={batchData}
                    onChange={(e) => {
                      setBatchData(e.target.value);
                      const { entries, errors } = parseBatchMintData(
                        e.target.value,
                      );
                      setParsedEntries(entries);
                      setBatchErrors(errors);
                    }}
                  />
                </div>

                <div className="relative">
                  <div
                    className="absolute inset-0 flex items-center"
                    aria-hidden="true"
                  >
                    <div className="w-full border-t border-white/5"></div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-2 bg-transparent text-[10px] uppercase tracking-widest text-gray-500">
                      Or Upload CSV
                    </span>
                  </div>
                </div>

                <input
                  type="file"
                  accept=".csv"
                  className="block w-full text-xs text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-stellar-500/10 file:text-stellar-400 hover:file:bg-stellar-500/20 transition-all cursor-pointer"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const { entries, errors } =
                        await parseBatchMintFile(file);
                      setParsedEntries(entries);
                      setBatchErrors(errors);
                    }
                  }}
                />

                {batchErrors.length > 0 && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <p className="text-[10px] text-red-400 font-bold uppercase mb-1">
                      Errors Found:
                    </p>
                    <ul className="text-[10px] text-red-300 space-y-1 list-disc list-inside">
                      {batchErrors.slice(0, 3).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                      {batchErrors.length > 3 && (
                        <li>...and {batchErrors.length - 3} more</li>
                      )}
                    </ul>
                  </div>
                )}

                {parsedEntries.length > 0 && batchErrors.length === 0 && (
                  <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center justify-between">
                    <span className="text-xs text-green-400 font-medium">
                      {parsedEntries.length} valid entries ready
                    </span>
                    <span className="text-[10px] text-green-500/70">
                      Total:{" "}
                      {parsedEntries
                        .reduce((acc, curr) => acc + Number(curr.amount), 0)
                        .toLocaleString()}
                    </span>
                  </div>
                )}

                <Button
                  type="button"
                  className="w-full mt-2 shadow-lg shadow-stellar-500/20"
                  isLoading={loading === "batch-mint"}
                  disabled={
                    adminDisabled ||
                    parsedEntries.length === 0 ||
                    batchErrors.length > 0
                  }
                  onClick={() => handleBatchMint(parsedEntries)}
                >
                  {success === "batch-mint" ? (
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> Batch Minted!
                    </span>
                  ) : (
                    `Mint Batch (${parsedEntries.length})`
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Burn Form ─────────────────────────────────────── */}
        <div className="glass-card p-6 flex flex-col hover:border-red-500/30 transition-all duration-300 group">
          <div className="flex items-center gap-2 mb-6 text-red-400">
            <div className="p-2 bg-red-500/10 rounded-lg group-hover:scale-110 transition-transform">
              <Flame className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg">Clawback Assets</h3>
          </div>
          <form
            onSubmit={burnForm.handleSubmit((data) =>
              handleAction("clawback", data),
            )}
            className="space-y-4 flex-grow"
          >
            <Input
              label="Source Address"
              placeholder="G..."
              className="bg-white/5 border-white/10"
              {...burnForm.register("from")}
              error={burnForm.formState.errors.from?.message}
            />
            <Input
              label="Amount"
              type="number"
              placeholder="0.00"
              className="bg-white/5 border-white/10"
              {...burnForm.register("amount")}
              error={burnForm.formState.errors.amount?.message}
            />
            {burnPreflight && (
              <PreflightCheckDisplay
                isLoading={simulator.isLoading}
                errors={burnPreflight.errors}
                warnings={burnPreflight.warnings}
                successMessage={
                  !burnPreflight.errors?.length &&
                  !burnPreflight.warnings?.length
                    ? "Clawback transaction is ready"
                    : undefined
                }
              />
            )}
            <Button
              type="submit"
              variant="secondary"
              className="w-full mt-4 border-red-500/20 hover:border-red-500/40 text-red-400"
              isLoading={loading === "clawback"}
              disabled={adminDisabled}
            >
              {success === "clawback" ? (
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Success
                </span>
              ) : (
                "Clawback Tokens"
              )}
            </Button>
          </form>
        </div>

        {/* ── Vesting Schedule ────────────────────────────────── */}
        <div className="glass-card p-6 flex flex-col hover:border-stellar-400/30 transition-all duration-300 group lg:col-span-1">
          <div className="flex items-center gap-2 mb-6 text-stellar-300">
            <div className="p-2 bg-stellar-500/10 rounded-lg group-hover:scale-110 transition-transform">
              <Clock className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg">Create Vesting</h3>
          </div>
          <form
            onSubmit={vestingForm.handleSubmit((data) =>
              handleAction("vesting", data),
            )}
            className="space-y-4 flex-grow"
          >
            <Input
              label="Vesting Contract"
              placeholder="C..."
              className="bg-white/5 border-white/10"
              {...vestingForm.register("vestingContract")}
              error={vestingForm.formState.errors.vestingContract?.message}
            />
            <Input
              label="Recipient Address"
              placeholder="G..."
              className="bg-white/5 border-white/10"
              {...vestingForm.register("recipient")}
              error={vestingForm.formState.errors.recipient?.message}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Cliff (Days)"
                type="number"
                placeholder="0"
                className="bg-white/5 border-white/10"
                {...vestingForm.register("cliffDays")}
                error={vestingForm.formState.errors.cliffDays?.message}
              />
              <Input
                label="Duration (Days)"
                type="number"
                placeholder="365"
                className="bg-white/5 border-white/10"
                {...vestingForm.register("durationDays")}
                error={vestingForm.formState.errors.durationDays?.message}
              />
            </div>
            {chartDurationDays > 0 && (
              <VestingCurveChart
                cliffDays={chartCliffDays}
                durationDays={chartDurationDays}
              />
            )}
            <Input
              label="Total Amount"
              type="number"
              placeholder="0.00"
              className="bg-white/5 border-white/10"
              {...vestingForm.register("amount")}
              error={vestingForm.formState.errors.amount?.message}
            />
            {vestingPreflight && (
              <PreflightCheckDisplay
                isLoading={simulator.isLoading}
                errors={vestingPreflight.errors}
                warnings={vestingPreflight.warnings}
                successMessage={
                  !vestingPreflight.errors?.length &&
                  !vestingPreflight.warnings?.length
                    ? "Vesting schedule is ready"
                    : undefined
                }
              />
            )}
            <Button
              type="submit"
              className="w-full mt-4 bg-stellar-500 hover:bg-stellar-600 text-white shadow-lg shadow-stellar-500/20"
              isLoading={loading === "vesting"}
              disabled={adminDisabled}
            >
              {success === "vesting" ? (
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Success
                </span>
              ) : (
                "Initialize Schedule"
              )}
            </Button>
          </form>
        </div>

        {/* ── Transfer Admin ────────────────────────────────── */}
        <div className="glass-card p-6 flex flex-col hover:border-stellar-400/30 transition-all duration-300 group">
          <div className="flex items-center gap-2 mb-6 text-stellar-400">
            <div className="p-2 bg-stellar-400/10 rounded-lg group-hover:scale-110 transition-transform">
              <UserPlus className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg">Transfer Admin</h3>
          </div>
          <form
            onSubmit={transferForm.handleSubmit(() =>
              setShowTransferConfirm(true),
            )}
            className="space-y-4 flex-grow"
          >
            <Input
              label="New Admin Address"
              placeholder="G..."
              className="bg-white/5 border-white/10"
              {...transferForm.register("newAdmin")}
              error={transferForm.formState.errors.newAdmin?.message}
              disabled={showTransferConfirm}
            />
            {transferPreflight && !showTransferConfirm && (
              <PreflightCheckDisplay
                isLoading={simulator.isLoading}
                errors={transferPreflight.errors}
                warnings={transferPreflight.warnings}
                successMessage={
                  !transferPreflight.errors?.length &&
                  !transferPreflight.warnings?.length
                    ? "Transfer admin transaction is ready"
                    : undefined
                }
              />
            )}

            {!showTransferConfirm ? (
              <Button
                type="submit"
                className="w-full mt-4 bg-white/5 border-white/10 hover:bg-white/10 text-white"
                disabled={adminDisabled}
              >
                Transfer Control
              </Button>
            ) : (
              <div className="space-y-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-300 bg-stellar-950/20 p-4 rounded-xl border border-stellar-500/20">
                <p className="text-[10px] text-stellar-400 font-bold uppercase tracking-widest text-center">
                  Confirm Proposal
                </p>
                <p className="text-xs text-stellar-200 text-center leading-relaxed">
                  You are proposing a new admin. They must accept to complete the transfer.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1 text-xs py-2 h-9"
                    onClick={() => setShowTransferConfirm(false)}
                    disabled={adminDisabled}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="flex-1 text-xs py-2 h-9 bg-stellar-500 hover:bg-stellar-600 border-none shadow-lg shadow-stellar-500/20"
                    onClick={() =>
                      handleAction("transfer", transferForm.getValues())
                    }
                    isLoading={loading === "transfer"}
                  >
                    Propose Admin
                  </Button>
                </div>
              </div>
            )}
          </form>
          <div className="mt-6 pt-4 border-t border-white/10">
            <p className="text-xs text-gray-400 mb-3 text-center">
              Are you the pending admin? Click below to accept the role.
            </p>
            <Button
              type="button"
              className="w-full bg-stellar-600 hover:bg-stellar-700 text-white shadow-lg shadow-stellar-600/20"
              onClick={() => handleAction("accept-admin", {} as AcceptAdminData)}
              isLoading={loading === "accept-admin"}
              disabled={adminDisabled && loading !== "accept-admin"}
            >
              Accept Admin Role
            </Button>
          </div>
        </div>

        {/* ── Revoke Admin / Lock Token ────────────────────────── */}
        <div className="glass-card p-6 flex flex-col hover:border-red-500/30 transition-all duration-300 group md:col-span-2">
          <div className="flex items-center gap-2 mb-4 text-red-400">
            <div className="p-2 bg-red-500/10 rounded-lg group-hover:scale-110 transition-transform">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Revoke Admin / Lock Token</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Permanently make this token immutable. Removes admin and
                disables minting, burning, freezing, and admin transfer forever.
              </p>
            </div>
          </div>

          {locked ? (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-200">
              <Lock className="h-4 w-4" />
              Admin already revoked — token is locked.
            </div>
          ) : !showRevokeConfirm ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full mt-2 border-red-500/20 text-red-400 hover:border-red-500/40"
              disabled={!!loading}
              onClick={() => setShowRevokeConfirm(true)}
            >
              Begin revocation
            </Button>
          ) : (
            <div className="space-y-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-300 bg-red-950/20 p-4 rounded-xl border border-red-500/20">
              <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest text-center">
                Irreversible Action
              </p>
              <p className="text-xs text-stellar-200 text-center leading-relaxed">
                Once revoked, no one — including you — can ever mint, burn,
                freeze, or transfer admin again. Type{" "}
                <span className="font-mono font-bold text-red-300">
                  {REVOKE_CONFIRM_PHRASE}
                </span>{" "}
                to confirm.
              </p>
              <Input
                placeholder={REVOKE_CONFIRM_PHRASE}
                value={revokePhrase}
                onChange={(e) => setRevokePhrase(e.target.value)}
                aria-label="Revoke confirmation phrase"
                disabled={loading === "revoke"}
                className="bg-white/5 border-white/10"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1 text-xs py-2 h-9"
                  onClick={() => {
                    setShowRevokeConfirm(false);
                    setRevokePhrase("");
                  }}
                  disabled={loading === "revoke"}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="flex-1 text-xs py-2 h-9 bg-red-600 hover:bg-red-700 border-none shadow-lg shadow-red-600/20"
                  onClick={handleRevokeAdmin}
                  isLoading={loading === "revoke"}
                  disabled={
                    revokePhrase.trim() !== REVOKE_CONFIRM_PHRASE ||
                    loading === "revoke"
                  }
                >
                  {success === "revoke" ? (
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> Revoked
                    </span>
                  ) : (
                    "Revoke permanently"
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Update Metadata URI ──────────────────────────────── */}
        <div className="glass-card p-6 flex flex-col hover:border-stellar-500/30 transition-all duration-300 group">
          <div className="flex items-center gap-2 mb-6 text-stellar-300">
            <div className="p-2 bg-stellar-500/10 rounded-lg group-hover:scale-110 transition-transform">
              <ExternalLink className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Metadata URI</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Set or update the URI pointing to off-chain token metadata (logo, description, etc.)
              </p>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAction("metadata-uri", metadataUriForm.getValues());
            }}
            className="flex flex-col gap-4"
          >
            <Input
              {...metadataUriForm.register("uri")}
              type="url"
              placeholder="https://example.com/token-metadata.json"
              error={metadataUriForm.formState.errors.uri?.message}
              disabled={adminDisabled}
            />
            <Button
              type="submit"
              className="w-full bg-white/5 border-white/10 hover:bg-white/10 text-white"
              disabled={adminDisabled || loading === "metadata-uri"}
              isLoading={loading === "metadata-uri"}
            >
              Update URI
            </Button>
          </form>
        </div>

        {/* ── Pause / Unpause ───────────────────────────────── */}
        <div className="glass-card p-6 flex flex-col hover:border-yellow-500/30 transition-all duration-300 group">
          <div className="flex items-center gap-2 mb-4 text-yellow-400">
            <div className="p-2 bg-yellow-500/10 rounded-lg group-hover:scale-110 transition-transform">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Circuit Breaker</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Pause or unpause all token operations in an emergency.
              </p>
            </div>
          </div>

          {paused ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Token is paused — mint, burn, transfer, and clawback are halted.
              </div>
              <Button
                type="button"
                className="w-full bg-green-600 hover:bg-green-700 border-none shadow-lg shadow-green-600/20"
                onClick={handlePauseToggle}
                isLoading={loading === "unpause"}
                disabled={adminDisabled || locked}
              >
                {success === "unpause" ? (
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Unpaused
                  </span>
                ) : (
                  "Unpause Token"
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm text-green-200">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Token is active — all operations are running normally.
              </div>

              {!showPauseConfirm ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full border-yellow-500/20 text-yellow-400 hover:border-yellow-500/40"
                  disabled={adminDisabled || locked || !!loading}
                  onClick={() => setShowPauseConfirm(true)}
                >
                  Pause Token
                </Button>
              ) : (
                <div className="space-y-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-300 bg-yellow-950/20 p-4 rounded-xl border border-yellow-500/20">
                  <p className="text-[10px] text-yellow-400 font-bold uppercase tracking-widest text-center">
                    Pause token?
                  </p>
                  <p className="text-xs text-stellar-200 text-center leading-relaxed">
                    This will halt all mint, burn, transfer, and clawback operations
                    until unpaused. Only token holders can still self-burn.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="flex-1 text-xs py-2 h-9"
                      onClick={() => setShowPauseConfirm(false)}
                      disabled={loading === "pause"}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      className="flex-1 text-xs py-2 h-9 bg-yellow-600 hover:bg-yellow-700 border-none shadow-lg shadow-yellow-600/20"
                      onClick={handlePauseToggle}
                      isLoading={loading === "pause"}
                    >
                      {success === "pause" ? (
                        <span className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4" /> Paused
                        </span>
                      ) : (
                        "Confirm Pause"
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Advanced / Danger: Upgrade Contract ──────────────── */}
      <div className="mt-2 w-full">
        <div className="flex items-center gap-2 mb-3 px-1">
          <div className="flex-1 border-t border-white/5" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-600">
            Advanced / Danger
          </span>
          <div className="flex-1 border-t border-white/5" />
        </div>

        <div className="glass-card p-6 flex flex-col hover:border-purple-500/30 transition-all duration-300 group border border-purple-500/10 bg-purple-950/5">
          <div className="flex items-center gap-2 mb-4 text-purple-400">
            <div className="p-2 bg-purple-500/10 rounded-lg group-hover:scale-110 transition-transform">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Upgrade Contract</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Replace the contract WASM with a new version. Affects all holders immediately.
              </p>
            </div>
          </div>

          {locked ? (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-200">
              <Lock className="h-4 w-4 shrink-0" />
              Contract is locked — upgrades are permanently disabled.
            </div>
          ) : (
            <>
              <div className="mb-4 rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 text-xs leading-relaxed text-purple-200/80">
                <strong className="text-purple-300">Before upgrading:</strong> ensure the new WASM has been
                reviewed and audited. This replaces contract logic for every token holder and cannot be
                undone unless the new contract itself supports a further upgrade.
              </div>

              <form
                onSubmit={upgradeForm.handleSubmit((data) => {
                  if (!showUpgradeConfirm) {
                    setShowUpgradeConfirm(true);
                  } else {
                    handleUpgrade(data);
                  }
                })}
                className="flex flex-col gap-4"
              >
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-300">
                    New WASM Hash{" "}
                    <span className="text-gray-500">(64 hex characters)</span>
                  </label>
                  <input
                    {...upgradeForm.register("wasmHash")}
                    placeholder="a1b2c3d4e5f6… (64 hex chars)"
                    disabled={adminDisabled}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-40"
                    spellCheck={false}
                    autoComplete="off"
                    maxLength={64}
                  />
                  {upgradeForm.formState.errors.wasmHash && (
                    <p className="mt-1 text-xs text-red-400">
                      {upgradeForm.formState.errors.wasmHash.message}
                    </p>
                  )}
                </div>

                {showUpgradeConfirm && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-2 rounded-xl border border-purple-500/30 bg-purple-950/30 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-purple-400 text-center">
                      Confirm upgrade
                    </p>
                    <p className="text-xs text-center text-gray-300 leading-relaxed">
                      Type the token symbol{" "}
                      <span className="font-mono font-bold text-purple-300">
                        {tokenSymbol ?? "SYMBOL"}
                      </span>{" "}
                      to confirm you understand this is irreversible.
                    </p>
                    <input
                      {...upgradeForm.register("confirmSymbol")}
                      placeholder={tokenSymbol ?? "SYMBOL"}
                      disabled={loading === "upgrade"}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-40"
                      autoComplete="off"
                    />
                    {upgradeForm.formState.errors.confirmSymbol && (
                      <p className="text-xs text-red-400">
                        {upgradeForm.formState.errors.confirmSymbol.message}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  {showUpgradeConfirm && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowUpgradeConfirm(false);
                        upgradeForm.clearErrors("confirmSymbol");
                      }}
                      className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-40"
                      disabled={loading === "upgrade"}
                    >
                      Cancel
                    </button>
                  )}
                  <Button
                    type="submit"
                    className={`${showUpgradeConfirm ? "flex-1" : "w-full"} bg-purple-700 hover:bg-purple-600 border-none shadow-lg shadow-purple-600/20`}
                    isLoading={loading === "upgrade"}
                    disabled={adminDisabled}
                  >
                    {success === "upgrade" ? (
                      <span className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" /> Upgraded
                      </span>
                    ) : showUpgradeConfirm ? (
                      "Confirm Upgrade"
                    ) : (
                      <span className="flex items-center gap-2">
                        <Upload className="w-4 h-4" /> Upgrade Contract
                      </span>
                    )}
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
