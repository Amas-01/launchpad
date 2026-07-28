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
 */
export function toBaseUnits(display: number | string, decimals: number): bigint {
  const amount = typeof display === "string" ? Number(display) : display;
  if (isNaN(amount)) return 0n;
  return BigInt(Math.round(amount * (10 ** decimals)));
}
