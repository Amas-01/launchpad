import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export type DataKey = {tag: "Admin", values: void} | {tag: "PendingAdmin", values: void} | {tag: "Locked", values: void} | {tag: "TokenContract", values: void} | {tag: "IsPaused", values: void} | {tag: "TotalCommitted", values: void} | {tag: "Schedule", values: readonly [string, u32]} | {tag: "ScheduleCount", values: readonly [string]} | {tag: "RecipientCount", values: void} | {tag: "RecipientAt", values: readonly [u32]};


export interface Solvency {
  solvent: boolean;
  token_balance: i128;
  total_committed: i128;
}

/**
 * Typed contract errors for the vesting contract.
 */
export const VestingError = {
  /**
   * `initialize` was called on a contract that is already initialized.
   */
  1: {message:"AlreadyInitialized"},
  /**
   * Operation attempted before `initialize` was called.
   */
  2: {message:"NotInitialized"},
  /**
   * The vesting contract is paused.
   */
  3: {message:"Paused"},
  /**
   * Amount is zero or negative where a positive value is required.
   */
  4: {message:"InvalidAmount"},
  /**
   * `end_ledger` is not strictly after `cliff_ledger`.
   */
  5: {message:"InvalidLedgerRange"},
  /**
   * `accept_admin` was called with no pending proposal.
   */
  6: {message:"NoPendingAdmin"},
  /**
   * Operation attempted on a revoked vesting schedule.
   */
  7: {message:"ScheduleRevoked"},
  /**
   * Schedule has already been revoked.
   */
  8: {message:"AlreadyRevoked"},
  /**
   * `release` was called but no vested tokens are available.
   */
  9: {message:"NothingToRelease"},
  /**
   * No schedule found for recipient.
   */
  10: {message:"ScheduleNotFound"},
  /**
   * Schedule index is out of bounds for recipient.
   */
  11: {message:"ScheduleIndexOutOfBounds"},
  /**
   * Batch schedules list is empty.
   */
  12: {message:"BatchEmpty"},
  /**
   * Batch schedules size exceeds maximum of 50.
   */
  13: {message:"BatchTooLarge"},
  /**
   * `extend_cliff` called after the cliff ledger has passed.
   */
  14: {message:"CliffPassed"},
  /**
   * New cliff ledger is not strictly later than the current cliff ledger.
   */
  15: {message:"CliffNotExtended"},
  /**
   * New cliff ledger is not strictly before the end ledger.
   */
  16: {message:"CliffAfterEnd"},
  /**
   * `prune_recipient` called for a recipient that is not tracked.
   */
  17: {message:"RecipientNotTracked"},
  /**
   * A recipient already holds the maximum number of stored schedules.
   */
  18: {message:"TooManySchedules"}
}


export interface ScheduleInput {
  cliff_ledger: u32;
  end_ledger: u32;
  recipient: string;
  total_amount: i128;
}


export interface VestingSchedule {
  cliff_ledger: u32;
  end_ledger: u32;
  recipient: string;
  released: i128;
  revoked: boolean;
  total_amount: i128;
}

export interface Client {
  /**
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pause the vesting contract. Admin only.
   */
  pause: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a revoke transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-only: revoke a schedule, send vested portion to recipient,
   * return unvested remainder to admin.
   */
  revoke: ({recipient, index}: {recipient: string, index: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a release transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Release all currently vested (but unreleased) tokens to the recipient.
   * Can be called by anyone.
   */
  release: ({recipient, index}: {recipient: string, index: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Unpause the vesting contract. Admin only.
   */
  unpause: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Upgrade this contract's WASM code hash in place. Admin only.
   * 
   * Security note: this preserves existing storage and contract state, so
   * new WASM must remain storage-compatible with previous deployments.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a solvency transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Compare the vesting contract's live token balance to outstanding grants.
   */
  solvency: (options?: MethodOptions) => Promise<AssembledTransaction<Solvency>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the admin address of this vesting contract.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a is_locked transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns `true` once `revoke_admin` has been called. Once locked, no
   * admin operation can ever succeed again.
   */
  is_locked: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a is_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns `true` if the contract is currently paused.
   */
  is_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the admin and the token contract this vesting module manages.
   */
  initialize: ({admin, token_contract}: {admin: string, token_contract: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a keep_alive transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Refresh a schedule's storage TTL without releasing tokens.
   * 
   * Schedules whose remaining duration exceeds the network's maximum
   * entry TTL (roughly 180 days) have their storage TTL clamped at
   * creation time (see `_ttl_ledgers`). For such long-dated grants,
   * call this at least once per TTL window to keep the entry from
   * being archived between claims. Can be called by anyone.
   */
  keep_alive: ({recipient, index}: {recipient: string, index: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a release_all transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Release all releasable tokens across all non-revoked schedules
   * in a single token transfer.
   * 
   * Bounded by `MAX_SCHEDULES_PER_RECIPIENT` (see `total_vested`): this
   * loop used to be the one place a holder could be left unable to claim
   * at all, because it walks the same uncapped range as the getters.
   */
  release_all: ({recipient}: {recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accept the admin role. Must be called by the pending admin.
   */
  accept_admin: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a extend_cliff transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-only: extend the cliff ledger of an existing (non-revoked) schedule.
   * 
   * Also shifts `end_ledger` by the same delta so that the total vesting
   * duration is preserved — the per-ledger unlock rate remains unchanged.
   * 
   * Rules enforced:
   * - `new_cliff` must be strictly greater than the current `cliff_ledger`
   * (extension only — reduction is never allowed).
   * - The current ledger must still be before the cliff (once the cliff has
   * already passed there is nothing left to delay).
   * - `new_cliff` must remain strictly less than the shifted `end_ledger`.
   */
  extend_cliff: ({recipient, new_cliff, index}: {recipient: string, new_cliff: u32, index: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_schedule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the full schedule struct for a recipient.
   */
  get_schedule: ({recipient, index}: {recipient: string, index: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<VestingSchedule>>

  /**
   * Construct and simulate a revoke_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permanently revoke the admin role and lock the contract.
   * 
   * After this call:
   * - No further `create_schedule`, `revoke`, `extend_cliff`,
   * `prune_recipient`, `propose_admin`, `accept_admin`,
   * `upgrade`, `pause`, or `unpause` operation can ever succeed.
   * - The Admin storage entry is removed and a `Locked` flag is set.
   * - `is_locked()` returns `true` from then on.
   * 
   * Holders can still `release` and `keep_alive`. The contract
   * becomes effectively immutable.
   * 
   * **This action is irreversible.**
   */
  revoke_admin: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a total_vested transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sum vested amount across all non-revoked schedules for a recipient.
   * 
   * Bounded by `MAX_SCHEDULES_PER_RECIPIENT`: the writer refuses to store
   * a 51st schedule, so this loop cannot outgrow the compute budget
   * (issue #466).
   */
  total_vested: ({recipient}: {recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a pending_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the address proposed via `propose_admin` that has not yet
   * accepted the role, or `None` when no transfer is in progress.
   */
  pending_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a propose_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Propose a new admin. Must be called by the current admin.
   * The new admin must call `accept_admin` to finalize the transfer.
   */
  propose_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a vested_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Total amount vested so far (may or may not have been released).
   */
  vested_amount: ({recipient, index}: {recipient: string, index: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a total_released transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sum released amount across all schedules for a recipient.
   * 
   * Bounded by `MAX_SCHEDULES_PER_RECIPIENT` (see `total_vested`).
   */
  total_released: ({recipient}: {recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a create_schedule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a cliff + linear vesting schedule for `recipient`.
   * 
   * `cliff_ledger` — ledger number when tokens start unlocking.
   * `end_ledger`   — ledger number when 100 % is vested.
   * 
   * This function atomically transfers `total_amount` tokens from the admin
   * to this contract's address using transfer, ensuring the contract
   * is properly funded in the same transaction.
   * 
   * **Maximum schedules per recipient: `MAX_SCHEDULES_PER_RECIPIENT` (50).**
   * Exceeding it fails with `TooManySchedules` rather than being stored,
   * so the aggregate getters that walk a recipient's full schedule range
   * stay inside the compute budget (issue #466).
   */
  create_schedule: ({recipient, total_amount, cliff_ledger, end_ledger}: {recipient: string, total_amount: i128, cliff_ledger: u32, end_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a prune_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-only: remove a fully-settled recipient from the enumeration
   * index. Does not touch the recipient's schedules — it only prunes the
   * enumeration slot(s) so `get_recipients_paginated` stops listing them.
   */
  prune_recipient: ({recipient}: {recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a released_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Amount already released to the recipient.
   */
  released_amount: ({recipient, index}: {recipient: string, index: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a total_committed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Total tokens still committed to active vesting schedules.
   */
  total_committed: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a total_releasable transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sum releasable (vested minus released) across all non-revoked schedules.
   * 
   * Bounded by `MAX_SCHEDULES_PER_RECIPIENT` (see `total_vested`).
   */
  total_releasable: ({recipient}: {recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_all_schedules transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return all schedule objects for a recipient in a single call.
   * 
   * Safe to call for any recipient the cap admits, because that is what
   * bounds the loop: at most `MAX_SCHEDULES_PER_RECIPIENT` entries are ever
   * stored (issue #466). `get_schedules_paginated` is the incremental
   * alternative for a client that would rather bound its own work.
   */
  get_all_schedules: ({recipient}: {recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<VestingSchedule>>>

  /**
   * Construct and simulate a get_schedule_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the number of schedules stored for a recipient.
   */
  get_schedule_count: ({recipient}: {recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_token_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the token contract address managed by this vesting contract.
   */
  get_token_contract: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_recipient_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the number of recipients tracked (including any pruned slots).
   */
  get_recipient_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a cancel_admin_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cancel a proposed admin transfer. Must be called by the current admin.
   */
  cancel_admin_proposal: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a create_schedules_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create multiple vesting schedules in a single transaction.
   * 
   * Atomically transfers the sum of all `total_amount` values from the admin
   * to this contract (Phase 2), then writes each schedule (Phase 3). If any
   * step panics the entire transaction rolls back, including the token transfer.
   * 
   * **Maximum batch size: 50 recipients.** Larger batches risk exceeding
   * Soroban's per-transaction compute budget and will be rejected up front
   * with a clear error rather than an opaque resource failure.
   * 
   * **Maximum schedules per recipient: `MAX_SCHEDULES_PER_RECIPIENT` (50)**
   * — the same invariant `create_schedule` enforces, and for the same
   * reason (issue #466). The check below counts this batch's own earlier
   * entries too, so a batch can bring a recipient *to* the ceiling but
   * never past it. A batch that would push any recipient over fails
   * entirely, like every other validation error here.
   */
  create_schedules_batch: ({schedules}: {schedules: Array<ScheduleInput>}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_schedules_paginated transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return one page of a recipient's schedules.
   * 
   * `start` — zero-based index into the recipient's schedule range.
   * `limit` — maximum number of schedules to return, **clamped to
   * `MAX_PAGE` (100)**; a larger request is served as a 100-entry page
   * rather than rejected (#469).
   * 
   * The same `get_recipients_paginated` contract applies: a page may come
   * back short even when more entries remain, so a caller paging through
   * everything should stop on an empty page rather than on a short one.
   * `get_schedule_count` reports how many slots exist in total.
   * 
   * Added alongside `get_all_schedules`, not in place of it: the cap is
   * what makes the single-call form safe, and this lets a client render
   * grants incrementally without paying for the whole set up front
   * (issue #466).
   */
  get_schedules_paginated: ({recipient, start, limit}: {recipient: string, start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<VestingSchedule>>>

  /**
   * Construct and simulate a get_recipients_paginated transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return paginated list of recipients with vesting schedules.
   * 
   * `start` — zero-based offset into the recipients list.
   * `limit` — maximum number of recipients to return, **clamped to
   * `MAX_PAGE` (100)**. A larger request is served as a 100-entry page
   * rather than rejected, so an over-eager client still makes progress
   * instead of getting nothing back (#469).
   * 
   * Pruned slots (see `prune_recipient`) are omitted from the result, so
   * a page may contain fewer than `limit` entries even if more remain —
   * which is also why a short page is not, on its own, proof that the
   * list is exhausted. Callers should keep paging while the returned
   * page is non-empty, as `useVestingDashboard` does.
   */
  get_recipients_paginated: ({start, limit}: {start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAACdQYXVzZSB0aGUgdmVzdGluZyBjb250cmFjdC4gQWRtaW4gb25seS4AAAAABXBhdXNlAAAAAAAAAAAAAAA=",
        "AAAAAAAAAGRBZG1pbi1vbmx5OiByZXZva2UgYSBzY2hlZHVsZSwgc2VuZCB2ZXN0ZWQgcG9ydGlvbiB0byByZWNpcGllbnQsCnJldHVybiB1bnZlc3RlZCByZW1haW5kZXIgdG8gYWRtaW4uAAAABnJldm9rZQAAAAAAAgAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAFaW5kZXgAAAAAAAPoAAAABAAAAAA=",
        "AAAAAAAAAF9SZWxlYXNlIGFsbCBjdXJyZW50bHkgdmVzdGVkIChidXQgdW5yZWxlYXNlZCkgdG9rZW5zIHRvIHRoZSByZWNpcGllbnQuCkNhbiBiZSBjYWxsZWQgYnkgYW55b25lLgAAAAAHcmVsZWFzZQAAAAACAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAVpbmRleAAAAAAAA+gAAAAEAAAAAA==",
        "AAAAAAAAAClVbnBhdXNlIHRoZSB2ZXN0aW5nIGNvbnRyYWN0LiBBZG1pbiBvbmx5LgAAAAAAAAd1bnBhdXNlAAAAAAAAAAAA",
        "AAAAAAAAAMZVcGdyYWRlIHRoaXMgY29udHJhY3QncyBXQVNNIGNvZGUgaGFzaCBpbiBwbGFjZS4gQWRtaW4gb25seS4KClNlY3VyaXR5IG5vdGU6IHRoaXMgcHJlc2VydmVzIGV4aXN0aW5nIHN0b3JhZ2UgYW5kIGNvbnRyYWN0IHN0YXRlLCBzbwpuZXcgV0FTTSBtdXN0IHJlbWFpbiBzdG9yYWdlLWNvbXBhdGlibGUgd2l0aCBwcmV2aW91cyBkZXBsb3ltZW50cy4AAAAAAAd1cGdyYWRlAAAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAA=",
        "AAAAAAAAAEhDb21wYXJlIHRoZSB2ZXN0aW5nIGNvbnRyYWN0J3MgbGl2ZSB0b2tlbiBiYWxhbmNlIHRvIG91dHN0YW5kaW5nIGdyYW50cy4AAAAIc29sdmVuY3kAAAAAAAAAAQAAB9AAAAAIU29sdmVuY3k=",
        "AAAAAAAAADNSZXR1cm5zIHRoZSBhZG1pbiBhZGRyZXNzIG9mIHRoaXMgdmVzdGluZyBjb250cmFjdC4AAAAACWdldF9hZG1pbgAAAAAAAAAAAAABAAAAEw==",
        "AAAAAAAAAGtSZXR1cm5zIGB0cnVlYCBvbmNlIGByZXZva2VfYWRtaW5gIGhhcyBiZWVuIGNhbGxlZC4gT25jZSBsb2NrZWQsIG5vCmFkbWluIG9wZXJhdGlvbiBjYW4gZXZlciBzdWNjZWVkIGFnYWluLgAAAAAJaXNfbG9ja2VkAAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAADNSZXR1cm5zIGB0cnVlYCBpZiB0aGUgY29udHJhY3QgaXMgY3VycmVudGx5IHBhdXNlZC4AAAAACWlzX3BhdXNlZAAAAAAAAAAAAAABAAAAAQ==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACgAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAMUGVuZGluZ0FkbWluAAAAAAAAAAAAAAAGTG9ja2VkAAAAAAAAAAAAAAAAAA1Ub2tlbkNvbnRyYWN0AAAAAAAAAAAAAAAAAAAISXNQYXVzZWQAAAAAAAAAAAAAAA5Ub3RhbENvbW1pdHRlZAAAAAAAAQAAAAAAAAAIU2NoZWR1bGUAAAACAAAAEwAAAAQAAAABAAAAAAAAAA1TY2hlZHVsZUNvdW50AAAAAAAAAQAAABMAAAAAAAAAAAAAAA5SZWNpcGllbnRDb3VudAAAAAAAAQAAAAAAAAALUmVjaXBpZW50QXQAAAAAAQAAAAQ=",
        "AAAAAAAAAEFTZXQgdGhlIGFkbWluIGFuZCB0aGUgdG9rZW4gY29udHJhY3QgdGhpcyB2ZXN0aW5nIG1vZHVsZSBtYW5hZ2VzLgAAAAAAAAppbml0aWFsaXplAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAADnRva2VuX2NvbnRyYWN0AAAAAAATAAAAAA==",
        "AAAAAAAAAXFSZWZyZXNoIGEgc2NoZWR1bGUncyBzdG9yYWdlIFRUTCB3aXRob3V0IHJlbGVhc2luZyB0b2tlbnMuCgpTY2hlZHVsZXMgd2hvc2UgcmVtYWluaW5nIGR1cmF0aW9uIGV4Y2VlZHMgdGhlIG5ldHdvcmsncyBtYXhpbXVtCmVudHJ5IFRUTCAocm91Z2hseSAxODAgZGF5cykgaGF2ZSB0aGVpciBzdG9yYWdlIFRUTCBjbGFtcGVkIGF0CmNyZWF0aW9uIHRpbWUgKHNlZSBgX3R0bF9sZWRnZXJzYCkuIEZvciBzdWNoIGxvbmctZGF0ZWQgZ3JhbnRzLApjYWxsIHRoaXMgYXQgbGVhc3Qgb25jZSBwZXIgVFRMIHdpbmRvdyB0byBrZWVwIHRoZSBlbnRyeSBmcm9tCmJlaW5nIGFyY2hpdmVkIGJldHdlZW4gY2xhaW1zLiBDYW4gYmUgY2FsbGVkIGJ5IGFueW9uZS4AAAAAAAAKa2VlcF9hbGl2ZQAAAAAAAgAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAFaW5kZXgAAAAAAAPoAAAABAAAAAA=",
        "AAAAAQAAAAAAAAAAAAAACFNvbHZlbmN5AAAAAwAAAAAAAAAHc29sdmVudAAAAAABAAAAAAAAAA10b2tlbl9iYWxhbmNlAAAAAAAACwAAAAAAAAAPdG90YWxfY29tbWl0dGVkAAAAAAs=",
        "AAAAAAAAASVSZWxlYXNlIGFsbCByZWxlYXNhYmxlIHRva2VucyBhY3Jvc3MgYWxsIG5vbi1yZXZva2VkIHNjaGVkdWxlcwppbiBhIHNpbmdsZSB0b2tlbiB0cmFuc2Zlci4KCkJvdW5kZWQgYnkgYE1BWF9TQ0hFRFVMRVNfUEVSX1JFQ0lQSUVOVGAgKHNlZSBgdG90YWxfdmVzdGVkYCk6IHRoaXMKbG9vcCB1c2VkIHRvIGJlIHRoZSBvbmUgcGxhY2UgYSBob2xkZXIgY291bGQgYmUgbGVmdCB1bmFibGUgdG8gY2xhaW0KYXQgYWxsLCBiZWNhdXNlIGl0IHdhbGtzIHRoZSBzYW1lIHVuY2FwcGVkIHJhbmdlIGFzIHRoZSBnZXR0ZXJzLgAAAAAAAAtyZWxlYXNlX2FsbAAAAAABAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAA==",
        "AAAAAAAAADtBY2NlcHQgdGhlIGFkbWluIHJvbGUuIE11c3QgYmUgY2FsbGVkIGJ5IHRoZSBwZW5kaW5nIGFkbWluLgAAAAAMYWNjZXB0X2FkbWluAAAAAAAAAAA=",
        "AAAAAAAAAiBBZG1pbi1vbmx5OiBleHRlbmQgdGhlIGNsaWZmIGxlZGdlciBvZiBhbiBleGlzdGluZyAobm9uLXJldm9rZWQpIHNjaGVkdWxlLgoKQWxzbyBzaGlmdHMgYGVuZF9sZWRnZXJgIGJ5IHRoZSBzYW1lIGRlbHRhIHNvIHRoYXQgdGhlIHRvdGFsIHZlc3RpbmcKZHVyYXRpb24gaXMgcHJlc2VydmVkIOKAlCB0aGUgcGVyLWxlZGdlciB1bmxvY2sgcmF0ZSByZW1haW5zIHVuY2hhbmdlZC4KClJ1bGVzIGVuZm9yY2VkOgotIGBuZXdfY2xpZmZgIG11c3QgYmUgc3RyaWN0bHkgZ3JlYXRlciB0aGFuIHRoZSBjdXJyZW50IGBjbGlmZl9sZWRnZXJgCihleHRlbnNpb24gb25seSDigJQgcmVkdWN0aW9uIGlzIG5ldmVyIGFsbG93ZWQpLgotIFRoZSBjdXJyZW50IGxlZGdlciBtdXN0IHN0aWxsIGJlIGJlZm9yZSB0aGUgY2xpZmYgKG9uY2UgdGhlIGNsaWZmIGhhcwphbHJlYWR5IHBhc3NlZCB0aGVyZSBpcyBub3RoaW5nIGxlZnQgdG8gZGVsYXkpLgotIGBuZXdfY2xpZmZgIG11c3QgcmVtYWluIHN0cmljdGx5IGxlc3MgdGhhbiB0aGUgc2hpZnRlZCBgZW5kX2xlZGdlcmAuAAAADGV4dGVuZF9jbGlmZgAAAAMAAAAAAAAACXJlY2lwaWVudAAAAAAAABMAAAAAAAAACW5ld19jbGlmZgAAAAAAAAQAAAAAAAAABWluZGV4AAAAAAAD6AAAAAQAAAAA",
        "AAAAAAAAADBSZXR1cm4gdGhlIGZ1bGwgc2NoZWR1bGUgc3RydWN0IGZvciBhIHJlY2lwaWVudC4AAAAMZ2V0X3NjaGVkdWxlAAAAAgAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAFaW5kZXgAAAAAAAPoAAAABAAAAAEAAAfQAAAAD1Zlc3RpbmdTY2hlZHVsZQA=",
        "AAAAAAAAAeBQZXJtYW5lbnRseSByZXZva2UgdGhlIGFkbWluIHJvbGUgYW5kIGxvY2sgdGhlIGNvbnRyYWN0LgoKQWZ0ZXIgdGhpcyBjYWxsOgotIE5vIGZ1cnRoZXIgYGNyZWF0ZV9zY2hlZHVsZWAsIGByZXZva2VgLCBgZXh0ZW5kX2NsaWZmYCwKYHBydW5lX3JlY2lwaWVudGAsIGBwcm9wb3NlX2FkbWluYCwgYGFjY2VwdF9hZG1pbmAsCmB1cGdyYWRlYCwgYHBhdXNlYCwgb3IgYHVucGF1c2VgIG9wZXJhdGlvbiBjYW4gZXZlciBzdWNjZWVkLgotIFRoZSBBZG1pbiBzdG9yYWdlIGVudHJ5IGlzIHJlbW92ZWQgYW5kIGEgYExvY2tlZGAgZmxhZyBpcyBzZXQuCi0gYGlzX2xvY2tlZCgpYCByZXR1cm5zIGB0cnVlYCBmcm9tIHRoZW4gb24uCgpIb2xkZXJzIGNhbiBzdGlsbCBgcmVsZWFzZWAgYW5kIGBrZWVwX2FsaXZlYC4gVGhlIGNvbnRyYWN0CmJlY29tZXMgZWZmZWN0aXZlbHkgaW1tdXRhYmxlLgoKKipUaGlzIGFjdGlvbiBpcyBpcnJldmVyc2libGUuKioAAAAMcmV2b2tlX2FkbWluAAAAAAAAAAA=",
        "AAAAAAAAANhTdW0gdmVzdGVkIGFtb3VudCBhY3Jvc3MgYWxsIG5vbi1yZXZva2VkIHNjaGVkdWxlcyBmb3IgYSByZWNpcGllbnQuCgpCb3VuZGVkIGJ5IGBNQVhfU0NIRURVTEVTX1BFUl9SRUNJUElFTlRgOiB0aGUgd3JpdGVyIHJlZnVzZXMgdG8gc3RvcmUKYSA1MXN0IHNjaGVkdWxlLCBzbyB0aGlzIGxvb3AgY2Fubm90IG91dGdyb3cgdGhlIGNvbXB1dGUgYnVkZ2V0Cihpc3N1ZSAjNDY2KS4AAAAMdG90YWxfdmVzdGVkAAAAAQAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAH9SZXR1cm5zIHRoZSBhZGRyZXNzIHByb3Bvc2VkIHZpYSBgcHJvcG9zZV9hZG1pbmAgdGhhdCBoYXMgbm90IHlldAphY2NlcHRlZCB0aGUgcm9sZSwgb3IgYE5vbmVgIHdoZW4gbm8gdHJhbnNmZXIgaXMgaW4gcHJvZ3Jlc3MuAAAAAA1wZW5kaW5nX2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAHpQcm9wb3NlIGEgbmV3IGFkbWluLiBNdXN0IGJlIGNhbGxlZCBieSB0aGUgY3VycmVudCBhZG1pbi4KVGhlIG5ldyBhZG1pbiBtdXN0IGNhbGwgYGFjY2VwdF9hZG1pbmAgdG8gZmluYWxpemUgdGhlIHRyYW5zZmVyLgAAAAAADXByb3Bvc2VfYWRtaW4AAAAAAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAA==",
        "AAAAAAAAAD9Ub3RhbCBhbW91bnQgdmVzdGVkIHNvIGZhciAobWF5IG9yIG1heSBub3QgaGF2ZSBiZWVuIHJlbGVhc2VkKS4AAAAADXZlc3RlZF9hbW91bnQAAAAAAAACAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAVpbmRleAAAAAAAA+gAAAAEAAAAAQAAAAs=",
        "AAAAAAAAAHlTdW0gcmVsZWFzZWQgYW1vdW50IGFjcm9zcyBhbGwgc2NoZWR1bGVzIGZvciBhIHJlY2lwaWVudC4KCkJvdW5kZWQgYnkgYE1BWF9TQ0hFRFVMRVNfUEVSX1JFQ0lQSUVOVGAgKHNlZSBgdG90YWxfdmVzdGVkYCkuAAAAAAAADnRvdGFsX3JlbGVhc2VkAAAAAAABAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAQAAAAs=",
        "AAAABAAAAC9UeXBlZCBjb250cmFjdCBlcnJvcnMgZm9yIHRoZSB2ZXN0aW5nIGNvbnRyYWN0LgAAAAAAAAAADFZlc3RpbmdFcnJvcgAAABIAAABCYGluaXRpYWxpemVgIHdhcyBjYWxsZWQgb24gYSBjb250cmFjdCB0aGF0IGlzIGFscmVhZHkgaW5pdGlhbGl6ZWQuAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAM09wZXJhdGlvbiBhdHRlbXB0ZWQgYmVmb3JlIGBpbml0aWFsaXplYCB3YXMgY2FsbGVkLgAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAIAAAAfVGhlIHZlc3RpbmcgY29udHJhY3QgaXMgcGF1c2VkLgAAAAAGUGF1c2VkAAAAAAADAAAAPkFtb3VudCBpcyB6ZXJvIG9yIG5lZ2F0aXZlIHdoZXJlIGEgcG9zaXRpdmUgdmFsdWUgaXMgcmVxdWlyZWQuAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAQAAAAyYGVuZF9sZWRnZXJgIGlzIG5vdCBzdHJpY3RseSBhZnRlciBgY2xpZmZfbGVkZ2VyYC4AAAAAABJJbnZhbGlkTGVkZ2VyUmFuZ2UAAAAAAAUAAAAzYGFjY2VwdF9hZG1pbmAgd2FzIGNhbGxlZCB3aXRoIG5vIHBlbmRpbmcgcHJvcG9zYWwuAAAAAA5Ob1BlbmRpbmdBZG1pbgAAAAAABgAAADJPcGVyYXRpb24gYXR0ZW1wdGVkIG9uIGEgcmV2b2tlZCB2ZXN0aW5nIHNjaGVkdWxlLgAAAAAAD1NjaGVkdWxlUmV2b2tlZAAAAAAHAAAAIlNjaGVkdWxlIGhhcyBhbHJlYWR5IGJlZW4gcmV2b2tlZC4AAAAAAA5BbHJlYWR5UmV2b2tlZAAAAAAACAAAADhgcmVsZWFzZWAgd2FzIGNhbGxlZCBidXQgbm8gdmVzdGVkIHRva2VucyBhcmUgYXZhaWxhYmxlLgAAABBOb3RoaW5nVG9SZWxlYXNlAAAACQAAACBObyBzY2hlZHVsZSBmb3VuZCBmb3IgcmVjaXBpZW50LgAAABBTY2hlZHVsZU5vdEZvdW5kAAAACgAAAC5TY2hlZHVsZSBpbmRleCBpcyBvdXQgb2YgYm91bmRzIGZvciByZWNpcGllbnQuAAAAAAAYU2NoZWR1bGVJbmRleE91dE9mQm91bmRzAAAACwAAAB5CYXRjaCBzY2hlZHVsZXMgbGlzdCBpcyBlbXB0eS4AAAAAAApCYXRjaEVtcHR5AAAAAAAMAAAAK0JhdGNoIHNjaGVkdWxlcyBzaXplIGV4Y2VlZHMgbWF4aW11bSBvZiA1MC4AAAAADUJhdGNoVG9vTGFyZ2UAAAAAAAANAAAAOGBleHRlbmRfY2xpZmZgIGNhbGxlZCBhZnRlciB0aGUgY2xpZmYgbGVkZ2VyIGhhcyBwYXNzZWQuAAAAC0NsaWZmUGFzc2VkAAAAAA4AAABFTmV3IGNsaWZmIGxlZGdlciBpcyBub3Qgc3RyaWN0bHkgbGF0ZXIgdGhhbiB0aGUgY3VycmVudCBjbGlmZiBsZWRnZXIuAAAAAAAAEENsaWZmTm90RXh0ZW5kZWQAAAAPAAAAN05ldyBjbGlmZiBsZWRnZXIgaXMgbm90IHN0cmljdGx5IGJlZm9yZSB0aGUgZW5kIGxlZGdlci4AAAAADUNsaWZmQWZ0ZXJFbmQAAAAAAAAQAAAAPWBwcnVuZV9yZWNpcGllbnRgIGNhbGxlZCBmb3IgYSByZWNpcGllbnQgdGhhdCBpcyBub3QgdHJhY2tlZC4AAAAAAAATUmVjaXBpZW50Tm90VHJhY2tlZAAAAAARAAAAQUEgcmVjaXBpZW50IGFscmVhZHkgaG9sZHMgdGhlIG1heGltdW0gbnVtYmVyIG9mIHN0b3JlZCBzY2hlZHVsZXMuAAAAAAAAEFRvb01hbnlTY2hlZHVsZXMAAAAS",
        "AAAAAAAAAmZDcmVhdGUgYSBjbGlmZiArIGxpbmVhciB2ZXN0aW5nIHNjaGVkdWxlIGZvciBgcmVjaXBpZW50YC4KCmBjbGlmZl9sZWRnZXJgIOKAlCBsZWRnZXIgbnVtYmVyIHdoZW4gdG9rZW5zIHN0YXJ0IHVubG9ja2luZy4KYGVuZF9sZWRnZXJgICAg4oCUIGxlZGdlciBudW1iZXIgd2hlbiAxMDAgJSBpcyB2ZXN0ZWQuCgpUaGlzIGZ1bmN0aW9uIGF0b21pY2FsbHkgdHJhbnNmZXJzIGB0b3RhbF9hbW91bnRgIHRva2VucyBmcm9tIHRoZSBhZG1pbgp0byB0aGlzIGNvbnRyYWN0J3MgYWRkcmVzcyB1c2luZyB0cmFuc2ZlciwgZW5zdXJpbmcgdGhlIGNvbnRyYWN0CmlzIHByb3Blcmx5IGZ1bmRlZCBpbiB0aGUgc2FtZSB0cmFuc2FjdGlvbi4KCioqTWF4aW11bSBzY2hlZHVsZXMgcGVyIHJlY2lwaWVudDogYE1BWF9TQ0hFRFVMRVNfUEVSX1JFQ0lQSUVOVGAgKDUwKS4qKgpFeGNlZWRpbmcgaXQgZmFpbHMgd2l0aCBgVG9vTWFueVNjaGVkdWxlc2AgcmF0aGVyIHRoYW4gYmVpbmcgc3RvcmVkLApzbyB0aGUgYWdncmVnYXRlIGdldHRlcnMgdGhhdCB3YWxrIGEgcmVjaXBpZW50J3MgZnVsbCBzY2hlZHVsZSByYW5nZQpzdGF5IGluc2lkZSB0aGUgY29tcHV0ZSBidWRnZXQgKGlzc3VlICM0NjYpLgAAAAAAD2NyZWF0ZV9zY2hlZHVsZQAAAAAEAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAx0b3RhbF9hbW91bnQAAAALAAAAAAAAAAxjbGlmZl9sZWRnZXIAAAAEAAAAAAAAAAplbmRfbGVkZ2VyAAAAAAAEAAAAAA==",
        "AAAAAAAAAM5BZG1pbi1vbmx5OiByZW1vdmUgYSBmdWxseS1zZXR0bGVkIHJlY2lwaWVudCBmcm9tIHRoZSBlbnVtZXJhdGlvbgppbmRleC4gRG9lcyBub3QgdG91Y2ggdGhlIHJlY2lwaWVudCdzIHNjaGVkdWxlcyDigJQgaXQgb25seSBwcnVuZXMgdGhlCmVudW1lcmF0aW9uIHNsb3Qocykgc28gYGdldF9yZWNpcGllbnRzX3BhZ2luYXRlZGAgc3RvcHMgbGlzdGluZyB0aGVtLgAAAAAAD3BydW5lX3JlY2lwaWVudAAAAAABAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAA==",
        "AAAAAAAAAClBbW91bnQgYWxyZWFkeSByZWxlYXNlZCB0byB0aGUgcmVjaXBpZW50LgAAAAAAAA9yZWxlYXNlZF9hbW91bnQAAAAAAgAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAFaW5kZXgAAAAAAAPoAAAABAAAAAEAAAAL",
        "AAAAAAAAADlUb3RhbCB0b2tlbnMgc3RpbGwgY29tbWl0dGVkIHRvIGFjdGl2ZSB2ZXN0aW5nIHNjaGVkdWxlcy4AAAAAAAAPdG90YWxfY29tbWl0dGVkAAAAAAAAAAABAAAACw==",
        "AAAAAQAAAAAAAAAAAAAADVNjaGVkdWxlSW5wdXQAAAAAAAAEAAAAAAAAAAxjbGlmZl9sZWRnZXIAAAAEAAAAAAAAAAplbmRfbGVkZ2VyAAAAAAAEAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAx0b3RhbF9hbW91bnQAAAAL",
        "AAAAAAAAAIhTdW0gcmVsZWFzYWJsZSAodmVzdGVkIG1pbnVzIHJlbGVhc2VkKSBhY3Jvc3MgYWxsIG5vbi1yZXZva2VkIHNjaGVkdWxlcy4KCkJvdW5kZWQgYnkgYE1BWF9TQ0hFRFVMRVNfUEVSX1JFQ0lQSUVOVGAgKHNlZSBgdG90YWxfdmVzdGVkYCkuAAAAEHRvdGFsX3JlbGVhc2FibGUAAAABAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAUtSZXR1cm4gYWxsIHNjaGVkdWxlIG9iamVjdHMgZm9yIGEgcmVjaXBpZW50IGluIGEgc2luZ2xlIGNhbGwuCgpTYWZlIHRvIGNhbGwgZm9yIGFueSByZWNpcGllbnQgdGhlIGNhcCBhZG1pdHMsIGJlY2F1c2UgdGhhdCBpcyB3aGF0CmJvdW5kcyB0aGUgbG9vcDogYXQgbW9zdCBgTUFYX1NDSEVEVUxFU19QRVJfUkVDSVBJRU5UYCBlbnRyaWVzIGFyZSBldmVyCnN0b3JlZCAoaXNzdWUgIzQ2NikuIGBnZXRfc2NoZWR1bGVzX3BhZ2luYXRlZGAgaXMgdGhlIGluY3JlbWVudGFsCmFsdGVybmF0aXZlIGZvciBhIGNsaWVudCB0aGF0IHdvdWxkIHJhdGhlciBib3VuZCBpdHMgb3duIHdvcmsuAAAAABFnZXRfYWxsX3NjaGVkdWxlcwAAAAAAAAEAAAAAAAAACXJlY2lwaWVudAAAAAAAABMAAAABAAAD6gAAB9AAAAAPVmVzdGluZ1NjaGVkdWxlAA==",
        "AAAAAQAAAAAAAAAAAAAAD1Zlc3RpbmdTY2hlZHVsZQAAAAAGAAAAAAAAAAxjbGlmZl9sZWRnZXIAAAAEAAAAAAAAAAplbmRfbGVkZ2VyAAAAAAAEAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAhyZWxlYXNlZAAAAAsAAAAAAAAAB3Jldm9rZWQAAAAAAQAAAAAAAAAMdG90YWxfYW1vdW50AAAACw==",
        "AAAAAAAAADZSZXR1cm4gdGhlIG51bWJlciBvZiBzY2hlZHVsZXMgc3RvcmVkIGZvciBhIHJlY2lwaWVudC4AAAAAABJnZXRfc2NoZWR1bGVfY291bnQAAAAAAAEAAAAAAAAACXJlY2lwaWVudAAAAAAAABMAAAABAAAABA==",
        "AAAAAAAAAERSZXR1cm5zIHRoZSB0b2tlbiBjb250cmFjdCBhZGRyZXNzIG1hbmFnZWQgYnkgdGhpcyB2ZXN0aW5nIGNvbnRyYWN0LgAAABJnZXRfdG9rZW5fY29udHJhY3QAAAAAAAAAAAABAAAAEw==",
        "AAAAAAAAAEVSZXR1cm4gdGhlIG51bWJlciBvZiByZWNpcGllbnRzIHRyYWNrZWQgKGluY2x1ZGluZyBhbnkgcHJ1bmVkIHNsb3RzKS4AAAAAAAATZ2V0X3JlY2lwaWVudF9jb3VudAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAEZDYW5jZWwgYSBwcm9wb3NlZCBhZG1pbiB0cmFuc2Zlci4gTXVzdCBiZSBjYWxsZWQgYnkgdGhlIGN1cnJlbnQgYWRtaW4uAAAAAAAVY2FuY2VsX2FkbWluX3Byb3Bvc2FsAAAAAAAAAAAAAAA=",
        "AAAAAAAAA2hDcmVhdGUgbXVsdGlwbGUgdmVzdGluZyBzY2hlZHVsZXMgaW4gYSBzaW5nbGUgdHJhbnNhY3Rpb24uCgpBdG9taWNhbGx5IHRyYW5zZmVycyB0aGUgc3VtIG9mIGFsbCBgdG90YWxfYW1vdW50YCB2YWx1ZXMgZnJvbSB0aGUgYWRtaW4KdG8gdGhpcyBjb250cmFjdCAoUGhhc2UgMiksIHRoZW4gd3JpdGVzIGVhY2ggc2NoZWR1bGUgKFBoYXNlIDMpLiBJZiBhbnkKc3RlcCBwYW5pY3MgdGhlIGVudGlyZSB0cmFuc2FjdGlvbiByb2xscyBiYWNrLCBpbmNsdWRpbmcgdGhlIHRva2VuIHRyYW5zZmVyLgoKKipNYXhpbXVtIGJhdGNoIHNpemU6IDUwIHJlY2lwaWVudHMuKiogTGFyZ2VyIGJhdGNoZXMgcmlzayBleGNlZWRpbmcKU29yb2JhbidzIHBlci10cmFuc2FjdGlvbiBjb21wdXRlIGJ1ZGdldCBhbmQgd2lsbCBiZSByZWplY3RlZCB1cCBmcm9udAp3aXRoIGEgY2xlYXIgZXJyb3IgcmF0aGVyIHRoYW4gYW4gb3BhcXVlIHJlc291cmNlIGZhaWx1cmUuCgoqKk1heGltdW0gc2NoZWR1bGVzIHBlciByZWNpcGllbnQ6IGBNQVhfU0NIRURVTEVTX1BFUl9SRUNJUElFTlRgICg1MCkqKgrigJQgdGhlIHNhbWUgaW52YXJpYW50IGBjcmVhdGVfc2NoZWR1bGVgIGVuZm9yY2VzLCBhbmQgZm9yIHRoZSBzYW1lCnJlYXNvbiAoaXNzdWUgIzQ2NikuIFRoZSBjaGVjayBiZWxvdyBjb3VudHMgdGhpcyBiYXRjaCdzIG93biBlYXJsaWVyCmVudHJpZXMgdG9vLCBzbyBhIGJhdGNoIGNhbiBicmluZyBhIHJlY2lwaWVudCAqdG8qIHRoZSBjZWlsaW5nIGJ1dApuZXZlciBwYXN0IGl0LiBBIGJhdGNoIHRoYXQgd291bGQgcHVzaCBhbnkgcmVjaXBpZW50IG92ZXIgZmFpbHMKZW50aXJlbHksIGxpa2UgZXZlcnkgb3RoZXIgdmFsaWRhdGlvbiBlcnJvciBoZXJlLgAAABZjcmVhdGVfc2NoZWR1bGVzX2JhdGNoAAAAAAABAAAAAAAAAAlzY2hlZHVsZXMAAAAAAAPqAAAH0AAAAA1TY2hlZHVsZUlucHV0AAAAAAAAAQAAAAQ=",
        "AAAAAAAAAvBSZXR1cm4gb25lIHBhZ2Ugb2YgYSByZWNpcGllbnQncyBzY2hlZHVsZXMuCgpgc3RhcnRgIOKAlCB6ZXJvLWJhc2VkIGluZGV4IGludG8gdGhlIHJlY2lwaWVudCdzIHNjaGVkdWxlIHJhbmdlLgpgbGltaXRgIOKAlCBtYXhpbXVtIG51bWJlciBvZiBzY2hlZHVsZXMgdG8gcmV0dXJuLCAqKmNsYW1wZWQgdG8KYE1BWF9QQUdFYCAoMTAwKSoqOyBhIGxhcmdlciByZXF1ZXN0IGlzIHNlcnZlZCBhcyBhIDEwMC1lbnRyeSBwYWdlCnJhdGhlciB0aGFuIHJlamVjdGVkICgjNDY5KS4KClRoZSBzYW1lIGBnZXRfcmVjaXBpZW50c19wYWdpbmF0ZWRgIGNvbnRyYWN0IGFwcGxpZXM6IGEgcGFnZSBtYXkgY29tZQpiYWNrIHNob3J0IGV2ZW4gd2hlbiBtb3JlIGVudHJpZXMgcmVtYWluLCBzbyBhIGNhbGxlciBwYWdpbmcgdGhyb3VnaApldmVyeXRoaW5nIHNob3VsZCBzdG9wIG9uIGFuIGVtcHR5IHBhZ2UgcmF0aGVyIHRoYW4gb24gYSBzaG9ydCBvbmUuCmBnZXRfc2NoZWR1bGVfY291bnRgIHJlcG9ydHMgaG93IG1hbnkgc2xvdHMgZXhpc3QgaW4gdG90YWwuCgpBZGRlZCBhbG9uZ3NpZGUgYGdldF9hbGxfc2NoZWR1bGVzYCwgbm90IGluIHBsYWNlIG9mIGl0OiB0aGUgY2FwIGlzCndoYXQgbWFrZXMgdGhlIHNpbmdsZS1jYWxsIGZvcm0gc2FmZSwgYW5kIHRoaXMgbGV0cyBhIGNsaWVudCByZW5kZXIKZ3JhbnRzIGluY3JlbWVudGFsbHkgd2l0aG91dCBwYXlpbmcgZm9yIHRoZSB3aG9sZSBzZXQgdXAgZnJvbnQKKGlzc3VlICM0NjYpLgAAABdnZXRfc2NoZWR1bGVzX3BhZ2luYXRlZAAAAAADAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAVzdGFydAAAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAAA9WZXN0aW5nU2NoZWR1bGUA",
        "AAAAAAAAAqRSZXR1cm4gcGFnaW5hdGVkIGxpc3Qgb2YgcmVjaXBpZW50cyB3aXRoIHZlc3Rpbmcgc2NoZWR1bGVzLgoKYHN0YXJ0YCDigJQgemVyby1iYXNlZCBvZmZzZXQgaW50byB0aGUgcmVjaXBpZW50cyBsaXN0LgpgbGltaXRgIOKAlCBtYXhpbXVtIG51bWJlciBvZiByZWNpcGllbnRzIHRvIHJldHVybiwgKipjbGFtcGVkIHRvCmBNQVhfUEFHRWAgKDEwMCkqKi4gQSBsYXJnZXIgcmVxdWVzdCBpcyBzZXJ2ZWQgYXMgYSAxMDAtZW50cnkgcGFnZQpyYXRoZXIgdGhhbiByZWplY3RlZCwgc28gYW4gb3Zlci1lYWdlciBjbGllbnQgc3RpbGwgbWFrZXMgcHJvZ3Jlc3MKaW5zdGVhZCBvZiBnZXR0aW5nIG5vdGhpbmcgYmFjayAoIzQ2OSkuCgpQcnVuZWQgc2xvdHMgKHNlZSBgcHJ1bmVfcmVjaXBpZW50YCkgYXJlIG9taXR0ZWQgZnJvbSB0aGUgcmVzdWx0LCBzbwphIHBhZ2UgbWF5IGNvbnRhaW4gZmV3ZXIgdGhhbiBgbGltaXRgIGVudHJpZXMgZXZlbiBpZiBtb3JlIHJlbWFpbiDigJQKd2hpY2ggaXMgYWxzbyB3aHkgYSBzaG9ydCBwYWdlIGlzIG5vdCwgb24gaXRzIG93biwgcHJvb2YgdGhhdCB0aGUKbGlzdCBpcyBleGhhdXN0ZWQuIENhbGxlcnMgc2hvdWxkIGtlZXAgcGFnaW5nIHdoaWxlIHRoZSByZXR1cm5lZApwYWdlIGlzIG5vbi1lbXB0eSwgYXMgYHVzZVZlc3RpbmdEYXNoYm9hcmRgIGRvZXMuAAAAGGdldF9yZWNpcGllbnRzX3BhZ2luYXRlZAAAAAIAAAAAAAAABXN0YXJ0AAAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+oAAAAT" ]),
      options
    )
  }
  public readonly fromJSON = {
    pause: this.txFromJSON<null>,
        revoke: this.txFromJSON<null>,
        release: this.txFromJSON<null>,
        unpause: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        solvency: this.txFromJSON<Solvency>,
        get_admin: this.txFromJSON<string>,
        is_locked: this.txFromJSON<boolean>,
        is_paused: this.txFromJSON<boolean>,
        initialize: this.txFromJSON<null>,
        keep_alive: this.txFromJSON<null>,
        release_all: this.txFromJSON<null>,
        accept_admin: this.txFromJSON<null>,
        extend_cliff: this.txFromJSON<null>,
        get_schedule: this.txFromJSON<VestingSchedule>,
        revoke_admin: this.txFromJSON<null>,
        total_vested: this.txFromJSON<i128>,
        pending_admin: this.txFromJSON<Option<string>>,
        propose_admin: this.txFromJSON<null>,
        vested_amount: this.txFromJSON<i128>,
        total_released: this.txFromJSON<i128>,
        create_schedule: this.txFromJSON<null>,
        prune_recipient: this.txFromJSON<null>,
        released_amount: this.txFromJSON<i128>,
        total_committed: this.txFromJSON<i128>,
        total_releasable: this.txFromJSON<i128>,
        get_all_schedules: this.txFromJSON<Array<VestingSchedule>>,
        get_schedule_count: this.txFromJSON<u32>,
        get_token_contract: this.txFromJSON<string>,
        get_recipient_count: this.txFromJSON<u32>,
        cancel_admin_proposal: this.txFromJSON<null>,
        create_schedules_batch: this.txFromJSON<u32>,
        get_schedules_paginated: this.txFromJSON<Array<VestingSchedule>>,
        get_recipients_paginated: this.txFromJSON<Array<string>>
  }
}