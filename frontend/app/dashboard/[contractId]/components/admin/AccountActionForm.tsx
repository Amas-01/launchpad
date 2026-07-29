"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { addressToScVal } from "@/lib/soroban";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { UseAdminActionResult } from "../../hooks/useAdminAction";
import type { AdminActionKey } from "./adminActions";
import { ConfirmPanel, type ConfirmAccent } from "./ConfirmPanel";
import { accountSchema, type AccountData } from "./schemas";

/**
 * Address input plus a grant/revoke pair and a read-only status probe.
 *
 * Per-account freeze and holder authorization are the same shape: one
 * address, one action that restricts it, one that lifts the restriction, and
 * a getter so the admin can tell which state an address is already in without
 * sending a transaction.
 */

/** The registry keys that operate on a single account address. */
type AccountActionKey = Extract<
  AdminActionKey,
  "freeze" | "unfreeze" | "authorize" | "revoke-auth"
>;

export interface AccountActionSpec {
  /** Key in the admin action registry. */
  action: AccountActionKey;
  label: string;
  /** Shown while the transaction is in flight and after it succeeds. */
  successLabel: string;
  variant?: "primary" | "secondary";
  className?: string;
  /** When set, the button opens an inline confirmation first. */
  confirm?: {
    title: string;
    message: React.ReactNode;
    confirmLabel: string;
    accent?: ConfirmAccent;
  };
  /** Disable with an explanation, e.g. a non-revocable token. */
  disabledReason?: string;
}

/** How to describe the value a status getter returned. */
export interface CheckResultCopy {
  tone: "positive" | "negative";
  text: string;
}

export function AccountActionForm({
  admin,
  disabled,
  actions,
  checkMethod,
  describeCheck,
  addressLabel = "Account Address",
  checkLabel = "Check status",
  onCompleted,
}: {
  admin: UseAdminActionResult;
  disabled: boolean;
  actions: AccountActionSpec[];
  /** Read-only contract getter, e.g. `is_frozen` or `is_authorized`. */
  checkMethod: string;
  describeCheck: (value: boolean) => CheckResultCopy;
  addressLabel?: string;
  checkLabel?: string;
  /** Called after any action succeeds, so the parent can refresh. */
  onCompleted?: () => void;
}) {
  const form = useForm<AccountData>({ resolver: zodResolver(accountSchema) });
  const [pendingConfirm, setPendingConfirm] = useState<AccountActionSpec | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{
    address: string;
    value: boolean | null;
  } | null>(null);

  const runAction = async (spec: AccountActionSpec) => {
    const data = form.getValues();
    if (await admin.run(spec.action, data)) {
      form.reset();
      setPendingConfirm(null);
      setChecked(null);
      onCompleted?.();
    }
  };

  /** Validate the address, then either confirm or run immediately. */
  const startAction = (spec: AccountActionSpec) =>
    form.handleSubmit(() => {
      if (spec.confirm) {
        setPendingConfirm(spec);
      } else {
        runAction(spec);
      }
    })();

  const onCheck = form.handleSubmit(async ({ address }) => {
    setChecking(true);
    try {
      const value = await admin.read(checkMethod, [addressToScVal(address)]);
      setChecked({
        address,
        value: typeof value === "boolean" ? value : null,
      });
    } finally {
      setChecking(false);
    }
  });

  const result = checked?.value === null ? null : checked;
  const copy = result ? describeCheck(result.value as boolean) : null;

  return (
    <div className="space-y-3">
      <Input
        label={addressLabel}
        placeholder="G..."
        className="bg-white/5 border-white/10"
        {...form.register("address")}
        error={form.formState.errors.address?.message}
        disabled={disabled || !!pendingConfirm}
      />

      {pendingConfirm?.confirm ? (
        <ConfirmPanel
          accent={pendingConfirm.confirm.accent ?? "yellow"}
          title={pendingConfirm.confirm.title}
          message={pendingConfirm.confirm.message}
          confirmLabel={pendingConfirm.confirm.confirmLabel}
          successLabel={pendingConfirm.successLabel}
          succeeded={admin.success === pendingConfirm.action}
          isLoading={admin.loading === pendingConfirm.action}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => runAction(pendingConfirm)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((spec) => (
            <Button
              key={spec.action}
              type="button"
              variant={spec.variant ?? "primary"}
              className={`flex-1 min-w-[7rem] text-xs py-2 h-9 ${spec.className ?? ""}`}
              isLoading={admin.loading === spec.action}
              disabled={disabled || !!spec.disabledReason}
              title={spec.disabledReason}
              aria-describedby={
                spec.disabledReason
                  ? `${spec.action}-disabled-reason`
                  : undefined
              }
              onClick={() => startAction(spec)}
            >
              {admin.success === spec.action ? spec.successLabel : spec.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="secondary"
            className="flex-1 min-w-[7rem] text-xs py-2 h-9"
            isLoading={checking}
            disabled={disabled}
            onClick={onCheck}
          >
            {checkLabel}
          </Button>
        </div>
      )}

      {actions
        .filter((spec) => spec.disabledReason)
        .map((spec) => (
          <p
            key={spec.action}
            id={`${spec.action}-disabled-reason`}
            className="text-[10px] leading-relaxed text-gray-500"
          >
            {spec.label} unavailable — {spec.disabledReason}
          </p>
        ))}

      <div aria-live="polite" className="min-h-[1.25rem]">
        {checked && !result && (
          <p className="text-xs text-gray-400">
            Could not read <code>{checkMethod}</code> — the contract may predate
            this getter.
          </p>
        )}
        {result && copy && (
          <p
            className={`text-xs ${
              copy.tone === "positive" ? "text-green-300" : "text-yellow-300"
            }`}
          >
            <span className="font-mono">
              {result.address.slice(0, 6)}…{result.address.slice(-6)}
            </span>{" "}
            — {copy.text}
          </p>
        )}
      </div>
    </div>
  );
}
