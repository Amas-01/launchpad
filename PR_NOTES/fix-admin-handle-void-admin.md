Fix admin() void handling in fetchTokenInfo

Summary:
- Avoid decoding `admin` ScVal when it is `scvVoid()`; return "N/A" instead.
- Prevents dashboard/admin UI from erroring when a token has no on-chain admin (addresses Issue #129).

Changed files:
- frontend/lib/stellar.ts — detect and handle `scvVoid()` for `admin()` calls.

Test results (run in this environment):
- Frontend unit tests: 99 passed, 0 failed.
- Rust contract tests: not run here (no `cargo` available). Please run `cargo test` in `contracts/token` and `contracts/vesting` in CI or locally.

Changelog:
- Fix: handle void `admin` ScVal in `fetchTokenInfo` to avoid decode errors and enable admin UI for tokens without an admin.

Branch: `fix/admin-handle-void-admin`

Notes:
- PR created/updated to include test summary and recommended follow-up (run Rust tests in CI).
