# Event Schema

All state-changing operations in the launchpad's contracts emit structured
Soroban events. Each event uses `env.events().publish(topics, data)` where
**topics** is a tuple whose first element is the event name (a `symbol_short!`
value) and **data** carries the payload.

This file is generated from `docs/events.json` by
`scripts/generate_events_doc.py` — edit that file and re-run the script rather
than editing this table by hand. `scripts/generate_events_doc.py --check` and
each contract's `test_emitted_topics_match_checked_in_fixture` unit test both
fail CI if this ever drifts from the contract source again (see issue #340).

---

## Token Contract

| Function | Topic 0 | Topic 1 | Topic 2 | Data |
|---|---|---|---|---|
| `initialize` | `init` | — | — | admin: Address |
| `mint`, `mint_batch`, `initialize (when initial_supply > 0)` | `mint` | `to: Address` | — | amount: i128 |
| `burn`, `burn_admin`, `burn_self` | `burn` | `from: Address` | — | amount: i128 |
| `clawback` | `clawback` | `from: Address` | — | amount: i128 |
| `transfer`, `transfer_from`, `clawback` | `transfer` | `from: Address` | `to: Address` | amount: i128 |
| `approve` | `approve` | `from: Address` | `spender: Address` | amount: i128 |
| `revoke_admin` | `revoked` | — | — | bool (always true) |
| `freeze_account` | `freeze` | `addr: Address` | — | () |
| `unfreeze_account` | `unfreeze` | `addr: Address` | — | () |
| `pause` | `pause` | — | — | () |
| `unpause` | `unpause` | — | — | () |
| `authorize_holder` | `authorize` | `holder: Address` | — | () |
| `revoke_authorization` | `rev_auth` | `holder: Address` | — | () |
| `upgrade` | `upgrade` | — | — | new_wasm_hash: BytesN<32> |
| `set_max_balance_per_account` | `set_max_b` | — | — | Option<u32> |
| `set_compliance_node` | `set_cnode` | — | — | Option<Address> |
| `propose_admin` | `prop_adm` | `current_admin: Address` | `new_admin: Address` | () |
| `cancel_admin_proposal` | `cncl_adm` | — | — | () |
| `accept_admin` | `set_admin` | `old_admin: Address` | `new_admin: Address` | () |
| `update_contract_uri` | `upd_uri` | — | — | uri: String |
| `set_authorization_required` | `set_areq` | — | — | required: bool |
| `renounce_authorization_revocable` | `rvk_rvc` | — | — | () |

> clawback also emits a `transfer` event (from the internal `_transfer` helper it calls) in the same transaction, so a claw-backed balance change shows up as both events.

> transfer_from re-uses this event because the observable balance change is identical to a direct transfer; the allowance deduction is visible through the `allowance` getter instead.

---

## Vesting Contract

| Function | Topic 0 | Topic 1 | Data |
|---|---|---|---|
| `initialize` | `init` | — | (admin: Address, token_contract: Address) |
| `propose_admin` | `prop_adm` | — | new_admin: Address |
| `accept_admin` | `acc_adm` | — | new_admin: Address |
| `create_schedule`, `create_schedules_batch (once per schedule)` | `create` | `recipient: Address` | total_amount: i128 |
| `create_schedules_batch` | `batch` | — | (created_count: u32, total_amount: i128) |
| `release` | `release` | `recipient: Address` | releasable: i128 |
| `revoke` | `revoke` | `recipient: Address` | (releasable: i128, unvested: i128) |
| `extend_cliff` | `clf_ext` | `recipient: Address` | (old_cliff: u32, new_cliff: u32) |
| `pause` | `pause` | — | () |
| `unpause` | `unpause` | — | () |
| `prune_recipient` | `prune` | — | recipient: Address |
| `upgrade` | `upgrade` | — | new_wasm_hash: BytesN<32> |
| `revoke_admin` | `revoked` | — | bool (always true) |

> Emitted once per call in addition to a `create` event per schedule in the batch.

> Removes a fully-settled recipient from the enumeration index only; it does not touch the recipient's own schedules.

---

## Airdrop Contract

| Function | Topic 0 | Topic 1 | Topic 2 | Data |
|---|---|---|---|---|
| `initialize` | `init` | `admin: Address` | — | (token: Address, merkle_root: BytesN<32>, deadline_ledger: u32) |
| `propose_admin` | `prop_adm` | `current_admin: Address` | `new_admin: Address` | () |
| `cancel_admin_proposal` | `cncl_adm` | — | — | () |
| `accept_admin` | `set_admin` | `old_admin: Address` | `new_admin: Address` | () |
| `revoke_admin` | `revoked` | — | — | bool (always true) |
| `pause` | `pause` | — | — | () |
| `unpause` | `unpause` | — | — | () |
| `upgrade` | `upgrade` | — | — | new_wasm_hash: BytesN<32> |
| `fund` | `fund` | `from: Address` | — | amount: i128 |
| `claim` | `claim` | `recipient: Address` | — | amount: i128 |
| `reclaim_unclaimed` | `reclaim` | `admin: Address` | — | amount: i128 |
| `extend_deadline` | `extend` | `admin: Address` | — | (old_deadline: u32, new_deadline: u32) |

> Irreversible. On the airdrop call `reclaim_unclaimed` first — `reclaim_unclaimed` needs an admin to sweep to, so revoking before it strands whatever is still unclaimed.

> claim also emits the token contract's own `transfer` event in the same transaction, so a claimed allocation shows up as both events.

---

## Factory Contract

| Function | Topic 0 | Topic 1 | Topic 2 | Data |
|---|---|---|---|---|
| `initialize` | `init` | — | — | admin: Address |
| `propose_token_wasm_hash` | `wasm_chg` | `current: BytesN<32>` | `proposed: BytesN<32>` | effective_ledger: u32 |
| `cancel_token_wasm_proposal` | `cncl_wasm` | — | — | () |
| `accept_token_wasm_hash` | `set_wasm` | — | — | wasm_hash: BytesN<32> |
| `deploy_token` | `deploy` | `deployer: Address` | `salt: BytesN<32>` | token_address: Address |
| `propose_admin` | `prop_adm` | `current_admin: Address` | `new_admin: Address` | () |
| `cancel_admin_proposal` | `cncl_adm` | — | — | () |
| `accept_admin` | `set_admin` | `old_admin: Address` | `new_admin: Address` | () |
| `revoke_admin` | `revoked` | — | — | bool (always true) |
| `pause` | `pause` | — | — | () |
| `unpause` | `unpause` | — | — | () |
| `upgrade` | `upgrade` | — | — | new_wasm_hash: BytesN<32> |

> The change notification for the hash `deploy_token` uses: `current` is still in force (all-zeros when the factory has never had one), `proposed` is the replacement, and it becomes acceptable at ledger `effective_ledger` — `TOKEN_WASM_CHANGE_DELAY_LEDGERS` (six hours) after the proposal. A watcher seeing this knows a rotation is in flight and has the whole delay to object, up to `cancel_token_wasm_proposal`.

> Emitted only once the delay has elapsed and the hash actually changed; from this point every `deploy_token` deploys `wasm_hash`.

> Irreversible. `deploy_token` keeps working against the already-recorded WASM hash — revoking freezes the factory's configuration, not the deployment service.

---

### Conventions

- Topic 0 is always the event name as a `symbol_short!` value.
- Subsequent topics carry the primary addresses involved in the operation.
- The data slot carries amounts or composite tuples when multiple values are
  relevant (e.g. the vesting `init` event).
- All amounts are `i128` and follow the token's decimal precision.
