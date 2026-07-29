"use client";

import React from "react";
import { ShieldCheck } from "lucide-react";
import type { UseAdminActionResult } from "../../hooks/useAdminAction";
import { AccountActionForm } from "./AccountActionForm";
import { AdminCard } from "./AdminCard";

/**
 * Holder authorization, for tokens deployed with `authorization_required`.
 *
 * The deploy wizard has always offered the flag and the dashboard has always
 * displayed it, but nothing in the app could ever call `authorize_holder`. A
 * token deployed with the flag set was therefore bricked from the UI: no
 * holder could receive tokens, and the only way out was the Soroban CLI.
 *
 * The card is rendered only when the flag is on, since the contract short-
 * circuits `is_authorized` to `true` otherwise and the controls would be
 * meaningless.
 */
export function AuthorizationCard({
  admin,
  disabled,
  revocable,
}: {
  admin: UseAdminActionResult;
  disabled: boolean;
  /** `authorization_revocable` — false means authorization is permanent. */
  revocable: boolean;
}) {
  return (
    <AdminCard
      title="Holder Authorization"
      icon={ShieldCheck}
      wide
      description="This token requires holders to be authorized before they can receive it."
    >
      <div className="mb-4 rounded-xl border border-stellar-500/20 bg-stellar-500/5 p-3 text-xs leading-relaxed text-stellar-200/80">
        Until an address is authorized, every transfer and mint to it is
        rejected on-chain. Authorize each holder before sending them tokens.
        {revocable
          ? " This token allows authorization to be revoked later."
          : " This token was deployed with authorization set as non-revocable, so grants are permanent."}
      </div>

      <AccountActionForm
        admin={admin}
        disabled={disabled}
        addressLabel="Holder Address"
        checkMethod="is_authorized"
        checkLabel="Check"
        describeCheck={(authorized) =>
          authorized
            ? { tone: "positive", text: "is authorized to hold this token." }
            : { tone: "negative", text: "is not authorized." }
        }
        actions={[
          {
            action: "authorize",
            label: "Authorize",
            successLabel: "Authorized",
            className:
              "bg-stellar-500 hover:bg-stellar-600 text-white shadow-lg shadow-stellar-500/20",
          },
          {
            action: "revoke-auth",
            label: "Revoke",
            successLabel: "Revoked",
            variant: "secondary",
            className:
              "border-red-500/20 text-red-400 hover:border-red-500/40",
            // The contract asserts on `authorization_revocable`, so a
            // non-revocable token would fail at simulation. Say so up front.
            disabledReason: revocable
              ? undefined
              : "this token was deployed with authorization set as non-revocable.",
            confirm: {
              accent: "red",
              title: "Revoke authorization?",
              message:
                "The holder will no longer be able to receive this token. Their existing balance is unaffected, and they can still transfer it away.",
              confirmLabel: "Confirm Revoke",
            },
          },
        ]}
      />
    </AdminCard>
  );
}
