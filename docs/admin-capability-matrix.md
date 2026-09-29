# Admin Capability Matrix — Decision Record

**Status:** Accepted
**Scope:** `contracts/{token,vesting,factory,airdrop}/src/lib.rs`, plus the
airdrop's frontend admin surface (`frontend/app/airdrop/`, `frontend/lib/airdrop.ts`,
`frontend/messages/*.json`)
**Consequence:** airdrop and factory converge on the token's admin surface.

## Context

The four contracts were written at different times against different ideas of
what an admin should be able to do, and nothing reconciled them. Each row below
is a capability a user or integrator reasonably expects to be uniform; each
cell records what the contract did **before** this decision, which is the state
the decision is made against.

| Capability | token | vesting | factory | airdrop |
|---|---|---|---|---|
| Two-step admin transfer | ✅ `propose_admin` / `accept_admin` / `cancel_admin_proposal` | ✅ same three fns, but **no proposal expiry** (issue #170) | ❌ single admin, set once in `initialize` | ❌ single admin, set once in `initialize` |
| Proposal expiry | ✅ `ADMIN_PROPOSAL_EXPIRY_LEDGERS` (≈365d), enforced in `accept_admin`, lazily cleared by the `pending_admin()` getter | ❌ a proposal lives until someone acts on it | — (no transfer) | — (no transfer) |
| `revoke_admin` / immutability | ✅ sets `Locked`, removes `Admin` | ✅ sets `Locked`, removes `Admin` — but the lock check is a panic string, not a typed error | ❌ | ❌ |
| `pause` / `unpause` | ✅ | ✅ | ❌ | ❌ |
| `upgrade` | ✅ | ✅ | ❌ (immutable — no fn reaches `update_current_contract_wasm`) | ❌ (immutable) |
| Event for every admin action | ✅ `prop_adm`, `cncl_adm`, `set_admin`, `revoked`, `pause`, `unpause`, `upgrade` | ⚠️ all but `cancel_admin_proposal`, which is silent | ⚠️ `init` and `set_wasm` only — no admin-lifecycle events | ❌ `init` only; `reclaim`/`extend` are admin actions but there are no admin-lifecycle events at all |
| Typed error enum | ✅ `TokenError`, 23 variants | ✅ `VestingError`, 17 variants | ✅ `FactoryError`, 3 variants | ✅ `AirdropError`, 14 variants |
| Admin surfaced in the UI | ✅ full panel (`app/dashboard/[contractId]/components/admin/`) | ✅ dashboard + `PendingAdminBanner` | n/a | ❌ no admin UI anywhere — `AirdropBuilder.tsx` builds and deploys, `AirdropClaim.tsx` claims |

Two consequences a user will hit:

1. **An airdrop admin has a single admin key that can never be changed.** There
   is no way to hand the airdrop to anyone else — the only escape is to deploy a
   new contract and abandon the funded one. Same for the factory.
2. **The frontend has no admin surface for the airdrop at all.** Nothing can
   top up an airdrop, extend its deadline, or sweep it, even though all three
   are on-chain admin/funder operations.

## Decision

**Converge on the token's admin surface.** The target set is:

- `propose_admin` / `cancel_admin_proposal` / `accept_admin`, two-step, with a
  proposal expiry of `ADMIN_PROPOSAL_EXPIRY_LEDGERS`
- `pending_admin()` getter that lazily clears an expired proposal
- `revoke_admin()` + `Locked` flag + `is_locked()` getter
- `pause()` / `unpause()` + `IsPaused` flag + `is_paused()` getter
- `upgrade(new_wasm_hash)` with the all-zeros guard
- an event published by **every** one of those actions, and nothing silent
- an `Initialized` flag that survives `revoke_admin`, so revoking admin can
  never re-open `initialize`

**Rollout order: airdrop first, then factory.** The airdrop holds user funds;
the factory holds the code hash. Within each contract, **two-step transfer goes
first** — it is a storage change plus a getter plus an event, and it is the one
gap that leaves a user permanently unable to recover their role.

### Why the token and not a new synthesis

The token's surface is the only one that is complete, the only one the existing
admin UI is already built against, and the only one with tests for every row.
Writing a fifth design would add a fourth answer rather than converge on one.
Where the token's implementation has rough edges (panic strings instead of
typed errors for `no pending admin` / `proposal expired`), the *surface* is
still what gets copied: same function names, same storage keys, same event
topic-0 symbols, so the existing UI and the event fixtures keep working. New
error variants are added to each contract's own enum rather than reshaping the
token's, since error codes are already published to clients.

### What is deliberately not changed

- **Vesting's missing proposal expiry.** Vesting is a third answer today, but
  its transfer already works and it is not in the fix's rollout order
  (airdrop, then factory). Recorded here as known divergence, tracked as
  issue #170; it needs its own storage key + a getter change and should be
  shipped separately.
- **Vesting's silent `cancel_admin_proposal` and panic-string lock.** Same
  reasoning; both are gaps against this matrix and are follow-ups.
- **Token error variants.** Codes 1–23 are published; the new variants land in
  `AirdropError` and `FactoryError` only.

## Consequences

- Airdrop and factory gain `Locked` / `Paused` / `NoPendingAdmin` /
  `InvalidWasmHash` error variants, `PendingAdmin` / `PendingAdminExpiry` /
  `IsPaused` / `Locked` storage keys, and the full set of admin events.
- The factory's `initialize` guard moves from "presence of `Admin`" to an
  `Initialized` flag — otherwise `revoke_admin` (which deletes `Admin`) would
  re-open `initialize`.
- Every new topic-0 symbol must land in `docs/events.json` and in each
  contract's `EXPECTED_TOPICS` fixture, or `scripts/generate_events_doc.py
  --check` and `test_emitted_topics_match_checked_in_fixture` fail CI.
- The airdrop gains an admin panel in the frontend — top up, extend deadline,
  sweep, transfer admin, pause, revoke. Delivered as
  `app/airdrop/[contractId]/AirdropAdminPanel.tsx`, rendered from the claim
  page and visible only to the connected admin (or the wallet being handed
  the role), against `lib/airdrop.ts`'s plain transaction builders rather
  than the dashboard's generated bindings — no airdrop bindings exist.
  `fetchAirdropInfo` now reads `pending_admin` / `is_locked` / `is_paused`
  and tolerates their absence, so an airdrop deployed before this change
  still renders, and a locked contract reads back as "no admin" instead of
  failing the page `get_admin` would panic on.

## Verification

- `cargo test --workspace`
- `python3 scripts/generate_events_doc.py --check`
- frontend typecheck / lint / jest
