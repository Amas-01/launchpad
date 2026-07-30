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
import { VestingUpgradeCard } from "./admin/VestingUpgradeCard";
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
        {admin.lastTxHash && (
          <a
            href={`https://stellar.expert/explorer/${networkConfig.network}/tx/${admin.lastTxHash}`}
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
        {canStillMint(maxSupply, totalSupply) && (
          <MintCard admin={admin} disabled={disabled} />
        )}

        <SupplyCard admin={admin} disabled={disabled} />

        <VestingCard admin={admin} disabled={disabled} />
        <ManageVestingCard admin={admin} disabled={disabled} />
        <VestingUpgradeCard admin={admin} disabled={disabled} locked={state.locked} />

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
