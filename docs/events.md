# Event Schema

All state-changing operations in the token and vesting contracts emit structured
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
| `authorize_holder`, `revoke_authorization` | `auth` | — | — | (holder: Address, authorized: bool) |
| `upgrade` | `upgrade` | — | — | new_wasm_hash: BytesN<32> |
| `set_max_balance_per_account` | `set_max_b` | — | — | Option<u32> |
| `set_compliance_node` | `set_cnode` | — | — | Option<Address> |

> clawback also emits a `transfer` event (from the internal `_transfer` helper it calls) in the same transaction, so a claw-backed balance change shows up as both events.

> transfer_from re-uses this event because the observable balance change is identical to a direct transfer; the allowance deduction is visible through the `allowance` getter instead.

> Both functions publish under the same `auth` topic; the boolean in the data payload distinguishes granting authorization from revoking it.

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

> Emitted once per call in addition to a `create` event per schedule in the batch.

> Removes a fully-settled recipient from the enumeration index only; it does not touch the recipient's own schedules.

---

### Conventions

- Topic 0 is always the event name as a `symbol_short!` value.
- Subsequent topics carry the primary addresses involved in the operation.
- The data slot carries amounts or composite tuples when multiple values are
  relevant (e.g. the vesting `init` event).
- All amounts are `i128` and follow the token's decimal precision.
