"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The shell every admin card already visually was: glass panel, tinted icon
 * chip, title, optional description, optional header control.
 *
 * Extracting it keeps the accent colours consistent and stops each card from
 * re-deriving the same eight utility classes. Tailwind needs literal class
 * strings, so the accents are a lookup rather than interpolation.
 */

export type AdminCardAccent = "stellar" | "red" | "yellow" | "purple";

const ACCENTS: Record<
  AdminCardAccent,
  { hover: string; text: string; chip: string }
> = {
  stellar: {
    hover: "hover:border-stellar-400/30",
    text: "text-stellar-300",
    chip: "bg-stellar-500/10",
  },
  red: {
    hover: "hover:border-red-500/30",
    text: "text-red-400",
    chip: "bg-red-500/10",
  },
  yellow: {
    hover: "hover:border-yellow-500/30",
    text: "text-yellow-400",
    chip: "bg-yellow-500/10",
  },
  purple: {
    hover: "hover:border-purple-500/30",
    text: "text-purple-400",
    chip: "bg-purple-500/10",
  },
};

export interface AdminCardProps {
  title: string;
  icon: LucideIcon;
  accent?: AdminCardAccent;
  description?: React.ReactNode;
  /** Control rendered opposite the title, e.g. a mode toggle. */
  headerAction?: React.ReactNode;
  /** Span the full grid width instead of one column. */
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function AdminCard({
  title,
  icon: Icon,
  accent = "stellar",
  description,
  headerAction,
  wide = false,
  className = "",
  children,
}: AdminCardProps) {
  const styles = ACCENTS[accent];

  return (
    <section
      aria-label={title}
      className={`glass-card p-6 flex flex-col ${styles.hover} transition-all duration-300 group ${
        wide ? "md:col-span-2" : ""
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className={`flex items-center gap-2 ${styles.text}`}>
          <div
            className={`p-2 ${styles.chip} rounded-lg group-hover:scale-110 transition-transform shrink-0`}
          >
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-bold text-lg">{title}</h3>
            {description && (
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>
        {headerAction}
      </div>
      {children}
    </section>
  );
}

/**
 * Segmented two-way toggle used by the Mint and Supply card headers.
 */
export function ModeToggle<T extends string>({
  value,
  options,
  onChange,
  activeClassName = "bg-stellar-500",
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  activeClassName?: string;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex bg-white/5 p-1 rounded-lg border border-white/10 shrink-0"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`px-3 py-1 text-xs rounded-md transition-all ${
            value === option.value
              ? `${activeClassName} text-white shadow-lg`
              : "text-gray-400 hover:text-white"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
