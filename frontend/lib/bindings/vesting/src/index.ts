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




export type DataKey = {tag: "Admin", values: void} | {tag: "PendingAdmin", values: void} | {tag: "TokenContract", values: void} | {tag: "IsPaused", values: void} | {tag: "Schedule", values: readonly [string, u32]} | {tag: "ScheduleCount", values: readonly [string]} | {tag: "RecipientCount", values: void} | {tag: "RecipientAt", values: readonly [u32]};


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
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the admin address of this vesting contract.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

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
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accept the admin role. Must be called by the pending admin.
   */
  accept_admin: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a extend_cliff transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin-only: extend the cliff ledger of an existing (non-revoked) schedule.
   * 
   * Rules enforced:
   * - `new_cliff` must be strictly greater than the current `cliff_ledger`
   * (extension only — reduction is never allowed).
   * - The current ledger must still be before the cliff (once the cliff has
   * already passed there is nothing left to delay).
   * - `new_cliff` must remain strictly less than `end_ledger`.
   */
  extend_cliff: ({recipient, new_cliff, index}: {recipient: string, new_cliff: u32, index: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_schedule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the full schedule struct for a recipient.
   */
  get_schedule: ({recipient, index}: {recipient: string, index: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<VestingSchedule>>

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
   * Construct and simulate a create_schedule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a cliff + linear vesting schedule for `recipient`.
   * 
   * `cliff_ledger` — ledger number when tokens start unlocking.
   * `end_ledger`   — ledger number when 100 % is vested.
   * 
   * This function atomically transfers `total_amount` tokens from the admin
   * to this contract's address using transfer, ensuring the contract
   * is properly funded in the same transaction.
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
   */
  create_schedules_batch: ({schedules}: {schedules: Array<ScheduleInput>}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_recipients_paginated transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return paginated list of recipients with vesting schedules.
   * 
   * `start` — zero-based offset into the recipients list.
   * `limit` — maximum number of recipients to return.
   * 
   * Pruned slots (see `prune_recipient`) are omitted from the result, so
   * a page may contain fewer than `limit` entries even if more remain.
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
        "AAAAAAAAADNSZXR1cm5zIHRoZSBhZG1pbiBhZGRyZXNzIG9mIHRoaXMgdmVzdGluZyBjb250cmFjdC4AAAAACWdldF9hZG1pbgAAAAAAAAAAAAABAAAAEw==",
        "AAAAAAAAADNSZXR1cm5zIGB0cnVlYCBpZiB0aGUgY29udHJhY3QgaXMgY3VycmVudGx5IHBhdXNlZC4AAAAACWlzX3BhdXNlZAAAAAAAAAAAAAABAAAAAQ==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACAAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAMUGVuZGluZ0FkbWluAAAAAAAAAAAAAAANVG9rZW5Db250cmFjdAAAAAAAAAAAAAAAAAAACElzUGF1c2VkAAAAAQAAAAAAAAAIU2NoZWR1bGUAAAACAAAAEwAAAAQAAAABAAAAAAAAAA1TY2hlZHVsZUNvdW50AAAAAAAAAQAAABMAAAAAAAAAAAAAAA5SZWNpcGllbnRDb3VudAAAAAAAAQAAAAAAAAALUmVjaXBpZW50QXQAAAAAAQAAAAQ=",
        "AAAAAAAAAEFTZXQgdGhlIGFkbWluIGFuZCB0aGUgdG9rZW4gY29udHJhY3QgdGhpcyB2ZXN0aW5nIG1vZHVsZSBtYW5hZ2VzLgAAAAAAAAppbml0aWFsaXplAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAADnRva2VuX2NvbnRyYWN0AAAAAAATAAAAAA==",
        "AAAAAAAAAXFSZWZyZXNoIGEgc2NoZWR1bGUncyBzdG9yYWdlIFRUTCB3aXRob3V0IHJlbGVhc2luZyB0b2tlbnMuCgpTY2hlZHVsZXMgd2hvc2UgcmVtYWluaW5nIGR1cmF0aW9uIGV4Y2VlZHMgdGhlIG5ldHdvcmsncyBtYXhpbXVtCmVudHJ5IFRUTCAocm91Z2hseSAxODAgZGF5cykgaGF2ZSB0aGVpciBzdG9yYWdlIFRUTCBjbGFtcGVkIGF0CmNyZWF0aW9uIHRpbWUgKHNlZSBgX3R0bF9sZWRnZXJzYCkuIEZvciBzdWNoIGxvbmctZGF0ZWQgZ3JhbnRzLApjYWxsIHRoaXMgYXQgbGVhc3Qgb25jZSBwZXIgVFRMIHdpbmRvdyB0byBrZWVwIHRoZSBlbnRyeSBmcm9tCmJlaW5nIGFyY2hpdmVkIGJldHdlZW4gY2xhaW1zLiBDYW4gYmUgY2FsbGVkIGJ5IGFueW9uZS4AAAAAAAAKa2VlcF9hbGl2ZQAAAAAAAgAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAFaW5kZXgAAAAAAAPoAAAABAAAAAA=",
        "AAAAAAAAADtBY2NlcHQgdGhlIGFkbWluIHJvbGUuIE11c3QgYmUgY2FsbGVkIGJ5IHRoZSBwZW5kaW5nIGFkbWluLgAAAAAMYWNjZXB0X2FkbWluAAAAAAAAAAA=",
        "AAAAAAAAAYZBZG1pbi1vbmx5OiBleHRlbmQgdGhlIGNsaWZmIGxlZGdlciBvZiBhbiBleGlzdGluZyAobm9uLXJldm9rZWQpIHNjaGVkdWxlLgoKUnVsZXMgZW5mb3JjZWQ6Ci0gYG5ld19jbGlmZmAgbXVzdCBiZSBzdHJpY3RseSBncmVhdGVyIHRoYW4gdGhlIGN1cnJlbnQgYGNsaWZmX2xlZGdlcmAKKGV4dGVuc2lvbiBvbmx5IOKAlCByZWR1Y3Rpb24gaXMgbmV2ZXIgYWxsb3dlZCkuCi0gVGhlIGN1cnJlbnQgbGVkZ2VyIG11c3Qgc3RpbGwgYmUgYmVmb3JlIHRoZSBjbGlmZiAob25jZSB0aGUgY2xpZmYgaGFzCmFscmVhZHkgcGFzc2VkIHRoZXJlIGlzIG5vdGhpbmcgbGVmdCB0byBkZWxheSkuCi0gYG5ld19jbGlmZmAgbXVzdCByZW1haW4gc3RyaWN0bHkgbGVzcyB0aGFuIGBlbmRfbGVkZ2VyYC4AAAAAAAxleHRlbmRfY2xpZmYAAAADAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAluZXdfY2xpZmYAAAAAAAAEAAAAAAAAAAVpbmRleAAAAAAAA+gAAAAEAAAAAA==",
        "AAAAAAAAADBSZXR1cm4gdGhlIGZ1bGwgc2NoZWR1bGUgc3RydWN0IGZvciBhIHJlY2lwaWVudC4AAAAMZ2V0X3NjaGVkdWxlAAAAAgAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAFaW5kZXgAAAAAAAPoAAAABAAAAAEAAAfQAAAAD1Zlc3RpbmdTY2hlZHVsZQA=",
        "AAAAAAAAAHpQcm9wb3NlIGEgbmV3IGFkbWluLiBNdXN0IGJlIGNhbGxlZCBieSB0aGUgY3VycmVudCBhZG1pbi4KVGhlIG5ldyBhZG1pbiBtdXN0IGNhbGwgYGFjY2VwdF9hZG1pbmAgdG8gZmluYWxpemUgdGhlIHRyYW5zZmVyLgAAAAAADXByb3Bvc2VfYWRtaW4AAAAAAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAA==",
        "AAAAAAAAAD9Ub3RhbCBhbW91bnQgdmVzdGVkIHNvIGZhciAobWF5IG9yIG1heSBub3QgaGF2ZSBiZWVuIHJlbGVhc2VkKS4AAAAADXZlc3RlZF9hbW91bnQAAAAAAAACAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAVpbmRleAAAAAAAA+gAAAAEAAAAAQAAAAs=",
        "AAAAAAAAAWVDcmVhdGUgYSBjbGlmZiArIGxpbmVhciB2ZXN0aW5nIHNjaGVkdWxlIGZvciBgcmVjaXBpZW50YC4KCmBjbGlmZl9sZWRnZXJgIOKAlCBsZWRnZXIgbnVtYmVyIHdoZW4gdG9rZW5zIHN0YXJ0IHVubG9ja2luZy4KYGVuZF9sZWRnZXJgICAg4oCUIGxlZGdlciBudW1iZXIgd2hlbiAxMDAgJSBpcyB2ZXN0ZWQuCgpUaGlzIGZ1bmN0aW9uIGF0b21pY2FsbHkgdHJhbnNmZXJzIGB0b3RhbF9hbW91bnRgIHRva2VucyBmcm9tIHRoZSBhZG1pbgp0byB0aGlzIGNvbnRyYWN0J3MgYWRkcmVzcyB1c2luZyB0cmFuc2ZlciwgZW5zdXJpbmcgdGhlIGNvbnRyYWN0CmlzIHByb3Blcmx5IGZ1bmRlZCBpbiB0aGUgc2FtZSB0cmFuc2FjdGlvbi4AAAAAAAAPY3JlYXRlX3NjaGVkdWxlAAAAAAQAAAAAAAAACXJlY2lwaWVudAAAAAAAABMAAAAAAAAADHRvdGFsX2Ftb3VudAAAAAsAAAAAAAAADGNsaWZmX2xlZGdlcgAAAAQAAAAAAAAACmVuZF9sZWRnZXIAAAAAAAQAAAAA",
        "AAAAAAAAAM5BZG1pbi1vbmx5OiByZW1vdmUgYSBmdWxseS1zZXR0bGVkIHJlY2lwaWVudCBmcm9tIHRoZSBlbnVtZXJhdGlvbgppbmRleC4gRG9lcyBub3QgdG91Y2ggdGhlIHJlY2lwaWVudCdzIHNjaGVkdWxlcyDigJQgaXQgb25seSBwcnVuZXMgdGhlCmVudW1lcmF0aW9uIHNsb3Qocykgc28gYGdldF9yZWNpcGllbnRzX3BhZ2luYXRlZGAgc3RvcHMgbGlzdGluZyB0aGVtLgAAAAAAD3BydW5lX3JlY2lwaWVudAAAAAABAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAA==",
        "AAAAAAAAAClBbW91bnQgYWxyZWFkeSByZWxlYXNlZCB0byB0aGUgcmVjaXBpZW50LgAAAAAAAA9yZWxlYXNlZF9hbW91bnQAAAAAAgAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAFaW5kZXgAAAAAAAPoAAAABAAAAAEAAAAL",
        "AAAAAQAAAAAAAAAAAAAADVNjaGVkdWxlSW5wdXQAAAAAAAAEAAAAAAAAAAxjbGlmZl9sZWRnZXIAAAAEAAAAAAAAAAplbmRfbGVkZ2VyAAAAAAAEAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAx0b3RhbF9hbW91bnQAAAAL",
        "AAAAAQAAAAAAAAAAAAAAD1Zlc3RpbmdTY2hlZHVsZQAAAAAGAAAAAAAAAAxjbGlmZl9sZWRnZXIAAAAEAAAAAAAAAAplbmRfbGVkZ2VyAAAAAAAEAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAhyZWxlYXNlZAAAAAsAAAAAAAAAB3Jldm9rZWQAAAAAAQAAAAAAAAAMdG90YWxfYW1vdW50AAAACw==",
        "AAAAAAAAADZSZXR1cm4gdGhlIG51bWJlciBvZiBzY2hlZHVsZXMgc3RvcmVkIGZvciBhIHJlY2lwaWVudC4AAAAAABJnZXRfc2NoZWR1bGVfY291bnQAAAAAAAEAAAAAAAAACXJlY2lwaWVudAAAAAAAABMAAAABAAAABA==",
        "AAAAAAAAAERSZXR1cm5zIHRoZSB0b2tlbiBjb250cmFjdCBhZGRyZXNzIG1hbmFnZWQgYnkgdGhpcyB2ZXN0aW5nIGNvbnRyYWN0LgAAABJnZXRfdG9rZW5fY29udHJhY3QAAAAAAAAAAAABAAAAEw==",
        "AAAAAAAAAEVSZXR1cm4gdGhlIG51bWJlciBvZiByZWNpcGllbnRzIHRyYWNrZWQgKGluY2x1ZGluZyBhbnkgcHJ1bmVkIHNsb3RzKS4AAAAAAAATZ2V0X3JlY2lwaWVudF9jb3VudAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAeFDcmVhdGUgbXVsdGlwbGUgdmVzdGluZyBzY2hlZHVsZXMgaW4gYSBzaW5nbGUgdHJhbnNhY3Rpb24uCgpBdG9taWNhbGx5IHRyYW5zZmVycyB0aGUgc3VtIG9mIGFsbCBgdG90YWxfYW1vdW50YCB2YWx1ZXMgZnJvbSB0aGUgYWRtaW4KdG8gdGhpcyBjb250cmFjdCAoUGhhc2UgMiksIHRoZW4gd3JpdGVzIGVhY2ggc2NoZWR1bGUgKFBoYXNlIDMpLiBJZiBhbnkKc3RlcCBwYW5pY3MgdGhlIGVudGlyZSB0cmFuc2FjdGlvbiByb2xscyBiYWNrLCBpbmNsdWRpbmcgdGhlIHRva2VuIHRyYW5zZmVyLgoKKipNYXhpbXVtIGJhdGNoIHNpemU6IDUwIHJlY2lwaWVudHMuKiogTGFyZ2VyIGJhdGNoZXMgcmlzayBleGNlZWRpbmcKU29yb2JhbidzIHBlci10cmFuc2FjdGlvbiBjb21wdXRlIGJ1ZGdldCBhbmQgd2lsbCBiZSByZWplY3RlZCB1cCBmcm9udAp3aXRoIGEgY2xlYXIgZXJyb3IgcmF0aGVyIHRoYW4gYW4gb3BhcXVlIHJlc291cmNlIGZhaWx1cmUuAAAAAAAAFmNyZWF0ZV9zY2hlZHVsZXNfYmF0Y2gAAAAAAAEAAAAAAAAACXNjaGVkdWxlcwAAAAAAA+oAAAfQAAAADVNjaGVkdWxlSW5wdXQAAAAAAAABAAAABA==",
        "AAAAAAAAATFSZXR1cm4gcGFnaW5hdGVkIGxpc3Qgb2YgcmVjaXBpZW50cyB3aXRoIHZlc3Rpbmcgc2NoZWR1bGVzLgoKYHN0YXJ0YCDigJQgemVyby1iYXNlZCBvZmZzZXQgaW50byB0aGUgcmVjaXBpZW50cyBsaXN0LgpgbGltaXRgIOKAlCBtYXhpbXVtIG51bWJlciBvZiByZWNpcGllbnRzIHRvIHJldHVybi4KClBydW5lZCBzbG90cyAoc2VlIGBwcnVuZV9yZWNpcGllbnRgKSBhcmUgb21pdHRlZCBmcm9tIHRoZSByZXN1bHQsIHNvCmEgcGFnZSBtYXkgY29udGFpbiBmZXdlciB0aGFuIGBsaW1pdGAgZW50cmllcyBldmVuIGlmIG1vcmUgcmVtYWluLgAAAAAAABhnZXRfcmVjaXBpZW50c19wYWdpbmF0ZWQAAAACAAAAAAAAAAVzdGFydAAAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAAEw==" ]),
      options
    )
  }
  public readonly fromJSON = {
    pause: this.txFromJSON<null>,
        revoke: this.txFromJSON<null>,
        release: this.txFromJSON<null>,
        unpause: this.txFromJSON<null>,
        get_admin: this.txFromJSON<string>,
        is_paused: this.txFromJSON<boolean>,
        initialize: this.txFromJSON<null>,
        keep_alive: this.txFromJSON<null>,
        accept_admin: this.txFromJSON<null>,
        extend_cliff: this.txFromJSON<null>,
        get_schedule: this.txFromJSON<VestingSchedule>,
        propose_admin: this.txFromJSON<null>,
        vested_amount: this.txFromJSON<i128>,
        create_schedule: this.txFromJSON<null>,
        prune_recipient: this.txFromJSON<null>,
        released_amount: this.txFromJSON<i128>,
        get_schedule_count: this.txFromJSON<u32>,
        get_token_contract: this.txFromJSON<string>,
        get_recipient_count: this.txFromJSON<u32>,
        create_schedules_batch: this.txFromJSON<u32>,
        get_recipients_paginated: this.txFromJSON<Array<string>>
  }
}