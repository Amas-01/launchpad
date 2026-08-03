import * as z from "zod";

/**
 * Validation schemas for every admin form.
 *
 * These lived inline at the top of `AdminPanel.tsx`. They are shared by the
 * card components and by `adminActions.ts`, so they get their own module.
 */

const stellarAddress = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address");

const contractAddress = z
  .string()
  .regex(/^C[A-Z2-7]{55}$/, "Invalid contract address (must start with C)");

const positiveAmount = z
  .string()
  .refine(
    (val) => !isNaN(Number(val)) && Number(val) > 0,
    "Amount must be positive",
  );

export const mintSchema = z.object({
  to: stellarAddress,
  amount: positiveAmount,
});

export const burnSchema = z.object({
  from: stellarAddress,
  amount: positiveAmount,
});

export const transferAdminSchema = z.object({
  newAdmin: stellarAddress,
});

export const vestingSchema = z.object({
  vestingContract: contractAddress,
  recipient: stellarAddress,
  amount: positiveAmount,
  cliffDays: z
    .string()
    .refine(
      (val) => !isNaN(Number(val)) && Number(val) >= 0,
      "Days must be 0 or more",
    ),
  durationDays: z
    .string()
    .refine(
      (val) => !isNaN(Number(val)) && Number(val) > 0,
      "Duration must be positive",
    ),
});

// Manage an existing vesting schedule (extend cliff / revoke). The schedule
// index is optional — empty means the contract's default (first) schedule.
export const manageVestingSchema = z.object({
  vestingContract: contractAddress,
  recipient: stellarAddress,
  scheduleIndex: z
    .string()
    .refine(
      (val) =>
        val === "" || (Number.isInteger(Number(val)) && Number(val) >= 0),
      "Index must be a whole number ≥ 0",
    ),
  // Only required for "Extend Cliff"; validated in the card so "Revoke" can
  // submit with this left blank.
  newCliffDays: z
    .string()
    .refine(
      (val) => val === "" || (!isNaN(Number(val)) && Number(val) > 0),
      "Cliff extension must be positive",
    ),
});

export const metadataUriSchema = z.object({
  uri: z.string().url("Must be a valid URL").min(1, "URI is required"),
});

export const upgradeSchema = z.object({
  wasmHash: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "Must be a 64-character hex string (32-byte WASM hash)",
    ),
  confirmSymbol: z.string().min(1, "Type the token symbol to confirm"),
});

export const vestingUpgradeSchema = z.object({
  vestingContract: contractAddress,
  wasmHash: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "Must be a 64-character hex string (32-byte WASM hash)",
    ),
  confirmSymbol: z.string().min(1, "Type the symbol to confirm"),
});

export const whaleCapSchema = z.object({
  cap: z
    .string()
    .refine((val) => {
      const num = Number(val);
      return !isNaN(num) && Number.isInteger(num) && num >= 1 && num <= 100;
    }, "Cap must be an integer between 1 and 100"),
});

export const complianceNodeSchema = z.object({
  address: contractAddress,
});

/** Freeze, unfreeze, and is_frozen all take a single account address. */
export const accountSchema = z.object({
  address: stellarAddress,
});

export type MintData = z.infer<typeof mintSchema>;
export type BurnData = z.infer<typeof burnSchema>;
export type TransferAdminData = z.infer<typeof transferAdminSchema>;
export type VestingData = z.infer<typeof vestingSchema>;
export type ManageVestingData = z.infer<typeof manageVestingSchema>;
export type MetadataUriData = z.infer<typeof metadataUriSchema>;
export type UpgradeData = z.infer<typeof upgradeSchema>;
export type VestingUpgradeData = z.infer<typeof vestingUpgradeSchema>;
export type WhaleCapData = z.infer<typeof whaleCapSchema>;
export type ComplianceNodeData = z.infer<typeof complianceNodeSchema>;
export type AccountData = z.infer<typeof accountSchema>;

/** Actions that take no form input (accept-admin, pause, clear-node, …). */
export type EmptyData = Record<string, never>;
