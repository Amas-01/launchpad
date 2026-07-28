"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PreflightCheckDisplay } from "@/components/ui/PreflightCheck";
import type { UseAdminActionResult } from "../../hooks/useAdminAction";
import { AdminCard } from "./AdminCard";
import { ConfirmPanel } from "./ConfirmPanel";
import { transferAdminSchema, type TransferAdminData } from "./schemas";

/** String the admin must type to confirm permanent revocation. */
export const REVOKE_CONFIRM_PHRASE = "REVOKE";

/** Two-step admin transfer: propose, accept, or cancel. */
export function TransferAdminCard({
  admin,
  disabled,
  locked,
  pendingAdmin,
  publicKey,
  onPendingAdminChanged,
}: {
  admin: UseAdminActionResult;
  disabled: boolean;
  locked: boolean;
  pendingAdmin: string | null;
  publicKey: string | null;
  onPendingAdminChanged: () => void;
}) {
  const form = useForm<TransferAdminData>({
    resolver: zodResolver(transferAdminSchema),
  });
  const [showConfirm, setShowConfirm] = useState(false);
  const preflight = admin.preflight.transfer;

  // The connected wallet can only accept when it is the named pending admin;
  // the outgoing admin sees a cancel/overwrite path instead.
  const isConnectedPendingAdmin =
    !!pendingAdmin && !!publicKey && pendingAdmin === publicKey;

  const onPropose = async () => {
    if (await admin.run("transfer", form.getValues())) {
      form.reset();
      setShowConfirm(false);
      admin.clearPreflight("transfer");
      onPendingAdminChanged();
    }
  };

  const onAcceptOrCancel = async (action: "accept-admin" | "cancel-admin") => {
    if (await admin.run(action, {})) {
      onPendingAdminChanged();
    }
  };

  return (
    <AdminCard title="Transfer Admin" icon={UserPlus}>
      <form
        onSubmit={form.handleSubmit(() => setShowConfirm(true))}
        className="space-y-4 flex-grow"
      >
        <Input
          label="New Admin Address"
          placeholder="G..."
          className="bg-white/5 border-white/10"
          {...form.register("newAdmin")}
          error={form.formState.errors.newAdmin?.message}
          disabled={showConfirm}
        />
        {preflight && !showConfirm && (
          <PreflightCheckDisplay
            isLoading={admin.isSimulating}
            errors={preflight.errors}
            warnings={preflight.warnings}
            successMessage={
              !preflight.errors?.length && !preflight.warnings?.length
                ? "Transfer admin transaction is ready"
                : undefined
            }
          />
        )}

        {!showConfirm ? (
          <Button
            type="submit"
            className="w-full mt-4 bg-white/5 border-white/10 hover:bg-white/10 text-white"
            disabled={disabled}
          >
            Transfer Control
          </Button>
        ) : (
          <ConfirmPanel
            accent="stellar"
            title="Confirm Proposal"
            message="You are proposing a new admin. They must accept to complete the transfer."
            confirmLabel="Propose Admin"
            isLoading={admin.loading === "transfer"}
            onCancel={() => setShowConfirm(false)}
            onConfirm={onPropose}
          />
        )}
      </form>

      <div className="mt-6 pt-4 border-t border-white/10">
        {!pendingAdmin ? (
          // No two-step transfer in progress — nothing to accept or cancel.
          <p className="text-xs text-gray-500 text-center">
            No admin transfer is currently pending.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-400 text-center">
              Pending admin →{" "}
              <span className="font-mono text-stellar-300">
                {pendingAdmin.slice(0, 6)}…{pendingAdmin.slice(-6)}
              </span>
            </p>
            {isConnectedPendingAdmin ? (
              // Only the named pending admin can finalize the transfer.
              <Button
                type="button"
                className="w-full bg-stellar-600 hover:bg-stellar-700 text-white shadow-lg shadow-stellar-600/20"
                onClick={() => onAcceptOrCancel("accept-admin")}
                isLoading={admin.loading === "accept-admin"}
                disabled={
                  locked || (!!admin.loading && admin.loading !== "accept-admin")
                }
              >
                Accept Admin Role
              </Button>
            ) : (
              // Outgoing admin cancels by overwriting the proposal with self.
              <Button
                type="button"
                variant="secondary"
                className="w-full border-red-500/20 text-red-400 hover:border-red-500/40"
                onClick={() => onAcceptOrCancel("cancel-admin")}
                isLoading={admin.loading === "cancel-admin"}
                disabled={disabled && admin.loading !== "cancel-admin"}
              >
                Cancel Pending Transfer
              </Button>
            )}
          </div>
        )}
      </div>
    </AdminCard>
  );
}

/** Permanently revoke the admin role, making the token immutable. */
export function RevokeAdminCard({
  admin,
  locked,
  onRevoked,
}: {
  admin: UseAdminActionResult;
  locked: boolean;
  onRevoked: () => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [phrase, setPhrase] = useState("");

  const onRevoke = async () => {
    if (phrase.trim() !== REVOKE_CONFIRM_PHRASE) return;
    if (await admin.run("revoke", {})) {
      onRevoked();
      setShowConfirm(false);
      setPhrase("");
    }
  };

  return (
    <AdminCard
      title="Revoke Admin / Lock Token"
      icon={Lock}
      accent="red"
      wide
      description="Permanently make this token immutable. Removes admin and disables minting, burning, freezing, and admin transfer forever."
    >
      {locked ? (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-200">
          <Lock className="h-4 w-4" aria-hidden="true" />
          Admin already revoked — token is locked.
        </div>
      ) : !showConfirm ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full mt-2 border-red-500/20 text-red-400 hover:border-red-500/40"
          disabled={!!admin.loading}
          onClick={() => setShowConfirm(true)}
        >
          Begin revocation
        </Button>
      ) : (
        <ConfirmPanel
          title="Irreversible Action"
          message={
            <>
              Once revoked, no one — including you — can ever mint, burn,
              freeze, or transfer admin again. Type{" "}
              <span className="font-mono font-bold text-red-300">
                {REVOKE_CONFIRM_PHRASE}
              </span>{" "}
              to confirm.
            </>
          }
          confirmLabel="Revoke permanently"
          successLabel="Revoked"
          succeeded={admin.success === "revoke"}
          isLoading={admin.loading === "revoke"}
          confirmDisabled={phrase.trim() !== REVOKE_CONFIRM_PHRASE}
          onCancel={() => {
            setShowConfirm(false);
            setPhrase("");
          }}
          onConfirm={onRevoke}
        >
          <Input
            placeholder={REVOKE_CONFIRM_PHRASE}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            aria-label="Revoke confirmation phrase"
            disabled={admin.loading === "revoke"}
            className="bg-white/5 border-white/10"
          />
        </ConfirmPanel>
      )}
    </AdminCard>
  );
}
