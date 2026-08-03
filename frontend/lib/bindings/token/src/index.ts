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




export type DataKey = {tag: "Admin", values: void} | {tag: "PendingAdmin", values: void} | {tag: "ComplianceNode", values: void} | {tag: "Name", values: void} | {tag: "Symbol", values: void} | {tag: "Decimals", values: void} | {tag: "TotalSupply", values: void} | {tag: "TotalBurned", values: void} | {tag: "MaxSupply", values: void} | {tag: "MaxBalancePerAccount", values: void} | {tag: "ContractUri", values: void} | {tag: "Balance", values: readonly [string]} | {tag: "Allowance", values: readonly [string, string]} | {tag: "Frozen", values: readonly [string]} | {tag: "IsPaused", values: void} | {tag: "Locked", values: void} | {tag: "Initialized", values: void} | {tag: "AuthorizationRequired", values: void} | {tag: "AuthorizationRevocable", values: void} | {tag: "AuthorizedHolder", values: readonly [string]};

/**
 * Typed contract errors.
 * 
 * Only the compliance-node paths use these today. Every cross-contract call
 * into a compliance node is made with the generated `try_` variant so a
 * misbehaving, archived, or non-existent node surfaces as one of these codes
 * instead of letting a raw host error escape and revert the whole invocation
 * with an opaque failure.
 */
export const TokenError = {
  /**
   * The configured compliance node answered `can_trade` with `false`.
   */
  1: {message:"ComplianceRejected"},
  /**
   * The configured compliance node could not be called, or did not return a
   * `bool`. The token fails closed: value-moving operations are blocked
   * until an admin repoints or clears the node.
   */
  2: {message:"ComplianceNodeUnavailable"},
  /**
   * The address passed to `set_compliance_node` did not answer a `can_trade`
   * probe, so it was rejected rather than stored.
   */
  3: {message:"InvalidComplianceNode"}
}


export interface AllowanceValue {
  amount: i128;
  expiration_ledger: u32;
}

export interface Client {
  /**
   * Construct and simulate a burn transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Burn `amount` tokens from `from`. Owner only (standard burn).
   * Refuses to run when the account is frozen so a holder cannot
   * dodge a freeze by destroying tokens.
   */
  burn: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mint `amount` tokens to `to`. Admin only.
   * 
   * Subject to the compliance node: issuance is a value-moving path, so a
   * node that rejects `to` blocks the mint. See [`Self::_check_compliance`]
   * for the scope of the policy.
   */
  mint: ({to, amount}: {to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  name: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pause the contract, halting all state-changing operations. Admin only.
   */
  pause: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  symbol: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Approve `spender` to spend up to `amount` on behalf of `from`.
   * 
   * `expiration_ledger` must be strictly greater than the current ledger
   * sequence. The allowance TTL is derived from this value, so callers
   * must supply a valid future ledger (SEP-41 requirement).
   */
  approve: ({from, spender, amount, expiration_ledger}: {from: string, spender: string, amount: i128, expiration_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  balance: ({id}: {id: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Unpause the contract. Admin only.
   */
  unpause: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Upgrade this contract's WASM code hash in place. Admin only.
   * 
   * Security note: this preserves existing storage and contract address, so
   * new WASM must remain storage-compatible with previous deployments.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a clawback transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Forcefully move `amount` tokens from `from` into the admin balance.
   * Admin only.
   * 
   * Subject to the compliance node: this moves value between two holder
   * addresses, so the node sees it as `from` → admin like any other
   * transfer. See [`Self::_check_compliance`] for the scope of the policy.
   */
  clawback: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a decimals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  decimals: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfer `amount` from `from` to `to`. Caller must be `from`.
   */
  transfer: ({from, to, amount}: {from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  allowance: ({from, spender}: {from: string, spender: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a burn_self transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Burn `amount` tokens from the caller's own balance. Refuses to
   * run when the account is frozen so a holder cannot dodge a freeze
   * by destroying tokens.
   */
  burn_self: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_frozen transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns `true` if the given address is frozen.
   */
  is_frozen: ({addr}: {addr: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

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
   * Construct and simulate a burn_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Forced burn of `amount` tokens from `from`. Admin only.
   */
  burn_admin: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize the token with metadata and an initial supply minted to `admin`.
   * 
   * `authorization_required`: when true, recipients must be explicitly authorized
   * by the admin before they can receive or hold tokens.
   * 
   * `authorization_revocable`: when true, the admin may revoke a holder's
   * authorization, preventing them from receiving further transfers.
   */
  initialize: ({admin, decimal, name, symbol, initial_supply, max_supply, authorization_required, authorization_revocable, compliance_node}: {admin: string, decimal: u32, name: string, symbol: string, initial_supply: i128, max_supply: Option<i128>, authorization_required: boolean, authorization_revocable: boolean, compliance_node: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a max_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  max_supply: (options?: MethodOptions) => Promise<AssembledTransaction<Option<i128>>>

  /**
   * Construct and simulate a mint_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mint `amount` tokens to multiple recipients. Admin only.
   * 
   * Maximum batch size is 100 to stay within Soroban's compute budget.
   * 
   * Each recipient is checked against the compliance node individually, so
   * one rejected recipient reverts the whole batch. Note that a compliance
   * node makes the effective batch limit smaller in practice, because every
   * entry adds a cross-contract call to the invocation's budget.
   */
  mint_batch: ({to, amounts}: {to: Array<string>, amounts: Array<i128>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accept the admin role. Must be called by the pending admin.
   */
  accept_admin: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a contract_uri transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  contract_uri: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a revoke_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permanently revoke the admin role and lock the contract.
   * 
   * After this call:
   * - No further `mint`, `burn_admin`, `freeze`, `unfreeze`,
   * `propose_admin`, `accept_admin`, `pause`, or
   * `unpause` operation can ever succeed.
   * - The Admin storage entry is removed and a `Locked` flag is set.
   * - `is_locked()` returns `true` from then on.
   * 
   * Holders can still `transfer`, `approve`, `transfer_from`, `burn`,
   * and `burn_self`. The token becomes trustless / immutable.
   * 
   * **This action is irreversible.**
   */
  revoke_admin: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a total_burned transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_burned: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a total_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_supply: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a is_authorized transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns `true` if `holder` is authorized to receive tokens.
   * Always returns `true` when `authorization_required` is disabled.
   */
  is_authorized: ({holder}: {holder: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a pending_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the address proposed via `propose_admin` that has not yet
   * accepted the role, or `None` when no two-step transfer is in
   * progress. The entry is written by `propose_admin` and cleared by
   * `accept_admin` / `revoke_admin`, so this getter lets both the
   * outgoing admin and the proposed admin observe the pending state.
   */
  pending_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a propose_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Propose a new admin. Must be called by the current admin.
   * The new admin must call `accept_admin` to finalize the transfer.
   */
  propose_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfer `amount` from `from` to `to` using `spender`'s allowance.
   */
  transfer_from: ({spender, from, to, amount}: {spender: string, from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a freeze_account transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Freeze an account, preventing it from sending tokens. Admin only.
   */
  freeze_account: ({addr}: {addr: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a compliance_node transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the configured compliance node, if any.
   */
  compliance_node: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a authorize_holder transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Grant authorization to `holder`, allowing them to receive tokens when
   * `authorization_required` is enabled. Admin only.
   */
  authorize_holder: ({holder}: {holder: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a unfreeze_account transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Unfreeze a previously frozen account. Admin only.
   */
  unfreeze_account: ({addr}: {addr: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_compliance_node transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set, update, or remove the optional compliance node address.
   * Admin only. Pass `None` to remove the compliance node.
   * 
   * The candidate address is **probed before it is stored**: the contract
   * calls `can_trade` on it once with its own address on both sides and
   * rejects the address with [`TokenError::InvalidComplianceNode`] unless
   * the call succeeds and returns a `bool`. The probe's answer is ignored —
   * only its callability matters. This is what stops the common bricking
   * mistake of pointing the token at a non-contract address, at a contract
   * without `can_trade`, or at the token's own address (which fails as
   * re-entry).
   * 
   * Clearing the node (`None`) never probes anything, so an admin can always
   * recover from a node that has since been archived or has started failing.
   */
  set_compliance_node: ({node}: {node: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_contract_uri transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set or update the contract URI pointing to off-chain metadata JSON.
   * Admin only.
   */
  update_contract_uri: ({uri}: {uri: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a revoke_authorization transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Revoke authorization from `holder`. Only allowed when
   * `authorization_revocable` is enabled. Admin only.
   */
  revoke_authorization: ({holder}: {holder: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a authorization_required transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns `true` if this token requires holders to be authorized before
   * receiving transfers.
   */
  authorization_required: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a authorization_revocable transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns `true` if the admin may revoke holder authorization.
   */
  authorization_revocable: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a max_balance_per_account transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Optional whale protection: max balance per account as a percentage of total supply.
   * 
   * If set to `p`, then for any transfer/mint to a non-admin recipient:
   * `balance(recipient) <= total_supply * p / 100`.
   */
  max_balance_per_account: (options?: MethodOptions) => Promise<AssembledTransaction<Option<u32>>>

  /**
   * Construct and simulate a set_max_balance_per_account transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the optional max balance per account as a percentage of total supply.
   * Admin only.
   * 
   * - `None` disables whale protection
   * - `Some(p)` enables it, where `p` must be between 1 and 100 (inclusive)
   */
  set_max_balance_per_account: ({max_balance_per_account}: {max_balance_per_account: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
      new ContractSpec([ "AAAAAAAAAJ9CdXJuIGBhbW91bnRgIHRva2VucyBmcm9tIGBmcm9tYC4gT3duZXIgb25seSAoc3RhbmRhcmQgYnVybikuClJlZnVzZXMgdG8gcnVuIHdoZW4gdGhlIGFjY291bnQgaXMgZnJvemVuIHNvIGEgaG9sZGVyIGNhbm5vdApkb2RnZSBhIGZyZWV6ZSBieSBkZXN0cm95aW5nIHRva2Vucy4AAAAABGJ1cm4AAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAANVNaW50IGBhbW91bnRgIHRva2VucyB0byBgdG9gLiBBZG1pbiBvbmx5LgoKU3ViamVjdCB0byB0aGUgY29tcGxpYW5jZSBub2RlOiBpc3N1YW5jZSBpcyBhIHZhbHVlLW1vdmluZyBwYXRoLCBzbyBhCm5vZGUgdGhhdCByZWplY3RzIGB0b2AgYmxvY2tzIHRoZSBtaW50LiBTZWUgW2BTZWxmOjpfY2hlY2tfY29tcGxpYW5jZWBdCmZvciB0aGUgc2NvcGUgb2YgdGhlIHBvbGljeS4AAAAAAAAEbWludAAAAAIAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAAAAAAAEbmFtZQAAAAAAAAABAAAAEA==",
        "AAAAAAAAAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAEZQYXVzZSB0aGUgY29udHJhY3QsIGhhbHRpbmcgYWxsIHN0YXRlLWNoYW5naW5nIG9wZXJhdGlvbnMuIEFkbWluIG9ubHkuAAAAAAAFcGF1c2UAAAAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAAGc3ltYm9sAAAAAAAAAAAAAQAAABA=",
        "AAAAAAAAAP9BcHByb3ZlIGBzcGVuZGVyYCB0byBzcGVuZCB1cCB0byBgYW1vdW50YCBvbiBiZWhhbGYgb2YgYGZyb21gLgoKYGV4cGlyYXRpb25fbGVkZ2VyYCBtdXN0IGJlIHN0cmljdGx5IGdyZWF0ZXIgdGhhbiB0aGUgY3VycmVudCBsZWRnZXIKc2VxdWVuY2UuIFRoZSBhbGxvd2FuY2UgVFRMIGlzIGRlcml2ZWQgZnJvbSB0aGlzIHZhbHVlLCBzbyBjYWxsZXJzCm11c3Qgc3VwcGx5IGEgdmFsaWQgZnV0dXJlIGxlZGdlciAoU0VQLTQxIHJlcXVpcmVtZW50KS4AAAAAB2FwcHJvdmUAAAAABAAAAAAAAAAEZnJvbQAAABMAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAABFleHBpcmF0aW9uX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAAHYmFsYW5jZQAAAAABAAAAAAAAAAJpZAAAAAAAEwAAAAEAAAAL",
        "AAAAAAAAACFVbnBhdXNlIHRoZSBjb250cmFjdC4gQWRtaW4gb25seS4AAAAAAAAHdW5wYXVzZQAAAAAAAAAAAA==",
        "AAAAAAAAAMhVcGdyYWRlIHRoaXMgY29udHJhY3QncyBXQVNNIGNvZGUgaGFzaCBpbiBwbGFjZS4gQWRtaW4gb25seS4KClNlY3VyaXR5IG5vdGU6IHRoaXMgcHJlc2VydmVzIGV4aXN0aW5nIHN0b3JhZ2UgYW5kIGNvbnRyYWN0IGFkZHJlc3MsIHNvCm5ldyBXQVNNIG11c3QgcmVtYWluIHN0b3JhZ2UtY29tcGF0aWJsZSB3aXRoIHByZXZpb3VzIGRlcGxveW1lbnRzLgAAAAd1cGdyYWRlAAAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAA=",
        "AAAAAAAAAR1Gb3JjZWZ1bGx5IG1vdmUgYGFtb3VudGAgdG9rZW5zIGZyb20gYGZyb21gIGludG8gdGhlIGFkbWluIGJhbGFuY2UuCkFkbWluIG9ubHkuCgpTdWJqZWN0IHRvIHRoZSBjb21wbGlhbmNlIG5vZGU6IHRoaXMgbW92ZXMgdmFsdWUgYmV0d2VlbiB0d28gaG9sZGVyCmFkZHJlc3Nlcywgc28gdGhlIG5vZGUgc2VlcyBpdCBhcyBgZnJvbWAg4oaSIGFkbWluIGxpa2UgYW55IG90aGVyCnRyYW5zZmVyLiBTZWUgW2BTZWxmOjpfY2hlY2tfY29tcGxpYW5jZWBdIGZvciB0aGUgc2NvcGUgb2YgdGhlIHBvbGljeS4AAAAAAAAIY2xhd2JhY2sAAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAAAAAAAIZGVjaW1hbHMAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAD1UcmFuc2ZlciBgYW1vdW50YCBmcm9tIGBmcm9tYCB0byBgdG9gLiBDYWxsZXIgbXVzdCBiZSBgZnJvbWAuAAAAAAAACHRyYW5zZmVyAAAAAwAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAAAAAAAJYWxsb3dhbmNlAAAAAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAJVCdXJuIGBhbW91bnRgIHRva2VucyBmcm9tIHRoZSBjYWxsZXIncyBvd24gYmFsYW5jZS4gUmVmdXNlcyB0bwpydW4gd2hlbiB0aGUgYWNjb3VudCBpcyBmcm96ZW4gc28gYSBob2xkZXIgY2Fubm90IGRvZGdlIGEgZnJlZXplCmJ5IGRlc3Ryb3lpbmcgdG9rZW5zLgAAAAAAAAlidXJuX3NlbGYAAAAAAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAC5SZXR1cm5zIGB0cnVlYCBpZiB0aGUgZ2l2ZW4gYWRkcmVzcyBpcyBmcm96ZW4uAAAAAAAJaXNfZnJvemVuAAAAAAAAAQAAAAAAAAAEYWRkcgAAABMAAAABAAAAAQ==",
        "AAAAAAAAAGtSZXR1cm5zIGB0cnVlYCBvbmNlIGByZXZva2VfYWRtaW5gIGhhcyBiZWVuIGNhbGxlZC4gT25jZSBsb2NrZWQsIG5vCmFkbWluIG9wZXJhdGlvbiBjYW4gZXZlciBzdWNjZWVkIGFnYWluLgAAAAAJaXNfbG9ja2VkAAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAADNSZXR1cm5zIGB0cnVlYCBpZiB0aGUgY29udHJhY3QgaXMgY3VycmVudGx5IHBhdXNlZC4AAAAACWlzX3BhdXNlZAAAAAAAAAAAAAABAAAAAQ==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAFAAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAMUGVuZGluZ0FkbWluAAAAAAAAAAAAAAAOQ29tcGxpYW5jZU5vZGUAAAAAAAAAAAAAAAAABE5hbWUAAAAAAAAAAAAAAAZTeW1ib2wAAAAAAAAAAAAAAAAACERlY2ltYWxzAAAAAAAAAAAAAAALVG90YWxTdXBwbHkAAAAAAAAAAAAAAAALVG90YWxCdXJuZWQAAAAAAAAAAAAAAAAJTWF4U3VwcGx5AAAAAAAAAAAAAAAAAAAUTWF4QmFsYW5jZVBlckFjY291bnQAAAAAAAAAAAAAAAtDb250cmFjdFVyaQAAAAABAAAAAAAAAAdCYWxhbmNlAAAAAAEAAAATAAAAAQAAAAAAAAAJQWxsb3dhbmNlAAAAAAAAAgAAABMAAAATAAAAAQAAAAAAAAAGRnJvemVuAAAAAAABAAAAEwAAAAAAAAAAAAAACElzUGF1c2VkAAAAAAAAALtTZXQgdG8gYHRydWVgIGFmdGVyIGByZXZva2VfYWRtaW5gIGlzIGNhbGxlZC4gT25jZSBsb2NrZWQsIG5vIGFkbWluCm9wZXJhdGlvbiAobWludCwgYnVybl9hZG1pbiwgZnJlZXplLCBwcm9wb3NlX2FkbWluKSBjYW4KZXZlciBzdWNjZWVkIGFnYWluIOKAlCB0aGUgdG9rZW4gYmVjb21lcyBlZmZlY3RpdmVseSBpbW11dGFibGUuAAAAAAZMb2NrZWQAAAAAAAAAAADPU2V0IG9uY2Ugb24gdGhlIGZpcnN0IHN1Y2Nlc3NmdWwgYGluaXRpYWxpemVgIGNhbGwgYW5kIG5ldmVyIHJlbW92ZWQuClVubGlrZSBgQWRtaW5gICh3aGljaCBgcmV2b2tlX2FkbWluYCBkZWxldGVzKSwgdGhpcyBpcyB0aGUgc29sZQpyZS1pbml0aWFsaXphdGlvbiBndWFyZCwgc28gcmV2b2tpbmcgYWRtaW4gY2FuIG5ldmVyIHJlb3BlbiBgaW5pdGlhbGl6ZWAuAAAAAAtJbml0aWFsaXplZAAAAAAAAAAAAAAAABVBdXRob3JpemF0aW9uUmVxdWlyZWQAAAAAAAAAAAAAAAAAABZBdXRob3JpemF0aW9uUmV2b2NhYmxlAAAAAAABAAAAAAAAABBBdXRob3JpemVkSG9sZGVyAAAAAQAAABM=",
        "AAAAAAAAADdGb3JjZWQgYnVybiBvZiBgYW1vdW50YCB0b2tlbnMgZnJvbSBgZnJvbWAuIEFkbWluIG9ubHkuAAAAAApidXJuX2FkbWluAAAAAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAVdJbml0aWFsaXplIHRoZSB0b2tlbiB3aXRoIG1ldGFkYXRhIGFuZCBhbiBpbml0aWFsIHN1cHBseSBtaW50ZWQgdG8gYGFkbWluYC4KCmBhdXRob3JpemF0aW9uX3JlcXVpcmVkYDogd2hlbiB0cnVlLCByZWNpcGllbnRzIG11c3QgYmUgZXhwbGljaXRseSBhdXRob3JpemVkCmJ5IHRoZSBhZG1pbiBiZWZvcmUgdGhleSBjYW4gcmVjZWl2ZSBvciBob2xkIHRva2Vucy4KCmBhdXRob3JpemF0aW9uX3Jldm9jYWJsZWA6IHdoZW4gdHJ1ZSwgdGhlIGFkbWluIG1heSByZXZva2UgYSBob2xkZXIncwphdXRob3JpemF0aW9uLCBwcmV2ZW50aW5nIHRoZW0gZnJvbSByZWNlaXZpbmcgZnVydGhlciB0cmFuc2ZlcnMuAAAAAAppbml0aWFsaXplAAAAAAAJAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAB2RlY2ltYWwAAAAABAAAAAAAAAAEbmFtZQAAABAAAAAAAAAABnN5bWJvbAAAAAAAEAAAAAAAAAAOaW5pdGlhbF9zdXBwbHkAAAAAAAsAAAAAAAAACm1heF9zdXBwbHkAAAAAA+gAAAALAAAAAAAAABZhdXRob3JpemF0aW9uX3JlcXVpcmVkAAAAAAABAAAAAAAAABdhdXRob3JpemF0aW9uX3Jldm9jYWJsZQAAAAABAAAAAAAAAA9jb21wbGlhbmNlX25vZGUAAAAD6AAAABMAAAAA",
        "AAAAAAAAAAAAAAAKbWF4X3N1cHBseQAAAAAAAAAAAAEAAAPoAAAACw==",
        "AAAAAAAAAZBNaW50IGBhbW91bnRgIHRva2VucyB0byBtdWx0aXBsZSByZWNpcGllbnRzLiBBZG1pbiBvbmx5LgoKTWF4aW11bSBiYXRjaCBzaXplIGlzIDEwMCB0byBzdGF5IHdpdGhpbiBTb3JvYmFuJ3MgY29tcHV0ZSBidWRnZXQuCgpFYWNoIHJlY2lwaWVudCBpcyBjaGVja2VkIGFnYWluc3QgdGhlIGNvbXBsaWFuY2Ugbm9kZSBpbmRpdmlkdWFsbHksIHNvCm9uZSByZWplY3RlZCByZWNpcGllbnQgcmV2ZXJ0cyB0aGUgd2hvbGUgYmF0Y2guIE5vdGUgdGhhdCBhIGNvbXBsaWFuY2UKbm9kZSBtYWtlcyB0aGUgZWZmZWN0aXZlIGJhdGNoIGxpbWl0IHNtYWxsZXIgaW4gcHJhY3RpY2UsIGJlY2F1c2UgZXZlcnkKZW50cnkgYWRkcyBhIGNyb3NzLWNvbnRyYWN0IGNhbGwgdG8gdGhlIGludm9jYXRpb24ncyBidWRnZXQuAAAACm1pbnRfYmF0Y2gAAAAAAAIAAAAAAAAAAnRvAAAAAAPqAAAAEwAAAAAAAAAHYW1vdW50cwAAAAPqAAAACwAAAAA=",
        "AAAAAAAAADtBY2NlcHQgdGhlIGFkbWluIHJvbGUuIE11c3QgYmUgY2FsbGVkIGJ5IHRoZSBwZW5kaW5nIGFkbWluLgAAAAAMYWNjZXB0X2FkbWluAAAAAAAAAAA=",
        "AAAAAAAAAAAAAAAMY29udHJhY3RfdXJpAAAAAAAAAAEAAAAQ",
        "AAAAAAAAAeNQZXJtYW5lbnRseSByZXZva2UgdGhlIGFkbWluIHJvbGUgYW5kIGxvY2sgdGhlIGNvbnRyYWN0LgoKQWZ0ZXIgdGhpcyBjYWxsOgotIE5vIGZ1cnRoZXIgYG1pbnRgLCBgYnVybl9hZG1pbmAsIGBmcmVlemVgLCBgdW5mcmVlemVgLApgcHJvcG9zZV9hZG1pbmAsIGBhY2NlcHRfYWRtaW5gLCBgcGF1c2VgLCBvcgpgdW5wYXVzZWAgb3BlcmF0aW9uIGNhbiBldmVyIHN1Y2NlZWQuCi0gVGhlIEFkbWluIHN0b3JhZ2UgZW50cnkgaXMgcmVtb3ZlZCBhbmQgYSBgTG9ja2VkYCBmbGFnIGlzIHNldC4KLSBgaXNfbG9ja2VkKClgIHJldHVybnMgYHRydWVgIGZyb20gdGhlbiBvbi4KCkhvbGRlcnMgY2FuIHN0aWxsIGB0cmFuc2ZlcmAsIGBhcHByb3ZlYCwgYHRyYW5zZmVyX2Zyb21gLCBgYnVybmAsCmFuZCBgYnVybl9zZWxmYC4gVGhlIHRva2VuIGJlY29tZXMgdHJ1c3RsZXNzIC8gaW1tdXRhYmxlLgoKKipUaGlzIGFjdGlvbiBpcyBpcnJldmVyc2libGUuKioAAAAADHJldm9rZV9hZG1pbgAAAAAAAAAA",
        "AAAAAAAAAAAAAAAMdG90YWxfYnVybmVkAAAAAAAAAAEAAAAL",
        "AAAAAAAAAAAAAAAMdG90YWxfc3VwcGx5AAAAAAAAAAEAAAAL",
        "AAAABAAAAVVUeXBlZCBjb250cmFjdCBlcnJvcnMuCgpPbmx5IHRoZSBjb21wbGlhbmNlLW5vZGUgcGF0aHMgdXNlIHRoZXNlIHRvZGF5LiBFdmVyeSBjcm9zcy1jb250cmFjdCBjYWxsCmludG8gYSBjb21wbGlhbmNlIG5vZGUgaXMgbWFkZSB3aXRoIHRoZSBnZW5lcmF0ZWQgYHRyeV9gIHZhcmlhbnQgc28gYQptaXNiZWhhdmluZywgYXJjaGl2ZWQsIG9yIG5vbi1leGlzdGVudCBub2RlIHN1cmZhY2VzIGFzIG9uZSBvZiB0aGVzZSBjb2RlcwppbnN0ZWFkIG9mIGxldHRpbmcgYSByYXcgaG9zdCBlcnJvciBlc2NhcGUgYW5kIHJldmVydCB0aGUgd2hvbGUgaW52b2NhdGlvbgp3aXRoIGFuIG9wYXF1ZSBmYWlsdXJlLgAAAAAAAAAAAAAKVG9rZW5FcnJvcgAAAAAAAwAAAEFUaGUgY29uZmlndXJlZCBjb21wbGlhbmNlIG5vZGUgYW5zd2VyZWQgYGNhbl90cmFkZWAgd2l0aCBgZmFsc2VgLgAAAAAAABJDb21wbGlhbmNlUmVqZWN0ZWQAAAAAAAEAAAC3VGhlIGNvbmZpZ3VyZWQgY29tcGxpYW5jZSBub2RlIGNvdWxkIG5vdCBiZSBjYWxsZWQsIG9yIGRpZCBub3QgcmV0dXJuIGEKYGJvb2xgLiBUaGUgdG9rZW4gZmFpbHMgY2xvc2VkOiB2YWx1ZS1tb3Zpbmcgb3BlcmF0aW9ucyBhcmUgYmxvY2tlZAp1bnRpbCBhbiBhZG1pbiByZXBvaW50cyBvciBjbGVhcnMgdGhlIG5vZGUuAAAAABlDb21wbGlhbmNlTm9kZVVuYXZhaWxhYmxlAAAAAAAAAgAAAHZUaGUgYWRkcmVzcyBwYXNzZWQgdG8gYHNldF9jb21wbGlhbmNlX25vZGVgIGRpZCBub3QgYW5zd2VyIGEgYGNhbl90cmFkZWAKcHJvYmUsIHNvIGl0IHdhcyByZWplY3RlZCByYXRoZXIgdGhhbiBzdG9yZWQuAAAAAAAVSW52YWxpZENvbXBsaWFuY2VOb2RlAAAAAAAAAw==",
        "AAAAAAAAAHxSZXR1cm5zIGB0cnVlYCBpZiBgaG9sZGVyYCBpcyBhdXRob3JpemVkIHRvIHJlY2VpdmUgdG9rZW5zLgpBbHdheXMgcmV0dXJucyBgdHJ1ZWAgd2hlbiBgYXV0aG9yaXphdGlvbl9yZXF1aXJlZGAgaXMgZGlzYWJsZWQuAAAADWlzX2F1dGhvcml6ZWQAAAAAAAABAAAAAAAAAAZob2xkZXIAAAAAABMAAAABAAAAAQ==",
        "AAAAAAAAAT5SZXR1cm5zIHRoZSBhZGRyZXNzIHByb3Bvc2VkIHZpYSBgcHJvcG9zZV9hZG1pbmAgdGhhdCBoYXMgbm90IHlldAphY2NlcHRlZCB0aGUgcm9sZSwgb3IgYE5vbmVgIHdoZW4gbm8gdHdvLXN0ZXAgdHJhbnNmZXIgaXMgaW4KcHJvZ3Jlc3MuIFRoZSBlbnRyeSBpcyB3cml0dGVuIGJ5IGBwcm9wb3NlX2FkbWluYCBhbmQgY2xlYXJlZCBieQpgYWNjZXB0X2FkbWluYCAvIGByZXZva2VfYWRtaW5gLCBzbyB0aGlzIGdldHRlciBsZXRzIGJvdGggdGhlCm91dGdvaW5nIGFkbWluIGFuZCB0aGUgcHJvcG9zZWQgYWRtaW4gb2JzZXJ2ZSB0aGUgcGVuZGluZyBzdGF0ZS4AAAAAAA1wZW5kaW5nX2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAHpQcm9wb3NlIGEgbmV3IGFkbWluLiBNdXN0IGJlIGNhbGxlZCBieSB0aGUgY3VycmVudCBhZG1pbi4KVGhlIG5ldyBhZG1pbiBtdXN0IGNhbGwgYGFjY2VwdF9hZG1pbmAgdG8gZmluYWxpemUgdGhlIHRyYW5zZmVyLgAAAAAADXByb3Bvc2VfYWRtaW4AAAAAAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAA==",
        "AAAAAAAAAEJUcmFuc2ZlciBgYW1vdW50YCBmcm9tIGBmcm9tYCB0byBgdG9gIHVzaW5nIGBzcGVuZGVyYCdzIGFsbG93YW5jZS4AAAAAAA10cmFuc2Zlcl9mcm9tAAAAAAAABAAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
        "AAAAAAAAAEFGcmVlemUgYW4gYWNjb3VudCwgcHJldmVudGluZyBpdCBmcm9tIHNlbmRpbmcgdG9rZW5zLiBBZG1pbiBvbmx5LgAAAAAAAA5mcmVlemVfYWNjb3VudAAAAAAAAQAAAAAAAAAEYWRkcgAAABMAAAAA",
        "AAAAAAAAAC9SZXR1cm5zIHRoZSBjb25maWd1cmVkIGNvbXBsaWFuY2Ugbm9kZSwgaWYgYW55LgAAAAAPY29tcGxpYW5jZV9ub2RlAAAAAAAAAAABAAAD6AAAABM=",
        "AAAAAAAAAHZHcmFudCBhdXRob3JpemF0aW9uIHRvIGBob2xkZXJgLCBhbGxvd2luZyB0aGVtIHRvIHJlY2VpdmUgdG9rZW5zIHdoZW4KYGF1dGhvcml6YXRpb25fcmVxdWlyZWRgIGlzIGVuYWJsZWQuIEFkbWluIG9ubHkuAAAAAAAQYXV0aG9yaXplX2hvbGRlcgAAAAEAAAAAAAAABmhvbGRlcgAAAAAAEwAAAAA=",
        "AAAAAAAAADFVbmZyZWV6ZSBhIHByZXZpb3VzbHkgZnJvemVuIGFjY291bnQuIEFkbWluIG9ubHkuAAAAAAAAEHVuZnJlZXplX2FjY291bnQAAAABAAAAAAAAAARhZGRyAAAAEwAAAAA=",
        "AAAAAQAAAAAAAAAAAAAADkFsbG93YW5jZVZhbHVlAAAAAAACAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyYXRpb25fbGVkZ2VyAAAAAAAABA==",
        "AAAAAAAAAvtTZXQsIHVwZGF0ZSwgb3IgcmVtb3ZlIHRoZSBvcHRpb25hbCBjb21wbGlhbmNlIG5vZGUgYWRkcmVzcy4KQWRtaW4gb25seS4gUGFzcyBgTm9uZWAgdG8gcmVtb3ZlIHRoZSBjb21wbGlhbmNlIG5vZGUuCgpUaGUgY2FuZGlkYXRlIGFkZHJlc3MgaXMgKipwcm9iZWQgYmVmb3JlIGl0IGlzIHN0b3JlZCoqOiB0aGUgY29udHJhY3QKY2FsbHMgYGNhbl90cmFkZWAgb24gaXQgb25jZSB3aXRoIGl0cyBvd24gYWRkcmVzcyBvbiBib3RoIHNpZGVzIGFuZApyZWplY3RzIHRoZSBhZGRyZXNzIHdpdGggW2BUb2tlbkVycm9yOjpJbnZhbGlkQ29tcGxpYW5jZU5vZGVgXSB1bmxlc3MKdGhlIGNhbGwgc3VjY2VlZHMgYW5kIHJldHVybnMgYSBgYm9vbGAuIFRoZSBwcm9iZSdzIGFuc3dlciBpcyBpZ25vcmVkIOKAlApvbmx5IGl0cyBjYWxsYWJpbGl0eSBtYXR0ZXJzLiBUaGlzIGlzIHdoYXQgc3RvcHMgdGhlIGNvbW1vbiBicmlja2luZwptaXN0YWtlIG9mIHBvaW50aW5nIHRoZSB0b2tlbiBhdCBhIG5vbi1jb250cmFjdCBhZGRyZXNzLCBhdCBhIGNvbnRyYWN0CndpdGhvdXQgYGNhbl90cmFkZWAsIG9yIGF0IHRoZSB0b2tlbidzIG93biBhZGRyZXNzICh3aGljaCBmYWlscyBhcwpyZS1lbnRyeSkuCgpDbGVhcmluZyB0aGUgbm9kZSAoYE5vbmVgKSBuZXZlciBwcm9iZXMgYW55dGhpbmcsIHNvIGFuIGFkbWluIGNhbiBhbHdheXMKcmVjb3ZlciBmcm9tIGEgbm9kZSB0aGF0IGhhcyBzaW5jZSBiZWVuIGFyY2hpdmVkIG9yIGhhcyBzdGFydGVkIGZhaWxpbmcuAAAAABNzZXRfY29tcGxpYW5jZV9ub2RlAAAAAAEAAAAAAAAABG5vZGUAAAPoAAAAEwAAAAA=",
        "AAAAAAAAAE9TZXQgb3IgdXBkYXRlIHRoZSBjb250cmFjdCBVUkkgcG9pbnRpbmcgdG8gb2ZmLWNoYWluIG1ldGFkYXRhIEpTT04uCkFkbWluIG9ubHkuAAAAABN1cGRhdGVfY29udHJhY3RfdXJpAAAAAAEAAAAAAAAAA3VyaQAAAAAQAAAAAA==",
        "AAAAAAAAAGdSZXZva2UgYXV0aG9yaXphdGlvbiBmcm9tIGBob2xkZXJgLiBPbmx5IGFsbG93ZWQgd2hlbgpgYXV0aG9yaXphdGlvbl9yZXZvY2FibGVgIGlzIGVuYWJsZWQuIEFkbWluIG9ubHkuAAAAABRyZXZva2VfYXV0aG9yaXphdGlvbgAAAAEAAAAAAAAABmhvbGRlcgAAAAAAEwAAAAA=",
        "AAAAAAAAAFpSZXR1cm5zIGB0cnVlYCBpZiB0aGlzIHRva2VuIHJlcXVpcmVzIGhvbGRlcnMgdG8gYmUgYXV0aG9yaXplZCBiZWZvcmUKcmVjZWl2aW5nIHRyYW5zZmVycy4AAAAAABZhdXRob3JpemF0aW9uX3JlcXVpcmVkAAAAAAAAAAAAAQAAAAE=",
        "AAAAAAAAADxSZXR1cm5zIGB0cnVlYCBpZiB0aGUgYWRtaW4gbWF5IHJldm9rZSBob2xkZXIgYXV0aG9yaXphdGlvbi4AAAAXYXV0aG9yaXphdGlvbl9yZXZvY2FibGUAAAAAAAAAAAEAAAAB",
        "AAAAAAAAAMhPcHRpb25hbCB3aGFsZSBwcm90ZWN0aW9uOiBtYXggYmFsYW5jZSBwZXIgYWNjb3VudCBhcyBhIHBlcmNlbnRhZ2Ugb2YgdG90YWwgc3VwcGx5LgoKSWYgc2V0IHRvIGBwYCwgdGhlbiBmb3IgYW55IHRyYW5zZmVyL21pbnQgdG8gYSBub24tYWRtaW4gcmVjaXBpZW50OgpgYmFsYW5jZShyZWNpcGllbnQpIDw9IHRvdGFsX3N1cHBseSAqIHAgLyAxMDBgLgAAABdtYXhfYmFsYW5jZV9wZXJfYWNjb3VudAAAAAAAAAAAAQAAA+gAAAAE",
        "AAAAAAAAAMFTZXQgdGhlIG9wdGlvbmFsIG1heCBiYWxhbmNlIHBlciBhY2NvdW50IGFzIGEgcGVyY2VudGFnZSBvZiB0b3RhbCBzdXBwbHkuCkFkbWluIG9ubHkuCgotIGBOb25lYCBkaXNhYmxlcyB3aGFsZSBwcm90ZWN0aW9uCi0gYFNvbWUocClgIGVuYWJsZXMgaXQsIHdoZXJlIGBwYCBtdXN0IGJlIGJldHdlZW4gMSBhbmQgMTAwIChpbmNsdXNpdmUpAAAAAAAAG3NldF9tYXhfYmFsYW5jZV9wZXJfYWNjb3VudAAAAAABAAAAAAAAABdtYXhfYmFsYW5jZV9wZXJfYWNjb3VudAAAAAPoAAAABAAAAAA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    burn: this.txFromJSON<null>,
        mint: this.txFromJSON<null>,
        name: this.txFromJSON<string>,
        admin: this.txFromJSON<string>,
        pause: this.txFromJSON<null>,
        symbol: this.txFromJSON<string>,
        approve: this.txFromJSON<null>,
        balance: this.txFromJSON<i128>,
        unpause: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        clawback: this.txFromJSON<null>,
        decimals: this.txFromJSON<u32>,
        transfer: this.txFromJSON<null>,
        allowance: this.txFromJSON<i128>,
        burn_self: this.txFromJSON<null>,
        is_frozen: this.txFromJSON<boolean>,
        is_locked: this.txFromJSON<boolean>,
        is_paused: this.txFromJSON<boolean>,
        burn_admin: this.txFromJSON<null>,
        initialize: this.txFromJSON<null>,
        max_supply: this.txFromJSON<Option<i128>>,
        mint_batch: this.txFromJSON<null>,
        accept_admin: this.txFromJSON<null>,
        contract_uri: this.txFromJSON<string>,
        revoke_admin: this.txFromJSON<null>,
        total_burned: this.txFromJSON<i128>,
        total_supply: this.txFromJSON<i128>,
        is_authorized: this.txFromJSON<boolean>,
        pending_admin: this.txFromJSON<Option<string>>,
        propose_admin: this.txFromJSON<null>,
        transfer_from: this.txFromJSON<null>,
        freeze_account: this.txFromJSON<null>,
        compliance_node: this.txFromJSON<Option<string>>,
        authorize_holder: this.txFromJSON<null>,
        unfreeze_account: this.txFromJSON<null>,
        set_compliance_node: this.txFromJSON<null>,
        update_contract_uri: this.txFromJSON<null>,
        revoke_authorization: this.txFromJSON<null>,
        authorization_required: this.txFromJSON<boolean>,
        authorization_revocable: this.txFromJSON<boolean>,
        max_balance_per_account: this.txFromJSON<Option<u32>>,
        set_max_balance_per_account: this.txFromJSON<null>
  }
}