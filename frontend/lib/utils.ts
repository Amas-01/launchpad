/**
 * Utility function for combining classnames
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes
    .filter((c) => c && typeof c === "string")
    .join(" ")
    .trim();
}

/**
 * Converts a display amount to base units based on decimals.
 *
 * This is the single authoritative scaling primitive for all token amount
 * conversions. Do NOT hand-roll `1e7`, `10 ** decimals`, or `parseFloat * N`
 * in app/ or components/ — import this instead.
 */
export function toBaseUnits(display: number | string, decimals: number): bigint {
  const amount = typeof display === "string" ? Number(display) : display;
  if (isNaN(amount)) return 0n;
  return BigInt(Math.round(amount * (10 ** decimals)));
}

/**
 * Converts a raw base-unit bigint back to a human-readable decimal string.
 *
 * This is the single authoritative inverse of `toBaseUnits`. Do NOT hand-roll
 * `Number(amount) / 10 ** decimals` in app/ or components/ — import this instead.
 */
export function fromBaseUnits(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
