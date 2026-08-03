# Vesting Solvency

The vesting contract keeps a live `total_committed` counter for tokens still
owed to active schedules. The counter increases when schedules are created and
decreases when tokens are released or a schedule is revoked.

Recipients and auditors can call `solvency()` to compare that commitment total
with the vesting contract's current token balance:

- `token_balance`: live balance held by the vesting contract.
- `total_committed`: amount still owed to active schedules.
- `solvent`: `true` when `token_balance >= total_committed`.

The token admin can still undermine a vesting contract if they retain token
admin powers. For example, a token with clawback enabled can claw tokens back
from the vesting contract address after schedules are funded. A paused or
frozen token can also prevent otherwise valid releases from completing.

For grants that need strong credibility, use one of these patterns:

- Call `revoke_admin` on the token contract after funding grants, if the token
  no longer needs admin-managed minting, clawback, pause, or freeze powers.
- Use a separate token admin that is independent from the vesting admin.
- Prefer multisig or governed admin accounts for high-value grant programs.

The solvency badge in the frontend is a trust signal, not an enforcement layer.
It shows whether the vesting contract is currently funded enough to cover its
recorded commitments, so recipients can spot underfunding before attempting a
claim.
