# Merkle Airdrop Feature Guide

Distributing a token to a large list of addresses used to mean driving
`mint_batch` yourself: 100 recipients per call at best, every transaction paid
for by the admin, and the orchestration left as an exercise for the reader.
Ten thousand addresses is 100+ transactions and a script nobody reviewed.

The airdrop module replaces that with a Merkle claim:

- The admin commits to the whole `(address, amount)` list as a single 32-byte
  **Merkle root** and publishes it in **one transaction**, regardless of list
  size.
- Each recipient **claims against a proof** and pays their own fee.
- After a **deadline ledger**, the admin sweeps whatever is unclaimed back out.

## Contents

- [Contract API](#contract-api)
- [How the tree is built](#how-the-tree-is-built)
- [Admin walkthrough](#admin-walkthrough)
- [Recipient walkthrough](#recipient-walkthrough)
- [Deploying the contract](#deploying-the-contract)
- [Design notes](#design-notes)

---

## Contract API

`contracts/airdrop/src/lib.rs`

| Function | Auth | Purpose |
| --- | --- | --- |
| `initialize(token, admin, merkle_root, deadline_ledger)` | admin | Publish the airdrop. One-shot. |
| `fund(from, amount)` | `from` | Move tokens into the contract so there is something to claim. |
| `claim(recipient, amount, proof)` | recipient | Claim an allocation against a proof. |
| `reclaim_unclaimed()` | admin | After the deadline, sweep the remainder back to the admin. Returns the amount swept. |
| `verify_proof(recipient, amount, proof)` | — | Read-only: is this proof accepted? |
| `is_claimed(recipient)` / `claimed_amount(recipient)` | — | Read-only claim state. |
| `total_claimed()` / `remaining_balance()` | — | Read-only totals. |
| `get_admin()` / `get_token()` / `get_merkle_root()` / `get_deadline_ledger()` / `is_reclaimed()` | — | Read-only configuration. |
| `leaf_hash(recipient, amount)` | — | The exact leaf bytes, for cross-checking an off-chain tree builder. |

### Errors

| Code | Variant | Raised when |
| --- | --- | --- |
| 1 | `AlreadyInitialized` | `initialize` called twice. |
| 2 | `NotInitialized` | Any operation before `initialize`. |
| 3 | `InvalidDeadline` | `deadline_ledger` is not in the future. |
| 4 | `InvalidAmount` | A zero or negative amount. |
| 5 | `AlreadyClaimed` | This recipient already claimed. |
| 6 | `InvalidProof` | The proof does not authenticate `(recipient, amount)`. |
| 7 | `DeadlinePassed` | `claim` after the deadline. |
| 8 | `DeadlineNotReached` | `reclaim_unclaimed` at or before the deadline. |
| 9 | `AlreadyReclaimed` | The remainder was already swept. |
| 10 | `NothingToReclaim` | Nothing left to sweep. |
| 11 | `ProofTooLong` | Proof longer than 32 hashes. |
| 12 | `AddressTooLong` | Recipient strkey longer than 64 bytes. |
| 13 | `AmountOverflow` | `total_claimed` would overflow `i128`. |

### Events

See [`events.md`](./events.md) — `init`, `fund`, `claim`, `reclaim`.

---

## How the tree is built

The tree is built off chain (in the browser) and verified on chain, so both
sides must agree byte-for-byte:

```text
leaf(addr, amount) = keccak256(0x00 || ascii(strkey(addr)) || be_i128(amount))
node(a, b)         = keccak256(0x01 || min(a, b) || max(a, b))
```

Three choices are worth calling out:

- **Sibling pairs are sorted before hashing.** That is what lets a proof be a
  bare list of hashes with no left/right direction bits, which keeps the proof
  format and the contract's verification loop simple.
- **Leaves and nodes carry different domain prefixes** (`0x00` / `0x01`).
  Without them, a 32-byte internal node could be presented as an
  `(address, amount)` leaf and claimed against — a second-preimage attack.
- **The amount is inside the leaf.** Inflating the amount changes the leaf, so
  the proof stops verifying; a recipient can only ever claim exactly what the
  admin allocated.
- **An odd node at the end of a layer is promoted unchanged** rather than
  hashed with itself, which would let it stand in for its own parent.

Both implementations are pinned to the same test vector:

- `contracts/airdrop/src/lib.rs::test_leaf_hash_matches_cross_language_vector`
- `frontend/lib/__tests__/merkle.test.ts` → "matches the contract's
  cross-language test vector"

If either side's encoding drifts, one of those two tests fails — rather than
the airdrop silently becoming unclaimable.

---

## Admin walkthrough

**`/airdrop`** in the app.

1. **Allocations.** Paste or upload a CSV of `address,amount`. A header row,
   blank lines and `#` comments are ignored; commas and semicolons both work.
   Set the token's decimals so amounts are scaled to base units correctly.

   Rejected rows are listed with their line numbers rather than dropped
   silently — a typo'd address in an airdrop list is a recipient who can never
   claim, so it has to be visible before the root is published. Duplicate
   addresses are rejected too, since only the first leaf for an address would
   ever be claimable.

2. **Build the tree.** Everything happens in the browser; the allocation list
   is never uploaded. You get the Merkle root and a proof file.

3. **Export the proofs.** Download `airdrop-proofs-<root>.json`:

   ```json
   {
     "root": "…64 hex chars…",
     "total": "5500000000",
     "count": 2,
     "entries": [
       { "address": "G…", "amount": "1000000000", "proof": ["…", "…"] }
     ]
   }
   ```

   **Keep this file.** Proofs cannot be recovered from the chain — only the
   root is stored there. Host it, or send each recipient their entry.

4. **Publish and fund.** Point the page at a deployed airdrop contract, set the
   deadline ledger, publish the root, then fund the contract with the total.

5. **Reclaim.** After the deadline, call `reclaim_unclaimed()` to sweep the
   remainder back.

---

## Recipient walkthrough

**`/airdrop/<contractId>`** in the app.

1. Connect a wallet.
2. Load the proof file the admin published. It stays in the browser.
3. The page finds the connected wallet's entry, checks the proof against the
   root the contract actually published, and confirms with the contract's own
   `verify_proof` before offering to claim — so a stale or hand-edited proof
   file is caught before anyone is asked to sign.
4. Claim. The recipient pays the transaction fee.

---

## Deploying the contract

The airdrop contract is deployed the same way as the vesting contract — the
launchpad's `scripts/deploy.ts` only handles the token.

```bash
# Build
cargo build -p soroban-airdrop --target wasm32-unknown-unknown --release

# Deploy (one airdrop contract per distribution)
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/soroban_airdrop.wasm \
  --network testnet \
  --source admin
```

Deploy a fresh contract per airdrop: `initialize` is one-shot, so a contract
is bound to a single root and deadline for its lifetime.

---

## Design notes

**Why a separate `fund` step?** So the root can be published before the
treasury is topped up, and so an under-funded airdrop can be topped up again
without redeploying. Nothing stops an admin transferring to the contract
address directly; `fund` just makes it one flow and emits an event to index.

**Why is `claim` marked before the transfer?** Checks-effects-interactions: the
claim marker is written before any value moves, so a re-entrant token callback
cannot come back around and claim twice.

**Why is the claim marker's TTL tied to the deadline?** So it still exists when
`reclaim_unclaimed` closes the airdrop. An archived marker must never be the
reason a second claim succeeds.

**Why cap proofs at 32 hashes?** A proof of length *n* authenticates up to
2^*n* leaves, so 32 covers 4.3 billion recipients. The cap stops a caller
burning unbounded CPU on a huge proof that was always going to fail.

**Why can't `claim` run after `reclaim_unclaimed`?** Claiming closes at the
deadline and reclaiming only opens after it, so the deadline check alone keeps
the two disjoint.
