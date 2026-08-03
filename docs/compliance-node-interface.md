# Compliance Node Interface — Guide for Node Authors

## Overview

A compliance node is a separate Soroban contract the token points at via `set_compliance_node`. Once set, the token gates every value-moving operation through it: the node answers whether a given transfer, mint, or clawback is allowed, and the token fails closed (`TokenError::ComplianceNodeUnavailable`) if the node cannot be reached or returns something other than a `bool`.

## The interface

```rust
pub trait ComplianceNodeInterface {
    fn can_trade(env: Env, from: Address, to: Address) -> bool;
    fn can_issue(env: Env, to: Address) -> bool;
}
```

| Function | Asked for | Used by |
|---|---|---|
| `can_trade(from, to)` | Value moving between two existing holders | `transfer`, `transfer_from`, `clawback` |
| `can_issue(to)` | Value entering circulation with no sending holder | `mint`, `mint_batch` |

`burn` / `burn_admin` / `burn_self` are never checked: they destroy tokens, there is no recipient to gate, and gating a burn would let a failing node trap a holder's own balance.

## Why `can_issue` exists separately from `can_trade`

Minting has no sending holder. Before `can_issue` existed, the token stood in its own contract address for `from` and called `can_trade(token_address, to)`. That is a reasonable-looking default until a node implements the obvious policy — an allowlist of KYC'd holders:

```rust
fn can_trade(from: Address, to: Address) -> bool {
    is_kyc_verified(from) && is_kyc_verified(to)
}
```

The token contract's own address is never a KYC'd holder, so `can_trade(token_address, to)` returns `false` for every mint, regardless of `to`. Combined with the token's fail-closed policy, that blocks all issuance — including `mint_batch` for an airdrop — until an admin clears the node, mints, and re-sets it, defeating the point of the gate.

`can_issue(to)` asks about the recipient only, so an allowlist node answers correctly: mint succeeds once `to` is approved, with no special-casing of the token's own address required.

## Implementing `can_issue` in a new node

Write it in terms of whatever your node already checks about a holder. For an allowlist node, this is nearly always:

```rust
fn can_issue(env: Env, to: Address) -> bool {
    is_kyc_verified(&env, &to)
}
```

For a node whose policy genuinely does not distinguish issuance from a peer-to-peer trade (e.g. a pure deny-list, where the identity of `from` never changes the answer), `can_issue(to)` can simply delegate:

```rust
fn can_issue(env: Env, to: Address) -> bool {
    Self::can_trade(env, to.clone(), to)
}
```

## Backward compatibility — nodes deployed before this method existed

`can_issue` is not optional in the trait, but the token contract tolerates a node that does not export it: every cross-contract call uses the generated `try_*` variant, and if `try_can_issue` fails at the invocation level (no matching export on that contract), the token falls back to asking `can_trade(to, to)` instead of failing closed with `ComplianceNodeUnavailable`. A node written before `can_issue` existed keeps working without a redeploy — it simply gets asked about the recipient via `can_trade` instead. New nodes should still implement `can_issue` explicitly rather than relying on the fallback, since it is the more direct and intention-revealing answer to "can this recipient receive newly issued tokens."

## Validating a node before `set_compliance_node`

The token only requires `can_trade` to be callable at set-time — `set_compliance_node` probes `can_trade(token_address, token_address)` and accepts any `bool` answer, purely to confirm the address is a live, correctly-shaped contract. It does not probe `can_issue`, since a node is allowed to not implement it (see above).
