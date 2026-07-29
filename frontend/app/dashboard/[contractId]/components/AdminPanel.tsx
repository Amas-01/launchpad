"use client";

import React from "react";
import {
  ShieldAlert,
  ExternalLink,
  Lock,
  UserPlus,
  CircleAlert,
} from "lucide-react";
import { useWallet } from "../../../hooks/useWallet";
import { useNetwork } from "../../../providers/NetworkProvider";
import { useAdminAction } from "../hooks/useAdminAction";
import { useTokenAdminState } from "../hooks/useTokenAdminState";
import { MintCard } from "./admin/MintCard";
import { SupplyCard } from "./admin/SupplyCard";
import { VestingCard } from "./admin/VestingCard";
import { ManageVestingCard } from "./admin/ManageVestingCard";
import {
  TransferAdminCard,
  RevokeAdminCard,
} from "./admin/AdminLifecycleCard";
import { PolicyCard } from "./admin/PolicyCard";
import { MetadataCard } from "./admin/MetadataCard";
import { SecurityCard } from "./admin/SecurityCard";
import { AuthorizationCard } from "./admin/AuthorizationCard";
import { DangerCard } from "./admin/DangerCard";

/**
 * Admin console.
 *
 * This file used to be a 2,351-line monolith holding every admin capability,
 * a 14-branch dispatcher, a second parallel branch chain for success handling,
 * and eleven separately constructed RPC clients. It is now an orchestrator: it
 * owns the shared transaction pipeline (`useAdminAction`) and the on-chain
 * state reads (`useTokenAdminState`), renders the banners, and lays out the
 * cards. Each capability lives in its own file under `components/admin/`.
 */

interface AdminPanelProps {
  contractId: string;
  maxSupply?: string | null;
  totalSupply?: string;
  decimals: number;
  tokenSymbol?: string;
  /**
   * `authorization_required` / `authorization_revocable`, read once as part of
   * TokenInfo. The Authorization card only appears when the flag is on.
   */
  authorizationRequired?: boolean;
  authorizationRevocable?: boolean;
  /** Re-read holders' frozen state after a freeze/unfreeze. */
  onFrozenChanged?: () => void;
}

/**
 * The mint card hides once supply is capped out. `maxSupply` and `totalSupply`
 * arrive as display strings, so they need un-formatting before comparison.
 */
function canStillMint(
  maxSupply?: string | null,
  totalSupply?: string,
): boolean {
  if (!maxSupply || maxSupply === "N/A") return true;
  if (!totalSupply || totalSupply === "N/A") return true;
  const parse = (value: string) => parseFloat(value.replace(/,/g, ""));
  return parse(totalSupply) < parse(maxSupply);
}

export function AdminPanel({
  contractId,
  maxSupply,
  totalSupply,
  decimals,
  tokenSymbol,
  authorizationRequired = false,
  authorizationRevocable = false,
  onFrozenChanged,
}: AdminPanelProps) {
  const { publicKey } = useWallet();
  const { networkConfig } = useNetwork();

  const admin = useAdminAction(contractId, decimals);
  const state = useTokenAdminState(admin.read);

  // Any in-flight action blocks the rest of the console, and a locked contract
  // blocks everything permanently.
  const disabled = !!admin.loading || state.locked;

  return (
    <section className="mt-12 w-full max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-700">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {admin.announcement}
      </p>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-6 h-6 text-stellar-400" aria-hidden="true" />
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
            Last Tx: {admin.lastTxHash.slice(0, 8)}...{" "}
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        )}
      </div>

      {state.paused && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4">
          <CircleAlert
            className="mt-0.5 h-5 w-5 shrink-0 text-orange-400"
            aria-hidden="true"
          />
          <div className="text-sm">
            <p className="font-semibold text-orange-200">Contract is paused</p>
            <p className="mt-1 text-xs leading-relaxed text-orange-100/80">
              All state-changing operations (mint, burn, transfer, clawback) are
              halted. Only the admin can unpause the contract.
            </p>
          </div>
        </div>
      )}

      {state.locked && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <Lock
            className="mt-0.5 h-5 w-5 shrink-0 text-yellow-400"
            aria-hidden="true"
          />
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

      {!state.locked && state.pendingAdmin && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-stellar-500/30 bg-stellar-500/5 p-4">
          <UserPlus
            className="mt-0.5 h-5 w-5 shrink-0 text-stellar-400"
            aria-hidden="true"
          />
          <div className="text-sm">
            <p className="font-semibold text-stellar-200">
              Admin transfer pending
            </p>
            <p className="mt-1 text-xs leading-relaxed text-stellar-100/80">
              A two-step admin transfer is in progress. Pending admin →{" "}
              <span className="font-mono text-stellar-300">
                {state.pendingAdmin.slice(0, 6)}…{state.pendingAdmin.slice(-6)}
              </span>
              .{" "}
              {state.pendingAdmin === publicKey
                ? "Your connected wallet is the pending admin — accept the role below to finalize."
                : "It is not finalized until the pending admin accepts. As the current admin you can cancel or overwrite it below."}
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

        <SupplyCard admin={admin} disabled={disabled} />

        <VestingCard admin={admin} disabled={disabled} />
        <ManageVestingCard admin={admin} disabled={disabled} />

        <TransferAdminCard
          admin={admin}
          disabled={disabled}
          locked={state.locked}
          pendingAdmin={state.pendingAdmin}
          publicKey={publicKey}
          onPendingAdminChanged={state.refreshPendingAdmin}
        />

        <SecurityCard
          admin={admin}
          disabled={disabled}
          locked={state.locked}
          paused={state.paused}
          onPausedChanged={state.setPaused}
          onFrozenChanged={onFrozenChanged}
        />

        <RevokeAdminCard
          admin={admin}
          locked={state.locked}
          onRevoked={state.markLocked}
        />

        {authorizationRequired && (
          <AuthorizationCard
            admin={admin}
            disabled={disabled}
            revocable={authorizationRevocable}
          />
        )}

        <PolicyCard
          admin={admin}
          disabled={disabled}
          whaleCap={state.whaleCap}
          complianceNode={state.complianceNode}
          onWhaleCapChanged={state.refreshWhaleCap}
          onComplianceNodeChanged={state.refreshComplianceNode}
        />

        <MetadataCard admin={admin} disabled={disabled} />
      </div>

      <DangerCard
        admin={admin}
        disabled={disabled}
        locked={state.locked}
        tokenSymbol={tokenSymbol}
      />
    </section>
  );
}
