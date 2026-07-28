"use client";

import React from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * The inline "are you sure?" panel that every destructive admin action opens
 * in place, rather than a modal overlay. Six copies of this markup were spread
 * through `AdminPanel`; they only ever differed by accent, copy, and one
 * optional extra field.
 */

export type ConfirmAccent = "red" | "yellow" | "stellar" | "purple";

const ACCENTS: Record<
  ConfirmAccent,
  { wrap: string; heading: string; confirm: string }
> = {
  red: {
    wrap: "bg-red-950/20 border-red-500/20",
    heading: "text-red-400",
    confirm: "bg-red-600 hover:bg-red-700 shadow-red-600/20",
  },
  yellow: {
    wrap: "bg-yellow-950/20 border-yellow-500/20",
    heading: "text-yellow-400",
    confirm: "bg-yellow-600 hover:bg-yellow-700 shadow-yellow-600/20",
  },
  stellar: {
    wrap: "bg-stellar-950/20 border-stellar-500/20",
    heading: "text-stellar-400",
    confirm: "bg-stellar-500 hover:bg-stellar-600 shadow-stellar-500/20",
  },
  purple: {
    wrap: "bg-purple-950/30 border-purple-500/30",
    heading: "text-purple-400",
    confirm: "bg-purple-700 hover:bg-purple-600 shadow-purple-600/20",
  },
};

export interface ConfirmPanelProps {
  title: string;
  /** What the operator is agreeing to. Keep it concrete. */
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  accent?: ConfirmAccent;
  isLoading?: boolean;
  /** Blocks confirm while a typed phrase or similar gate is unmet. */
  confirmDisabled?: boolean;
  /** Extra input rendered between the message and the buttons. */
  children?: React.ReactNode;
  /** Show a success state on the confirm button instead of its label. */
  succeeded?: boolean;
  successLabel?: string;
}

export function ConfirmPanel({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  accent = "red",
  isLoading = false,
  confirmDisabled = false,
  children,
  succeeded = false,
  successLabel = "Done",
}: ConfirmPanelProps) {
  const styles = ACCENTS[accent];

  return (
    <div
      role="group"
      aria-label={title}
      className={`space-y-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-300 p-4 rounded-xl border ${styles.wrap}`}
    >
      <p
        className={`text-[10px] font-bold uppercase tracking-widest text-center ${styles.heading}`}
      >
        {title}
      </p>
      <p className="text-xs text-stellar-200 text-center leading-relaxed">
        {message}
      </p>
      {children}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="flex-1 text-xs py-2 h-9"
          onClick={onCancel}
          disabled={isLoading}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className={`flex-1 text-xs py-2 h-9 border-none shadow-lg ${styles.confirm}`}
          onClick={onConfirm}
          isLoading={isLoading}
          disabled={confirmDisabled || isLoading}
        >
          {succeeded ? (
            <ActionSuccess label={successLabel} />
          ) : (
            confirmLabel
          )}
        </Button>
      </div>
    </div>
  );
}

/** Checkmark + label shown on a button after its action succeeds. */
export function ActionSuccess({ label = "Success" }: { label?: string }) {
  return (
    <span className="flex items-center gap-2">
      <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {label}
    </span>
  );
}
