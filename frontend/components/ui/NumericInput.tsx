"use client";

import React, { useState, useCallback } from "react";

interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  label?: string;
  error?: string;
  value?: number | string;
  onChange?: (raw: string | undefined) => void;
  allowDecimals?: boolean;
}

const format = (val: string): string => {
  if (!val) return "";
  // Split on decimal point
  const [integer, decimal] = val.split(".");
  // Add thousand separators to integer part
  const formatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimal !== undefined ? `${formatted}.${decimal}` : formatted;
};

const toDisplay = (val: number | string | undefined): string => {
  if (val === undefined || val === "") return "";
  const str = String(val);
  return format(str);
};

/**
 * NumericInput formats numbers with thousand separators (e.g. 1,000,000)
 * while stripping leading zeros and commas from the underlying parsed value.
 */
export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  ({ label, error, value, onChange, allowDecimals = true, className = "", ...props }, ref) => {
    const [displayValue, setDisplayValue] = useState<string>(toDisplay(value));

    React.useEffect(() => {
      setDisplayValue((prev) => {
        const prevParsed =
          prev === "" ? undefined : parseFloat(prev.replace(/,/g, ""));
        const newParsed =
          value === "" || value === undefined
            ? undefined
            : typeof value === "string"
            ? parseFloat(value.replace(/,/g, ""))
            : value;

        if (prevParsed !== newParsed) {
          return toDisplay(value);
        }
        return prev;
      });
    }, [value]);
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;

        // Allow only digits, commas, and optionally decimal point
        const allowed = allowDecimals ? /[^0-9.]/g : /[^0-9]/g;
        let stripped = raw.replace(/,/g, "").replace(allowed, "");

        // Prevent multiple decimal points
        const parts = stripped.split(".");
        if (parts.length > 2) stripped = `${parts[0]}.${parts.slice(1).join("")}`;

        // Strip leading zeros (but allow "0." for decimals)
        stripped = stripped.replace(/^0+(?=\d)/, "");

        // Format for display
        setDisplayValue(format(stripped));

        // Preserve the exact integer string for callers.
        const normalized = stripped === "" ? undefined : stripped;
        onChange?.(normalized);
      },
      [allowDecimals, onChange],
    );

    return (
      <div className={`flex flex-col gap-1.5 w-full ${className}`}>
        {label && (
          <label
            htmlFor={props.id || props.name}
            className="text-sm font-medium text-gray-300 ml-1"
          >
            {label}
          </label>
        )}
        <input
          id={props.id || props.name}
          ref={ref}
          type="text"
          inputMode="numeric"
          value={displayValue}
          onChange={handleChange}
          className={`
            bg-void-800/50 border border-stellar-500/10 rounded-xl px-4 py-3
            text-white placeholder:text-gray-500
            focus:outline-none focus:border-stellar-500/40 focus:ring-1 focus:ring-stellar-500/20
            transition-all duration-300
            ${error ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/20" : ""}
          `}
          {...props}
        />
        {error && <span className="text-xs text-red-400 ml-1">{error}</span>}
      </div>
    );
  },
);

NumericInput.displayName = "NumericInput";