# 📋 SoroPad Issue Tracker — Wave 6

_Cleanup & improvement pass. Every issue below was confirmed by reading the current source on `master` (post Wave 5 merges, up to PR #249)._

**Context:** Wave 5 issues 29–52 are largely merged. This wave focuses on (a) a **broken deploy path** that no longer matches the extended token ABI, (b) contract guard/consistency gaps introduced as the contracts grew, (c) leftover debug code, and (d) repository hygiene.

Complexity levels:

- 🟢 **Trivial** (100 pts) — Small, well-defined
- 🟡 **Medium** (150 pts) — Standard features or involved bug fixes
- 🔴 **High** (200 pts) — Complex features, integrations, or architectural changes

> Carry-overs from Wave 5 still unfixed in the code are flagged **(carry-over #N)**.

---

## Part 1: Critical Bugs (Deploy path is broken)

### 53. Deploy: `initialize()` is called with 6 args but the contract now requires 9

🔴 **High** · `frontend` `deploy` `rpc`

**File:** `frontend/app/hooks/useDeployToken.ts` — `initializeContract()` (lines 344–354)

**Issue:** The frontend builds the `initialize` call with six arguments:

```ts
contract.call(
  "initialize",
  adminScVal, decimalScVal, nameScVal, symbolScVal,
  initialSupplyScVal, maxSupplyScVal
)
```

But `contracts/token/src/lib.rs` `initialize()` (lines 69–80) now takes **nine** parameters — it gained `authorization_required: bool`, `authorization_revocable: bool`, and `compliance_node: Option<Address>`. The simulation will fail with an argument-count/ABI mismatch, so **every deployment fails at the initialize step** after the contract has already been created on-chain (wasting the deploy transaction).

**Fix:** Add the three missing arguments. Thread `authorizationRequired`, `authorizationRevocable`, and an optional `complianceNode` through `DeployTokenParams` (default `false`, `false`, `None`) and encode them with `nativeToScVal(..., { type: "bool" })` and an `Option<Address>` ScVal. Wire the deploy wizard's existing compliance/authorization steps (if any) into these params, or hardcode safe defaults until the UI exists.

---

### 54. Deploy: `initial_supply` and `max_supply` are not decimal-scaled

🔴 **High** · `frontend` `deploy`

**File:** `frontend/app/hooks/useDeployToken.ts` — `initializeContract()` (lines 335–338)

**Issue:**

```ts
const initialSupplyScVal = StellarSdk.nativeToScVal(params.initialSupply, { type: "i128" });
const maxSupplyScVal = params.maxSupply
  ? StellarSdk.nativeToScVal(params.maxSupply, { type: "i128" })
  : StellarSdk.xdr.ScVal.scvVoid();
```

`params.initialSupply` is the raw display number from the form. A user who deploys "1,000,000 supply" at 7 decimals expects `1_000_000 × 10^7` base units minted, but the contract receives `1_000_000` base units — i.e. **0.1 token**. This is the same class of bug that was fixed in `AdminPanel`/`TransferPanel` (Wave 5 #29/#30) but never applied to the deploy initializer. `max_supply` is wrong by the same factor, so the cap is also meaningless.

**Fix:** Scale both by `10^decimals` before encoding, using BigInt: `BigInt(params.initialSupply) * 10n ** BigInt(params.decimals)`. Validate `initialSupply <= maxSupply` after scaling.

---

### 55. Deploy: supply encoded from a JS `number` loses precision above 2⁵³

🟡 **Medium** · `frontend` `deploy`

**File:** `frontend/app/hooks/useDeployToken.ts` (lines 335–337); `DeployTokenParams` (lines 35–42)

**Issue:** `DeployTokenParams.initialSupply` and `maxSupply` are typed `number`. After the decimal scaling from #54, a 7-decimal token with a 10-billion supply needs `1e17` base units — far beyond `Number.MAX_SAFE_INTEGER` (~9.0e15). Passing a JS `number` to `nativeToScVal(..., {type:"i128"})` silently corrupts the value for large/realistic supplies.

**Fix:** Change the params to accept `string` (or `bigint`) for supply fields, parse the user input as `BigInt`, and never round-trip through `number`. The deploy form already collects these as strings from inputs.

---

### 56. Deploy: hardcoded RPC URL / passphrase ignores the selected network

🔴 **High** · `frontend` `deploy` `network`

**File:** `frontend/app/hooks/useDeployToken.ts` (lines 24–29, 108, 126, 167, 342)

**Issue:** The hook reads module-level constants:

```ts
const SOROBAN_RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? StellarSdk.Networks.TESTNET;
```

Every other RPC consumer in the app reads `networkConfig` from `useNetwork()` (see `hooks/useSoroban.ts`, `useContractEvents.ts`). `useDeployToken` does not. If a user switches the app to **mainnet** (or sets a custom RPC URL in Settings), deployment still targets whatever the env constant says — typically testnet. The user signs and broadcasts to the wrong network with no warning.

**Fix:** Call `useNetwork()` inside the hook and use `networkConfig.rpcUrl` and `networkConfig.passphrase` for the `rpc.Server`, the `TransactionBuilder`, `signTransaction`, and `fromXDR`. Pass them into the `initializeContract` helper rather than reading module constants.

---

### 57. Token: whale protection + `revoke_admin` permanently bricks all transfers

🔴 **High** · `contracts` `token` `security`

**File:** `contracts/token/src/lib.rs` — `_enforce_max_balance_per_account()` (lines 681–685), `revoke_admin()` (lines 245–251)

**Issue:** When `max_balance_per_account` is set, every `transfer`/`mint` to a non-admin runs:

```rust
let admin: Address = env.storage().instance()
    .get(&DataKey::Admin)
    .expect("not initialized");   // ← panics if Admin was removed
if to == &admin { return; }
```

`revoke_admin()` deliberately **removes** the `Admin` storage entry (line 248) to make the token immutable. But the whale-protection cap persists. After an admin enables whale protection and then revokes admin, `_enforce_max_balance_per_account` panics with `"not initialized"` on every transfer/mint to a non-admin — **the token is permanently frozen for transfers**. `revoke_admin` is advertised as the "trustless / immutable" path where holders can still transfer (see the doc-comment at lines 240–242), so this is a direct contradiction.

**Fix:** Read the admin with `get::<_, Address>(...)` returning `Option`; if `None` (admin revoked), skip the admin-exemption branch and still enforce the cap (or treat the cap as inactive once locked — pick one and document it). Add a regression test: set cap → `revoke_admin` → assert a non-admin transfer still succeeds.

---

### 58. Settings: custom RPC/Horizon URL doesn't take effect until reload (duplicated providers)

🟡 **Medium** · `frontend` `network` `architecture`

**File:** `frontend/app/providers/NetworkProvider.tsx` (lines 47–86); `frontend/app/providers/SettingsProvider.tsx` (lines 93–123)

**Issue:** Two providers independently read/write the **same** localStorage keys (`soropad_rpc_url:<network>`, `soropad_horizon_url:<network>`):

- `NetworkProvider` folds the stored URL into `networkConfig.rpcUrl` — and that is what all real RPC calls use (`useSoroban`, `useContractEvents`, etc.).
- `SettingsProvider` exposes `setRpcUrl`/`setHorizonUrl` that write those keys.

`NetworkProvider` only refreshes its `customRpcUrl` state on a `network` change or a cross-tab `storage` event. The `storage` event **does not fire in the tab that made the change**, so calling `setRpcUrl` from the Settings modal updates `SettingsProvider` state and localStorage but leaves `networkConfig.rpcUrl` stale until a full page reload. Users who set a custom endpoint see no effect.

**Fix:** Make `SettingsProvider` the single source of truth and have `NetworkProvider` consume it (or vice-versa), or have the setters dispatch a custom event that `NetworkProvider` listens for to re-read the URLs immediately. Remove the duplicated localStorage-reading logic so the two can't diverge.

---

## Part 2: Contract Guards & Consistency

### 59. Token: `burn()` still doesn't check frozen status (carry-over #34)

🟡 **Medium** · `contracts` `token`

**File:** `contracts/token/src/lib.rs` — `burn()` (lines 143–148) vs `burn_self()` (lines 202–208)

**Issue:** `burn_self` asserts `!_is_frozen(from)` (line 206) so a frozen holder can't destroy tokens to dodge a freeze. `burn` — also caller-authorized via `from.require_auth()` — has **no** frozen check, so a frozen account can simply call `burn` instead. Wave 5 #34 flagged this; it remains unfixed.

**Fix:** Add `assert!(!Self::_is_frozen(&env, &from), "account is frozen");` to `burn` before `_burn`, plus a `#[should_panic]` test mirroring `test_burn_self_blocked_when_frozen`.

---

### 60. Token: `mint_batch()` has no maximum batch-size guard

🟡 **Medium** · `contracts` `token`

**File:** `contracts/token/src/lib.rs` — `mint_batch()` (lines 187–197)

**Issue:** `mint_batch` loops over `to`/`amounts` with no upper bound. A caller can pass hundreds of recipients and blow past Soroban's per-transaction compute/footprint budget, failing with an opaque resource error instead of a clear message. (This mirrors the vesting batch concern in Wave 5 #52.)

**Fix:** Assert `to.len() <= 100` (or a benchmarked limit) at the top of `mint_batch`, document it in the doc-comment, and surface the limit in the AdminPanel batch-mint UI.

---

### 61. Token: `mint_batch()` does not extend balance TTL

🟢 **Trivial** · `contracts` `token`

**File:** `contracts/token/src/lib.rs` — `mint_batch()` (lines 187–197) vs `mint()` (lines 134–139)

**Issue:** `mint`, `transfer`, `transfer_from`, and `clawback` all call `extend_ttl` on the affected `Balance` keys (~52 weeks). `mint_batch` calls `_mint` in a loop but never extends TTL, so balances created via batch mint are eligible for archival far sooner than single-mint balances — an inconsistency that can surprise recipients of an airdrop batch.

**Fix:** Extend the TTL for each recipient's `Balance` key inside the loop (or factor the TTL extension into `_mint`).

---

### 62. Token: `pause`/`unpause` emit the same topic with only a bool payload

🟢 **Trivial** · `contracts` `token`

**File:** `contracts/token/src/lib.rs` — `pause()` (line 275), `unpause()` (line 282)

**Issue:**

```rust
// pause
env.events().publish((symbol_short!("pause"),), true);
// unpause
env.events().publish((symbol_short!("pause"),), false);
```

This is exactly the freeze/unfreeze anti-pattern that was just fixed in PR #245 (issue #232 → distinct `freeze` / `unfreeze` topics). Indexers and compliance monitors must parse the payload to tell a pause from an unpause instead of subscribing to two topics.

**Fix:** Use distinct topics: `symbol_short!("pause")` with `()` for pause and `symbol_short!("unpause")` with `()` for unpause, consistent with the freeze/unfreeze fix.

---

### 63. Token: `initialize()` does not validate the `decimal` range

🟢 **Trivial** · `contracts` `token`

**File:** `contracts/token/src/lib.rs` — `initialize()` (lines 69–93)

**Issue:** `decimal: u32` is stored with no bounds check. A token created with `decimals = 30` (or `u32::MAX`) is nonsensical and makes `10^decimals` overflow `i128` and the frontend's `10 ** decimals` scaling produce `Infinity`. SEP-41 tooling assumes a sane range (≤ 18, typically ≤ 7 on Stellar).

**Fix:** `assert!(decimal <= 18, "decimals must be <= 18");` (or the project's chosen ceiling) in `initialize`, with a test.

---

### 64. Token: `initialize()` accepts empty `name` / `symbol`

🟢 **Trivial** · `contracts` `token`

**File:** `contracts/token/src/lib.rs` — `initialize()` (lines 94–95)

**Issue:** `name` and `symbol` are stored without validation. An empty-string symbol/name produces broken explorer listings, OG images, and dashboard cards. The frontend validates these, but the contract — the actual source of truth — does not, so a direct/raw deploy can create a nameless token.

**Fix:** `assert!(name.len() > 0 && symbol.len() > 0, "name and symbol required");` (optionally bound the max length). Add a `#[should_panic]` test.

---

### 65. Token: `set_compliance_node()` performs no validation of the node

🟡 **Medium** · `contracts` `token` `security`

**File:** `contracts/token/src/lib.rs` — `set_compliance_node()` (lines 579–590), `_check_compliance()` (lines 701–715)

**Issue:** Wave 5 #51 added the `set_compliance_node` setter (good), but it stores any `Address` with no sanity check. At transfer time `_check_compliance` does `ComplianceNodeClient::new(env, &node).can_trade(...)`. If the admin sets a non-contract address or one that doesn't implement `can_trade`, **every transfer panics** until the admin clears it — and if combined with `revoke_admin`, it's permanent.

**Fix:** On `set_compliance_node(Some(addr))`, do a best-effort probe (e.g. a simulated `can_trade` call against a known pair, or at minimum document that the node must implement `ComplianceNodeInterface`). Make `_check_compliance` degrade gracefully where feasible, and ensure clearing the node is always possible while admin exists.

---

### 66. Vesting: `create_schedules_batch()` skips the pause guard (carry-over #31)

🟡 **Medium** · `contracts` `vesting`

**File:** `contracts/vesting/src/lib.rs` — `create_schedules_batch()` (lines 166–172)

**Issue:** `create_schedule` (line 113), `release` (line 263), and `revoke` (line 302) all start with `Self::_check_paused(&env)`. `create_schedules_batch` does not — a paused vesting contract can still create batch schedules. Wave 5 #31 flagged this for the batch function; still unfixed.

**Fix:** Add `Self::_check_paused(&env);` as the first line of `create_schedules_batch`.

---

### 67. Vesting: `create_schedules_batch()` has no maximum batch-size guard (carry-over #52)

🟡 **Medium** · `contracts` `vesting` `security`

**File:** `contracts/vesting/src/lib.rs` — `create_schedules_batch()` (lines 166–258)

**Issue:** Only `assert!(schedules.len() > 0, ...)` is enforced (line 174). A large vector exceeds Soroban's compute budget and fails with an opaque resource error after the token transfer is built. Wave 5 #52 flagged this; still unfixed.

**Fix:** `assert!(schedules.len() <= 50, "batch size exceeds maximum of 50");` at the top, documented and surfaced in the UI.

---

### 68. Vesting: `extend_cliff()` skips the pause guard

🟢 **Trivial** · `contracts` `vesting`

**File:** `contracts/vesting/src/lib.rs` — `extend_cliff()` (lines 353–380)

**Issue:** Unlike `create_schedule`, `release`, and `revoke`, `extend_cliff` does not call `_check_paused`. An admin can still mutate a schedule's cliff while the circuit breaker is engaged, which contradicts the purpose of the pause state.

**Fix:** Add `Self::_check_paused(&env);` as the first line of `extend_cliff` (after `_require_admin` or before — match the ordering used by `revoke`).

---

### 69. Vesting: `pause`/`unpause` emit the same topic with only a bool payload

🟢 **Trivial** · `contracts` `vesting`

**File:** `contracts/vesting/src/lib.rs` — `pause()` (line 408), `unpause()` (line 415)

**Issue:** Same pattern as #62 — both publish `symbol_short!("pause")` differing only by `true`/`false`. Distinct topics are easier and safer to index.

**Fix:** Emit `("pause",)` for pause and `("unpause",)` for unpause.

---

### 70. Vesting: no getters for `admin` or `token_contract`

🟡 **Medium** · `contracts` `vesting` `frontend`

**File:** `contracts/vesting/src/lib.rs` (storage keys `Admin`, `TokenContract` at lines 12–14)

**Issue:** The vesting contract exposes `get_schedule`, `get_recipients`, etc., but there is **no** read-only getter for the admin address or the managed token contract. The frontend cannot show "who controls this vesting contract" or verify which token a schedule pays out, and can't gate admin-only UI without guessing.

**Fix:** Add `pub fn get_admin(env: Env) -> Address` and `pub fn get_token_contract(env: Env) -> Address` (both reading instance storage). Consume them in the dashboard's vesting view.

---

### 71. Vesting: `get_recipients_paginated()` can overflow on `start + limit`

🟢 **Trivial** · `contracts` `vesting`

**File:** `contracts/vesting/src/lib.rs` — `get_recipients_paginated()` (lines 452–457)

**Issue:**

```rust
let end = if start + limit > total { total } else { start + limit };
```

`start + limit` is `u32 + u32`; large caller-supplied values wrap (release) or panic (debug). It also recomputes `start + limit` twice.

**Fix:** Use `start.saturating_add(limit).min(total)` and the early `if start >= total { return empty }` guard already present.

---

## Part 3: Frontend Cleanup & Debug Code

### 72. AdminPanel: `BigInt(amount)` throws on fractional input

🟡 **Medium** · `frontend` `admin`

**File:** `frontend/app/dashboard/[contractId]/components/AdminPanel.tsx` (lines 241, 317, 331, 368)

**Issue:** Amounts are scaled with `BigInt(mintData.amount) * BigInt(10) ** BigInt(decimals)` (and `BigInt(e.amount)` in batch mint). `BigInt("10.5")` throws a `RangeError`. A user entering a fractional mint/clawback/vesting amount (e.g. `10.5`) crashes the handler instead of minting `10.5` tokens — the AdminPanel was fixed for integer scaling (Wave 5 #29) but assumes integer input.

**Fix:** Parse like `TransferPanel` does: `BigInt(Math.round(parseFloat(amount) * 10 ** decimals))`, or split on the decimal point and pad. Validate the input has at most `decimals` fractional digits.

---

### 73. AdminPanel: leftover `console.log` on batch mint

🟢 **Trivial** · `frontend` `quality`

**File:** `frontend/app/dashboard/[contractId]/components/AdminPanel.tsx` (line 252)

**Issue:** `console.log(\`Signing batch mint tx for ${contractId} with ${entries.length} recipients\`)` leaks tx metadata to the console on every batch mint. Wave 5 #46 removed the two single-action logs but this one remains.

**Fix:** Delete the `console.log`.

---

### 74. TransferPanel: `console.log(fetchTokenInfo)` debug line (and unused import)

🟢 **Trivial** · `frontend` `quality`

**File:** `frontend/app/dashboard/[contractId]/components/TransferPanel.tsx` (lines 85–86)

**Issue:** `const { fetchTokenInfo } = useSoroban(); console.log(fetchTokenInfo);` logs a function reference on every render. `fetchTokenInfo` is destructured solely to be logged — it is otherwise unused.

**Fix:** Remove the `console.log` and the now-unused `fetchTokenInfo` destructure (and the `useSoroban` import if nothing else uses it).

---

### 75. TokenDashboard: `console.log(tokenInfo)` left in render

🟢 **Trivial** · `frontend` `quality`

**File:** `frontend/app/dashboard/[contractId]/TokenDashboard.tsx` (line 45)

**Issue:** `console.log(tokenInfo)` runs on every render, dumping full token state (including admin address) to the browser console in production.

**Fix:** Remove it.

---

### 76. PublicTokenPage: swallowed error logged via `console.log(err)`

🟢 **Trivial** · `frontend` `quality`

**File:** `frontend/app/token/[contractId]/PublicTokenPage.tsx` (line 85)

**Issue:** A caught error is sent to `console.log(err)` rather than surfaced to the user or logged with context. Errors fetching the public token page are silently dropped — the visitor sees no diagnostic.

**Fix:** Replace with a user-visible error state (the page already renders states) or at minimum `console.error` with a message; don't swallow.

---

### 77. Form components: debug `console.log` of transaction data

🟢 **Trivial** · `frontend` `quality`

**Files:** `frontend/components/forms/TransferForm.tsx:93`, `MintForm.tsx:105`, `BurnForm.tsx:93`, `VestingForm.tsx:88,250`, `app/dashboard/[contractId]/components/UserPanel.tsx:114,124`

**Issue:** Each of these logs `"Submitting … transaction:"` with the raw form payload (amounts, addresses) to the console on every submit. This is noise at best and leaks user data at worst.

**Fix:** Remove the `console.log` calls. If submit-time diagnostics are wanted, gate them behind a debug flag.

---

### 78. Forms: native `alert()` for the pre-flight gate instead of the ToastProvider

🟡 **Medium** · `frontend` `ux`

**Files:** `frontend/components/forms/TransferForm.tsx:87`, `MintForm.tsx:99`, `BurnForm.tsx:87`, `VestingForm.tsx:82,244`

**Issue:** Five forms call `alert("Please run pre-flight check first")`. The app has a `ToastProvider` (`useToast()`) used everywhere else; native `alert` is a blocking, unstyled, inconsistent dialog. (Wave 5 #44 already migrated `ClaimVesting` off a second toast lib for the same reason.)

**Fix:** Replace each `alert(...)` with `toast.show({ variant: "warning", message: "Run the pre-flight check first" })`, or better, disable the submit button until the pre-flight check passes and show inline helper text.

---

## Part 4: Repository Hygiene

### 79. Remove the `bash.exe.stackdump` crash dump from the repo root

🟢 **Trivial** · `repo`

**File:** `bash.exe.stackdump` (repo root)

**Issue:** A Cygwin/Git-Bash crash dump (~4.5 KB) is sitting in the repo root. It is build/run detritus, not source, and should never have been committed/left.

**Fix:** Delete the file and add `*.stackdump` to `.gitignore`.

---

### 80. Remove `frontend/test-horizon.ts` scratch file

🟢 **Trivial** · `repo` `frontend`

**File:** `frontend/test-horizon.ts`

**Issue:** A 631-byte ad-hoc Horizon probe script lives at the frontend root, outside `__tests__`/`e2e`, not referenced by the app or the Jest/Playwright config. It's leftover developer scratch.

**Fix:** Delete it (or move a cleaned-up version into `scripts/` if it's still useful).

---

### 81. Remove the empty placeholder `package-lock.json` at the repo root

🟢 **Trivial** · `repo`

**File:** `package-lock.json` (repo root, ~88 bytes)

**Issue:** There is no root `package.json` (the Node app lives in `frontend/`), yet a near-empty `package-lock.json` is tracked at the root. It misleads tooling and contributors into thinking the root is an npm project.

**Fix:** Delete the root `package-lock.json`. The real lockfile is `frontend/package-lock.json`.

---

### 82. Consolidate the overlapping process/status markdown docs

🟢 **Trivial** · `repo` `docs`

**Files (repo root):** `IMPLEMENTATION_SUMMARY.md`, `IMPLEMENTATION_NOTES.md`, `FIXES_SUMMARY.md`, `PR_DESCRIPTION.md`, `PR_MESSAGE.md`, `FEATURE_CHECKLIST.md`, `APPROACH_STATEMENT.md`, `REMOVAL_NOTICE.md`, plus the issue backlogs `PENDING_ISSUES.md` / `NEW_ISSUES.md`

**Issue:** Ten-plus overlapping, often stale, single-PR narrative docs clutter the repo root. Several describe work that is already merged (e.g. `APPROACH_STATEMENT.md` / `REMOVAL_NOTICE.md` both cover the now-completed `permit()` removal). Contributors can't tell which doc is authoritative, and `IMPLEMENTATION_SUMMARY.md` claims features that were later found broken.

**Fix:** Fold the still-relevant content into `docs/` (e.g. a single `CHANGELOG.md` and a `docs/architecture.md`), delete the per-PR narrative files, and keep one canonical issue tracker (this `waveN.md` series). Update `CONTRIBUTING.md` to point at the survivors.

---

## Summary

| Area | Issues | Notes |
| --- | --- | --- |
| Deploy path (broken) | 53–56 | #53 (ABI mismatch) blocks **all** deploys; #54/#55 corrupt supply; #56 wrong network |
| Contract safety | 57, 65, 59, 66, 67 | #57 can permanently brick a token; rest are guard gaps |
| Contract consistency | 60–64, 68–71 | pause/unpause topics, batch caps/TTL, validation, getters |
| Frontend cleanup | 72–78 | one real input bug (#72); rest are debug-code/UX removals |
| Repo hygiene | 79–82 | stray dumps, scratch files, doc clutter |

**Recommended order:** 53 → 54 → 56 → 57 first (deploy is unusable and #57 is a latent foot-gun), then the trivial cleanup sweep (61–64, 68–82) which can largely land in one or two PRs.
