#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Bytes, BytesN, Env, Vec,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Desired lifetime for the ledger entries this contract keeps alive:
/// about a year, assuming Stellar's ~5s ledger close time.
///
/// 365 days * 24h * 60m * 60s / 5s-per-ledger = 6,307,200 ledgers.
///
/// This is only a *request*. The effective window is whatever the network
/// allows — `env.storage().max_ttl()`, read at call time — and every
/// `extend_ttl` site clamps to it. On testnet and mainnet today
/// `max_entry_ttl` is 3,110,400 ledgers (a network setting, changed by
/// validator vote), so entries actually live **about 180 days, not a year**.
/// Anyone relying on an entry outliving that window has to interact with
/// the contract at least once per window.
///
/// Deliberately not compared against a hardcoded ceiling: the previous
/// constant here (6,312,000) was the soroban-sdk *test harness* default
/// (`soroban-sdk/src/env.rs`), not a network value, so the clamp it fed
/// could never fire. The test environment still reports 6,312,000, which is
/// why no test in this file asserts a specific network figure.
const TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;

/// Upper bound on the length of a submitted Merkle proof.
///
/// A proof of length `n` authenticates a tree of up to `2^n` leaves, so 32
/// covers 4.3 billion recipients — far beyond any realistic airdrop. The cap
/// exists so a caller cannot burn unbounded CPU by submitting a huge proof
/// that was always going to fail verification.
const MAX_PROOF_LEN: u32 = 32;

/// Domain-separation tag mixed into leaf hashes.
///
/// Leaves and internal nodes are hashed with different prefixes so that a
/// 32-byte internal node can never be reinterpreted as a valid
/// `(address, amount)` leaf. Without this, a second-preimage attack lets a
/// caller present an internal node as a leaf and claim against it.
const LEAF_DOMAIN: u8 = 0x00;

/// Domain-separation tag mixed into internal node hashes. See [`LEAF_DOMAIN`].
const NODE_DOMAIN: u8 = 0x01;

/// Scratch buffer size for a stringified `Address`.
///
/// Stellar strkeys (`G…` accounts, `C…` contracts) are 56 ASCII characters;
/// 64 leaves headroom without reaching for the heap in a `no_std` contract.
const MAX_STRKEY_LEN: usize = 64;

/// How far `extend_deadline` may push the deadline past the *current* ledger,
/// expressed as a multiple of the claim horizon `initialize` was called with.
///
/// Two, so an airdrop that turns out to need twice as long can be given it on
/// the same deployment — while a horizon meant to be a week can never quietly
/// become a decade.
const DEADLINE_EXTENSION_FACTOR: u32 = 2;

/// Maximum lifetime for an admin transfer proposal before it becomes invalid.
///
/// This is a deadline in ledger numbers, not a storage TTL, so it is not
/// clamped to `max_ttl()`. Note the instance entry holding the proposal is
/// clamped, so on today's networks the entry's ~180-day window expires before
/// this ~365-day deadline does; a proposal left untouched that long needs the
/// instance kept alive by any other call. Every admin mutation below calls
/// `_bump_instance`, which is what keeps that entry alive.
const ADMIN_PROPOSAL_EXPIRY_LEDGERS: u32 = TTL_LEDGERS;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Typed contract errors for the airdrop contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AirdropError {
    /// `initialize` was called on a contract that is already initialized.
    AlreadyInitialized = 1,
    /// Operation attempted before `initialize` was called.
    NotInitialized = 2,
    /// `deadline_ledger` is not strictly after the current ledger (or, for
    /// `extend_deadline`, not strictly after the deadline already in force).
    InvalidDeadline = 3,
    /// Amount is zero or negative where a positive value is required.
    InvalidAmount = 4,
    /// This recipient has already claimed their allocation.
    AlreadyClaimed = 5,
    /// The submitted proof does not authenticate `(recipient, amount)`
    /// against the published Merkle root.
    InvalidProof = 6,
    /// `claim` was called after `deadline_ledger`.
    DeadlinePassed = 7,
    /// `reclaim_unclaimed` was called at or before `deadline_ledger`.
    DeadlineNotReached = 8,
    /// The airdrop has been closed by `reclaim_unclaimed`, which is
    /// single-shot: afterwards `fund` and `extend_deadline` are refused too.
    AlreadyReclaimed = 9,
    /// `reclaim_unclaimed` was called with an empty contract balance.
    NothingToReclaim = 10,
    /// The submitted proof is longer than [`MAX_PROOF_LEN`].
    ProofTooLong = 11,
    /// The recipient's strkey does not fit [`MAX_STRKEY_LEN`].
    AddressTooLong = 12,
    /// An `i128` addition overflowed while accumulating claimed totals.
    AmountOverflow = 13,
    /// `extend_deadline` was asked for a deadline beyond the extension bound
    /// (the current ledger plus [`DEADLINE_EXTENSION_FACTOR`] × the original
    /// claim horizon).
    DeadlineTooFar = 14,
    /// The contract is permanently locked (`revoke_admin` was called).
    Locked = 15,
    /// The contract is paused.
    Paused = 16,
    /// `accept_admin` was called with no pending proposal.
    NoPendingAdmin = 17,
    /// `accept_admin` was called after the proposal's expiry ledger.
    ProposalExpired = 18,
    /// WASM hash supplied to `upgrade` is the all-zeros sentinel.
    InvalidWasmHash = 19,
    /// `propose_admin` was called with the address that is already admin.
    InvalidAdmin = 20,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// The address that funds, extends, reclaims and reconfigures this
    /// airdrop. Removed by `revoke_admin`.
    Admin,
    /// The address proposed by `propose_admin`, waiting on `accept_admin`.
    PendingAdmin,
    /// Ledger at which `PendingAdmin` lapses. Written alongside
    /// `PendingAdmin`, cleared alongside it.
    PendingAdminExpiry,
    Token,
    MerkleRoot,
    DeadlineLedger,
    /// The claim window `initialize` was called with, in ledgers —
    /// `deadline_ledger` minus the ledger it was set on. Recorded once so
    /// `extend_deadline` has an original horizon to bound itself against.
    DeadlineHorizon,
    /// Set once on the first successful `initialize` and never removed.
    Initialized,
    /// Set to `true` by `reclaim_unclaimed`, making the sweep single-shot.
    Reclaimed,
    /// Set to `true` by `revoke_admin`, making the loss of admin permanent.
    /// Unlike `Admin` (which `revoke_admin` deletes), this is never cleared,
    /// so revoking admin can never re-open an admin operation.
    Locked,
    /// Set by `pause`, removed by `unpause`. While present, value-moving
    /// operations (`fund`, `claim`, `reclaim_unclaimed`) and `accept_admin`
    /// are refused with [`AirdropError::Paused`].
    IsPaused,
    TotalClaimed,
    /// Persistent per-recipient claim marker holding the claimed amount.
    /// Its presence is what prevents a second claim.
    Claimed(Address),
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/// Merkle-proof airdrop distribution.
///
/// The admin publishes a single Merkle root committing to the whole
/// `(address, amount)` allocation list, funds the contract once, and is done.
/// Each recipient then claims against a proof and pays their own transaction
/// fee, so the admin's cost is one transaction regardless of list size —
/// compared with `mint_batch`, which caps at 100 recipients per call and
/// bills every one of them to the admin.
///
/// ## Leaf and node encoding
///
/// Proofs are built off chain (see `frontend/lib/merkle.ts`), so both sides
/// must agree on the hashing byte-for-byte:
///
/// ```text
/// leaf(addr, amount) = keccak256(0x00 || ascii(strkey(addr)) || be_i128(amount))
/// node(a, b)         = keccak256(0x01 || min(a, b) || max(a, b))
/// ```
///
/// Sibling pairs are sorted before hashing, so a proof carries no
/// left/right direction bits. The `0x00` / `0x01` prefixes keep the leaf and
/// node domains disjoint (see [`LEAF_DOMAIN`]).
#[contract]
pub struct AirdropContract;

#[contractimpl]
impl AirdropContract {
    /// Publish an airdrop: the token being distributed, the admin who funds
    /// and later reclaims it, the Merkle root committing to the allocation
    /// list, and the ledger after which claiming closes.
    ///
    /// The contract holds no tokens yet — call `fund` (or transfer to this
    /// contract's address directly) before recipients can claim.
    pub fn initialize(
        env: Env,
        token: Address,
        admin: Address,
        merkle_root: BytesN<32>,
        deadline_ledger: u32,
    ) {
        if env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(&env, AirdropError::AlreadyInitialized);
        }
        admin.require_auth();

        if deadline_ledger <= env.ledger().sequence() {
            panic_with_error!(&env, AirdropError::InvalidDeadline);
        }

        let storage = env.storage().instance();
        storage.set(&DataKey::Initialized, &true);
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::MerkleRoot, &merkle_root);
        storage.set(&DataKey::DeadlineLedger, &deadline_ledger);
        // The check above makes this subtraction exact; it is the horizon
        // `extend_deadline` measures its bound against.
        storage.set(
            &DataKey::DeadlineHorizon,
            &(deadline_ledger - env.ledger().sequence()),
        );
        storage.set(&DataKey::TotalClaimed, &0i128);
        storage.set(&DataKey::Reclaimed, &false);
        let ttl = Self::_ttl_ledgers(&env);
        storage.extend_ttl(ttl, ttl);

        env.events().publish(
            (symbol_short!("init"), admin),
            (token, merkle_root, deadline_ledger),
        );
    }

    // -----------------------------------------------------------------------
    // Administration
    //
    // Deliberately the same surface as the token contract (see
    // docs/admin-capability-matrix.md): two-step transfer with an expiry,
    // revoke_admin, pause/unpause, upgrade, and an event for every one of
    // them.
    // -----------------------------------------------------------------------

    /// Propose a new admin. Must be called by the current admin.
    /// The new admin must call `accept_admin` to finalize the transfer.
    ///
    /// The proposal lapses [`ADMIN_PROPOSAL_EXPIRY_LEDGERS`] ledgers after it
    /// is made; `pending_admin()` stops reporting it from that ledger on.
    pub fn propose_admin(env: Env, new_admin: Address) {
        let current_admin = Self::_require_admin(&env);
        if new_admin == current_admin {
            panic_with_error!(&env, AirdropError::InvalidAdmin);
        }

        let expiry_ledger = env
            .ledger()
            .sequence()
            .saturating_add(ADMIN_PROPOSAL_EXPIRY_LEDGERS);
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        env.storage()
            .instance()
            .set(&DataKey::PendingAdminExpiry, &expiry_ledger);

        Self::_bump_instance(&env);
        env.events()
            .publish((symbol_short!("prop_adm"), current_admin, new_admin), ());
    }

    /// Cancel a pending admin transfer. Must be called by the current admin.
    pub fn cancel_admin_proposal(env: Env) {
        Self::_require_admin(&env);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage()
            .instance()
            .remove(&DataKey::PendingAdminExpiry);

        Self::_bump_instance(&env);
        env.events().publish((symbol_short!("cncl_adm"),), ());
    }

    /// Accept the admin role. Must be called by the pending admin.
    pub fn accept_admin(env: Env) {
        Self::_require_not_locked(&env);
        Self::_check_paused(&env);

        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .unwrap_or_else(|| panic_with_error!(&env, AirdropError::NoPendingAdmin));
        let expiry_ledger: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdminExpiry)
            .unwrap_or(0);
        if env.ledger().sequence() >= expiry_ledger {
            panic_with_error!(&env, AirdropError::ProposalExpired);
        }

        pending.require_auth();
        let old_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, AirdropError::NotInitialized));
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage()
            .instance()
            .remove(&DataKey::PendingAdminExpiry);

        Self::_bump_instance(&env);
        env.events()
            .publish((symbol_short!("set_admin"), old_admin, pending), ());
    }

    /// Permanently revoke the admin role and lock the contract.
    ///
    /// After this call:
    /// - `fund`, `claim`, `reclaim_unclaimed`, `extend_deadline`,
    ///   `propose_admin`, `accept_admin`, `pause`, `unpause` and `upgrade`
    ///   can never succeed again.
    /// - The `Admin` storage entry is removed and a `Locked` flag is set.
    /// - `is_locked()` returns `true` from then on.
    ///
    /// Recipients can still `claim` up to the deadline, and the contract can
    /// no longer be reconfigured by anyone.
    ///
    /// **Ordering matters here, more than on the token:** `reclaim_unclaimed`
    /// is the only way the unclaimed remainder leaves this contract, and it
    /// needs an admin to sweep to. Call `reclaim_unclaimed` *first*, let the
    /// airdrop close, and only then revoke — revoking first strands whatever
    /// is still unclaimed, permanently and irreversibly.
    ///
    /// **This action is irreversible.**
    pub fn revoke_admin(env: Env) {
        Self::_require_admin(&env);
        env.storage().instance().set(&DataKey::Locked, &true);
        env.storage().instance().remove(&DataKey::Admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage()
            .instance()
            .remove(&DataKey::PendingAdminExpiry);

        Self::_bump_instance(&env);
        env.events().publish((symbol_short!("revoked"),), true);
    }

    /// Pause the airdrop. Admin only.
    ///
    /// While paused, `fund`, `claim` and `reclaim_unclaimed` are refused with
    /// [`AirdropError::Paused`], as is `accept_admin` — an in-flight transfer
    /// cannot complete while the contract is halted. Read-only getters and
    /// `extend_deadline` keep working so the state stays inspectable.
    pub fn pause(env: Env) {
        Self::_require_admin(&env);
        env.storage().instance().set(&DataKey::IsPaused, &true);

        Self::_bump_instance(&env);
        env.events().publish((symbol_short!("pause"),), ());
    }

    /// Unpause the airdrop. Admin only.
    pub fn unpause(env: Env) {
        Self::_require_admin(&env);
        env.storage().instance().remove(&DataKey::IsPaused);

        Self::_bump_instance(&env);
        env.events().publish((symbol_short!("unpause"),), ());
    }

    /// Upgrade this contract's WASM code hash in place. Admin only.
    ///
    /// Security note: this preserves existing storage and contract address, so
    /// new WASM must remain storage-compatible with previous deployments.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::_require_admin(&env);
        if new_wasm_hash == BytesN::from_array(&env, &[0; 32]) {
            panic_with_error!(&env, AirdropError::InvalidWasmHash);
        }
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        Self::_bump_instance(&env);
        env.events()
            .publish((symbol_short!("upgrade"),), new_wasm_hash);
    }

    /// Move `amount` tokens from `from` into this contract so recipients have
    /// something to claim against.
    ///
    /// Separate from `initialize` so the root can be published before the
    /// treasury is topped up, and so an under-funded airdrop can be topped up
    /// again later without redeploying — including after the deadline passes,
    /// provided `extend_deadline` has pushed it back out first.
    ///
    /// Refused once `reclaim_unclaimed` has closed the airdrop, with
    /// [`AirdropError::AlreadyReclaimed`]: a reclaimed contract can move
    /// nothing out of itself any more, so every token accepted here would be
    /// stuck until an admin `upgrade` replaces the logic. A closed airdrop
    /// needs a fresh deployment instead.
    pub fn fund(env: Env, from: Address, amount: i128) {
        Self::_require_initialized(&env);
        Self::_check_paused(&env);
        from.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, AirdropError::InvalidAmount);
        }
        if Self::_is_reclaimed(&env) {
            panic_with_error!(&env, AirdropError::AlreadyReclaimed);
        }

        let token_addr = Self::_token(&env);
        token::Client::new(&env, &token_addr).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        Self::_bump_instance(&env);
        env.events().publish((symbol_short!("fund"), from), amount);
    }

    /// Claim `amount` for `recipient` against `proof`.
    ///
    /// Authorised by the recipient, so each claimer pays their own fee. A
    /// successful claim is recorded permanently, making a second call fail
    /// with [`AirdropError::AlreadyClaimed`] even if the proof is still valid.
    pub fn claim(env: Env, recipient: Address, amount: i128, proof: Vec<BytesN<32>>) {
        Self::_require_initialized(&env);
        Self::_check_paused(&env);
        recipient.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, AirdropError::InvalidAmount);
        }
        if proof.len() > MAX_PROOF_LEN {
            panic_with_error!(&env, AirdropError::ProofTooLong);
        }
        // Claiming closes at the deadline and reclaiming only opens after it,
        // so this single check is also what stops a claim from draining a
        // balance the admin has already swept.
        if env.ledger().sequence() > Self::_deadline(&env) {
            panic_with_error!(&env, AirdropError::DeadlinePassed);
        }

        let claim_key = DataKey::Claimed(recipient.clone());
        if env.storage().persistent().has(&claim_key) {
            panic_with_error!(&env, AirdropError::AlreadyClaimed);
        }

        if !Self::_verify_proof(&env, &recipient, amount, &proof) {
            panic_with_error!(&env, AirdropError::InvalidProof);
        }

        // Record the claim before moving any value, so a re-entrant token
        // callback cannot come back around and claim a second time.
        env.storage().persistent().set(&claim_key, &amount);
        let ttl = Self::_claim_ttl(&env);
        env.storage().persistent().extend_ttl(&claim_key, ttl, ttl);

        let total_claimed = Self::total_claimed(env.clone())
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, AirdropError::AmountOverflow));
        env.storage()
            .instance()
            .set(&DataKey::TotalClaimed, &total_claimed);

        let token_addr = Self::_token(&env);
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &recipient,
            &amount,
        );

        Self::_bump_instance(&env);
        env.events()
            .publish((symbol_short!("claim"), recipient), amount);
    }

    /// After the deadline, sweep whatever is left back to the admin and
    /// return the amount swept.
    ///
    /// Single-shot: once reclaimed, the airdrop is closed for good and any
    /// later `claim` fails rather than draining a re-funded balance. `fund`
    /// and `extend_deadline` refuse afterwards too, so no tokens can be added
    /// to a balance this contract can no longer sweep out.
    pub fn reclaim_unclaimed(env: Env) -> i128 {
        Self::_require_initialized(&env);
        Self::_check_paused(&env);
        let admin = Self::_require_admin(&env);

        if env.ledger().sequence() <= Self::_deadline(&env) {
            panic_with_error!(&env, AirdropError::DeadlineNotReached);
        }
        if Self::_is_reclaimed(&env) {
            panic_with_error!(&env, AirdropError::AlreadyReclaimed);
        }

        let token_addr = Self::_token(&env);
        let token_client = token::Client::new(&env, &token_addr);
        let remaining = token_client.balance(&env.current_contract_address());
        if remaining <= 0 {
            panic_with_error!(&env, AirdropError::NothingToReclaim);
        }

        env.storage().instance().set(&DataKey::Reclaimed, &true);
        token_client.transfer(&env.current_contract_address(), &admin, &remaining);

        Self::_bump_instance(&env);
        env.events()
            .publish((symbol_short!("reclaim"), admin), remaining);

        remaining
    }

    /// Push `deadline_ledger` further out so the airdrop can run another round
    /// on this deployment.
    ///
    /// Admin-only, and refused once `reclaim_unclaimed` has closed the
    /// airdrop: reclaiming is single-shot, so a closed airdrop stays closed
    /// and anything funded after it would be stranded (see `fund`).
    ///
    /// The new deadline must be in the future and strictly later than the one
    /// already in force — the deadline is a promise to recipients, so this
    /// moves only one way — and it may not pass the current ledger plus
    /// [`DEADLINE_EXTENSION_FACTOR`] × the horizon `initialize` was called
    /// with. The bound is what keeps a week-long airdrop from being extended
    /// into a decade; going further needs a new deployment.
    pub fn extend_deadline(env: Env, deadline_ledger: u32) {
        Self::_require_initialized(&env);
        let admin = Self::_require_admin(&env);

        if Self::_is_reclaimed(&env) {
            panic_with_error!(&env, AirdropError::AlreadyReclaimed);
        }

        let current = env.ledger().sequence();
        let previous = Self::_deadline(&env);
        if deadline_ledger <= current || deadline_ledger <= previous {
            panic_with_error!(&env, AirdropError::InvalidDeadline);
        }

        let bound =
            current.saturating_add(Self::_horizon(&env).saturating_mul(DEADLINE_EXTENSION_FACTOR));
        if deadline_ledger > bound {
            panic_with_error!(&env, AirdropError::DeadlineTooFar);
        }

        env.storage()
            .instance()
            .set(&DataKey::DeadlineLedger, &deadline_ledger);

        Self::_bump_instance(&env);
        env.events().publish(
            (symbol_short!("extend"), admin),
            (previous, deadline_ledger),
        );
    }

    // -----------------------------------------------------------------------
    // Read-only getters
    // -----------------------------------------------------------------------

    pub fn get_admin(env: Env) -> Address {
        Self::_admin(&env)
    }

    /// Returns the address proposed via `propose_admin` that has not yet
    /// accepted the role, or `None` when no two-step transfer is in
    /// progress. The entry is written by `propose_admin` and cleared by
    /// `accept_admin`, `cancel_admin_proposal`, or `revoke_admin`; if the
    /// proposal has expired it is also cleared so stale state does not linger.
    pub fn pending_admin(env: Env) -> Option<Address> {
        let expiry_ledger: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdminExpiry)
            .unwrap_or(0);
        if env.ledger().sequence() >= expiry_ledger {
            env.storage().instance().remove(&DataKey::PendingAdmin);
            env.storage()
                .instance()
                .remove(&DataKey::PendingAdminExpiry);
            return None;
        }

        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Returns `true` once `revoke_admin` has been called. Once locked, no
    /// admin operation can ever succeed again.
    pub fn is_locked(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Locked)
            .unwrap_or(false)
    }

    /// Returns `true` if the airdrop is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
    }

    pub fn get_token(env: Env) -> Address {
        Self::_token(&env)
    }

    pub fn get_merkle_root(env: Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&DataKey::MerkleRoot)
            .unwrap_or_else(|| panic_with_error!(&env, AirdropError::NotInitialized))
    }

    pub fn get_deadline_ledger(env: Env) -> u32 {
        Self::_deadline(&env)
    }

    /// Whether `recipient` has already claimed.
    pub fn is_claimed(env: Env, recipient: Address) -> bool {
        env.storage().persistent().has(&DataKey::Claimed(recipient))
    }

    /// How much `recipient` claimed, or `0` if they have not claimed.
    pub fn claimed_amount(env: Env, recipient: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Claimed(recipient))
            .unwrap_or(0)
    }

    /// Total claimed across all recipients so far.
    pub fn total_claimed(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalClaimed)
            .unwrap_or(0)
    }

    pub fn is_reclaimed(env: Env) -> bool {
        Self::_is_reclaimed(&env)
    }

    /// The airdrop's current token balance — what is still available to claim.
    pub fn remaining_balance(env: Env) -> i128 {
        let token_addr = Self::_token(&env);
        token::Client::new(&env, &token_addr).balance(&env.current_contract_address())
    }

    /// Check a proof without claiming.
    ///
    /// Lets the frontend tell "you are not on the list" apart from "your
    /// claim failed" before asking anyone to sign a transaction.
    pub fn verify_proof(
        env: Env,
        recipient: Address,
        amount: i128,
        proof: Vec<BytesN<32>>,
    ) -> bool {
        if amount <= 0 || proof.len() > MAX_PROOF_LEN {
            return false;
        }
        Self::_verify_proof(&env, &recipient, amount, &proof)
    }

    /// The leaf hash for `(recipient, amount)`.
    ///
    /// Exposed so an off-chain tree builder can be tested against the exact
    /// bytes this contract hashes, rather than against a re-implementation.
    pub fn leaf_hash(env: Env, recipient: Address, amount: i128) -> BytesN<32> {
        Self::_leaf_hash(&env, &recipient, amount)
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn _require_initialized(env: &Env) {
        if !env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(env, AirdropError::NotInitialized);
        }
    }

    fn _admin(env: &Env) -> Address {
        Self::_require_not_locked(env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, AirdropError::NotInitialized))
    }

    /// Admin gate for every mutating admin operation: the contract must not
    /// be locked, and the caller must be the current admin.
    fn _require_admin(env: &Env) -> Address {
        let admin = Self::_admin(env);
        admin.require_auth();
        admin
    }

    fn _require_not_locked(env: &Env) {
        let locked: bool = env
            .storage()
            .instance()
            .get(&DataKey::Locked)
            .unwrap_or(false);
        if locked {
            panic_with_error!(env, AirdropError::Locked);
        }
    }

    /// Circuit breaker. Gates the value-moving operations — `fund`, `claim`,
    /// `reclaim_unclaimed` — plus `accept_admin`, so an in-flight admin
    /// transfer cannot complete while the contract is halted. Policy setters
    /// (`extend_deadline`) and read-only getters stay available.
    fn _check_paused(env: &Env) {
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::IsPaused)
            .unwrap_or(false)
        {
            panic_with_error!(env, AirdropError::Paused);
        }
    }

    fn _token(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .unwrap_or_else(|| panic_with_error!(env, AirdropError::NotInitialized))
    }

    fn _deadline(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DeadlineLedger)
            .unwrap_or_else(|| panic_with_error!(env, AirdropError::NotInitialized))
    }

    /// The claim horizon `initialize` recorded: how many ledgers the original
    /// deadline was set out from the ledger it was set on.
    fn _horizon(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DeadlineHorizon)
            .unwrap_or_else(|| panic_with_error!(env, AirdropError::NotInitialized))
    }

    fn _is_reclaimed(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Reclaimed)
            .unwrap_or(false)
    }

    fn _bump_instance(env: &Env) {
        let ttl = Self::_ttl_ledgers(env);
        env.storage().instance().extend_ttl(ttl, ttl);
    }

    /// The TTL to request for this contract's instance entry: our desired
    /// window, capped at what the network will actually honour.
    ///
    /// `soroban-env-host` silently lowers an over-long `extend_ttl` on an
    /// instance or persistent entry rather than erroring, so an unclamped
    /// call is not a hard failure — it just quietly gets you a shorter entry
    /// than the code appears to ask for. Clamping here keeps the requested
    /// and effective values the same, so the archival window is legible from
    /// the source.
    fn _ttl_ledgers(env: &Env) -> u32 {
        TTL_LEDGERS.min(env.storage().max_ttl())
    }

    /// TTL for a claim marker: far enough out that it still exists when
    /// `reclaim_unclaimed` closes the airdrop, so an archived marker can
    /// never be the reason a second claim succeeds.
    ///
    /// Ledgers left until the deadline are the target when they exceed the
    /// default horizon; `TTL_LEDGERS` is the floor when they do not. Either
    /// way the result is capped at `env.storage().max_ttl()`, because the
    /// host silently lowers anything above the network's `max_entry_ttl`.
    fn _claim_ttl(env: &Env) -> u32 {
        let deadline = Self::_deadline(env);
        let current = env.ledger().sequence();
        let remaining = deadline.saturating_sub(current);
        remaining.max(TTL_LEDGERS).min(env.storage().max_ttl())
    }

    /// `keccak256(0x00 || ascii(strkey(recipient)) || be_i128(amount))`.
    fn _leaf_hash(env: &Env, recipient: &Address, amount: i128) -> BytesN<32> {
        let strkey = recipient.to_string();
        let len = strkey.len() as usize;
        if len > MAX_STRKEY_LEN {
            panic_with_error!(env, AirdropError::AddressTooLong);
        }

        let mut strkey_buf = [0u8; MAX_STRKEY_LEN];
        strkey.copy_into_slice(&mut strkey_buf[..len]);

        let mut preimage = Bytes::new(env);
        preimage.extend_from_array(&[LEAF_DOMAIN]);
        preimage.extend_from_slice(&strkey_buf[..len]);
        preimage.extend_from_array(&amount.to_be_bytes());

        env.crypto().keccak256(&preimage).into()
    }

    /// `keccak256(0x01 || min(a, b) || max(a, b))`.
    fn _hash_pair(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
        let (first, second) = {
            let (a_arr, b_arr) = (a.to_array(), b.to_array());
            if a_arr <= b_arr {
                (a_arr, b_arr)
            } else {
                (b_arr, a_arr)
            }
        };

        let mut preimage = Bytes::new(env);
        preimage.extend_from_array(&[NODE_DOMAIN]);
        preimage.extend_from_array(&first);
        preimage.extend_from_array(&second);

        env.crypto().keccak256(&preimage).into()
    }

    fn _verify_proof(
        env: &Env,
        recipient: &Address,
        amount: i128,
        proof: &Vec<BytesN<32>>,
    ) -> bool {
        let mut computed = Self::_leaf_hash(env, recipient, amount);
        for sibling in proof.iter() {
            computed = Self::_hash_pair(env, &computed, &sibling);
        }
        computed == Self::get_merkle_root(env.clone())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        testutils::Events as _,
        testutils::Ledger as _,
        testutils::{MockAuth, MockAuthInvoke},
        token::StellarAssetClient,
        IntoVal, String,
    };

    // ── Off-chain tree builder ──────────────────────────────────────────
    //
    // A deliberately separate implementation of the same scheme the frontend
    // uses (`frontend/lib/merkle.ts`). Tests build a tree with it, then hand
    // the resulting root and proofs to the contract — so a divergence between
    // how the tree is built and how it is verified shows up as a failing
    // proof rather than as a silently unclaimable airdrop.

    fn leaf_of(env: &Env, addr: &Address, amount: i128) -> BytesN<32> {
        let strkey = addr.to_string();
        let len = strkey.len() as usize;
        let mut buf = [0u8; MAX_STRKEY_LEN];
        strkey.copy_into_slice(&mut buf[..len]);

        let mut preimage = Bytes::new(env);
        preimage.extend_from_array(&[LEAF_DOMAIN]);
        preimage.extend_from_slice(&buf[..len]);
        preimage.extend_from_array(&amount.to_be_bytes());
        env.crypto().keccak256(&preimage).into()
    }

    fn node_of(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
        let (x, y) = {
            let (aa, bb) = (a.to_array(), b.to_array());
            if aa <= bb {
                (aa, bb)
            } else {
                (bb, aa)
            }
        };
        let mut preimage = Bytes::new(env);
        preimage.extend_from_array(&[NODE_DOMAIN]);
        preimage.extend_from_array(&x);
        preimage.extend_from_array(&y);
        env.crypto().keccak256(&preimage).into()
    }

    /// Build every layer of the tree, bottom-up. An odd node at the end of a
    /// layer is promoted unchanged to the next one.
    fn build_layers(env: &Env, leaves: &Vec<BytesN<32>>) -> Vec<Vec<BytesN<32>>> {
        let mut layers: Vec<Vec<BytesN<32>>> = Vec::new(env);
        layers.push_back(leaves.clone());

        loop {
            let current = layers.get(layers.len() - 1).unwrap();
            if current.len() <= 1 {
                break;
            }
            let mut next: Vec<BytesN<32>> = Vec::new(env);
            let mut i = 0u32;
            while i < current.len() {
                if i + 1 < current.len() {
                    let a = current.get(i).unwrap();
                    let b = current.get(i + 1).unwrap();
                    next.push_back(node_of(env, &a, &b));
                } else {
                    next.push_back(current.get(i).unwrap());
                }
                i += 2;
            }
            layers.push_back(next);
        }

        layers
    }

    fn root_of(env: &Env, leaves: &Vec<BytesN<32>>) -> BytesN<32> {
        let layers = build_layers(env, leaves);
        layers
            .get(layers.len() - 1)
            .unwrap()
            .get(0)
            .expect("empty tree has no root")
    }

    fn proof_for(env: &Env, leaves: &Vec<BytesN<32>>, mut index: u32) -> Vec<BytesN<32>> {
        let layers = build_layers(env, leaves);
        let mut proof: Vec<BytesN<32>> = Vec::new(env);

        for depth in 0..layers.len() - 1 {
            let layer = layers.get(depth).unwrap();
            let sibling = if index.is_multiple_of(2) {
                index + 1
            } else {
                index - 1
            };
            if sibling < layer.len() {
                proof.push_back(layer.get(sibling).unwrap());
            }
            index /= 2;
        }

        proof
    }

    // ── Fixtures ────────────────────────────────────────────────────────

    struct Airdrop {
        env: Env,
        client: AirdropContractClient<'static>,
        token: Address,
        token_admin: StellarAssetClient<'static>,
        admin: Address,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
        leaves: Vec<BytesN<32>>,
    }

    const DEADLINE: u32 = 10_000;

    /// A funded airdrop over `n` recipients, each allocated
    /// `(i + 1) * 100` stroops, with the tree already published.
    fn setup(n: u32) -> Airdrop {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let token_admin = StellarAssetClient::new(&env, &token);

        let mut recipients: Vec<Address> = Vec::new(&env);
        let mut amounts: Vec<i128> = Vec::new(&env);
        let mut leaves: Vec<BytesN<32>> = Vec::new(&env);
        let mut total: i128 = 0;

        for i in 0..n {
            let addr = Address::generate(&env);
            let amount = ((i + 1) as i128) * 100;
            leaves.push_back(leaf_of(&env, &addr, amount));
            recipients.push_back(addr);
            amounts.push_back(amount);
            total += amount;
        }

        let root = root_of(&env, &leaves);

        let contract_id = env.register_contract(None, AirdropContract);
        let client = AirdropContractClient::new(&env, &contract_id);
        client.initialize(&token, &admin, &root, &DEADLINE);

        token_admin.mint(&admin, &total);
        client.fund(&admin, &total);

        Airdrop {
            env,
            client,
            token,
            token_admin,
            admin,
            recipients,
            amounts,
            leaves,
        }
    }

    fn balance_of(env: &Env, token: &Address, who: &Address) -> i128 {
        token::Client::new(env, token).balance(who)
    }

    // ── Initialization ──────────────────────────────────────────────────

    #[test]
    fn test_initialize_stores_configuration() {
        let a = setup(4);
        assert_eq!(a.client.get_admin(), a.admin);
        assert_eq!(a.client.get_token(), a.token);
        assert_eq!(a.client.get_deadline_ledger(), DEADLINE);
        assert_eq!(a.client.get_merkle_root(), root_of(&a.env, &a.leaves));
        assert_eq!(a.client.total_claimed(), 0);
        assert!(!a.client.is_reclaimed());
    }

    #[test]
    fn test_double_initialize_fails() {
        let a = setup(2);
        let root = root_of(&a.env, &a.leaves);
        assert_eq!(
            a.client
                .try_initialize(&a.token, &a.admin, &root, &DEADLINE),
            Err(Ok(AirdropError::AlreadyInitialized.into()))
        );
    }

    #[test]
    fn test_initialize_rejects_past_deadline() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(500);

        let admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register_contract(None, AirdropContract);
        let client = AirdropContractClient::new(&env, &contract_id);
        let root = BytesN::from_array(&env, &[7u8; 32]);

        assert_eq!(
            client.try_initialize(&token, &admin, &root, &400),
            Err(Ok(AirdropError::InvalidDeadline.into()))
        );
    }

    #[test]
    fn test_calls_before_initialize_fail() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AirdropContract);
        let client = AirdropContractClient::new(&env, &contract_id);
        let who = Address::generate(&env);

        assert_eq!(
            client.try_claim(&who, &100, &Vec::new(&env)),
            Err(Ok(AirdropError::NotInitialized.into()))
        );
        assert_eq!(
            client.try_fund(&who, &100),
            Err(Ok(AirdropError::NotInitialized.into()))
        );
        assert_eq!(
            client.try_reclaim_unclaimed(),
            Err(Ok(AirdropError::NotInitialized.into()))
        );
        assert_eq!(
            client.try_extend_deadline(&(DEADLINE + 1)),
            Err(Ok(AirdropError::NotInitialized.into()))
        );
    }

    // ── Funding ─────────────────────────────────────────────────────────

    #[test]
    fn test_fund_moves_tokens_into_the_contract() {
        let a = setup(3);
        // setup() already funded the exact allocation total: 100 + 200 + 300.
        assert_eq!(a.client.remaining_balance(), 600);

        a.token_admin.mint(&a.admin, &50);
        a.client.fund(&a.admin, &50);
        assert_eq!(a.client.remaining_balance(), 650);
    }

    #[test]
    fn test_fund_rejects_non_positive_amount() {
        let a = setup(2);
        assert_eq!(
            a.client.try_fund(&a.admin, &0),
            Err(Ok(AirdropError::InvalidAmount.into()))
        );
        assert_eq!(
            a.client.try_fund(&a.admin, &-1),
            Err(Ok(AirdropError::InvalidAmount.into()))
        );
    }

    /// The regression this whole path exists for: reclaim sweeps the balance
    /// out and closes the airdrop, so a later top-up must not be able to park
    /// tokens in a contract that can no longer move them.
    #[test]
    fn test_fund_after_reclaim_fails() {
        let a = setup(4);
        a.env.ledger().set_sequence_number(DEADLINE + 1);
        a.client.reclaim_unclaimed();
        assert!(a.client.is_reclaimed());

        a.token_admin.mint(&a.admin, &500);
        let admin_before = balance_of(&a.env, &a.token, &a.admin);
        assert_eq!(
            a.client.try_fund(&a.admin, &500),
            Err(Ok(AirdropError::AlreadyReclaimed.into()))
        );

        // Nothing moved: the contract still holds nothing it cannot sweep.
        assert_eq!(a.client.remaining_balance(), 0);
        assert_eq!(balance_of(&a.env, &a.token, &a.admin), admin_before);
    }

    // ── Claiming ────────────────────────────────────────────────────────

    #[test]
    fn test_claim_single_recipient_tree() {
        // A one-leaf tree: the root *is* the leaf and the proof is empty.
        let a = setup(1);
        let who = a.recipients.get(0).unwrap();
        let amount = a.amounts.get(0).unwrap();

        a.client.claim(&who, &amount, &Vec::new(&a.env));

        assert_eq!(balance_of(&a.env, &a.token, &who), amount);
        assert!(a.client.is_claimed(&who));
        assert_eq!(a.client.claimed_amount(&who), amount);
        assert_eq!(a.client.total_claimed(), amount);
    }

    #[test]
    fn test_every_recipient_in_a_balanced_tree_can_claim() {
        let a = setup(4);

        for i in 0..a.recipients.len() {
            let who = a.recipients.get(i).unwrap();
            let amount = a.amounts.get(i).unwrap();
            let proof = proof_for(&a.env, &a.leaves, i);
            a.client.claim(&who, &amount, &proof);
            assert_eq!(balance_of(&a.env, &a.token, &who), amount);
        }

        assert_eq!(a.client.total_claimed(), 100 + 200 + 300 + 400);
        assert_eq!(a.client.remaining_balance(), 0);
    }

    #[test]
    fn test_every_recipient_in_an_unbalanced_tree_can_claim() {
        // 5 leaves exercises the odd-node-promoted path at two layers.
        let a = setup(5);

        for i in 0..a.recipients.len() {
            let who = a.recipients.get(i).unwrap();
            let amount = a.amounts.get(i).unwrap();
            let proof = proof_for(&a.env, &a.leaves, i);
            a.client.claim(&who, &amount, &proof);
            assert_eq!(balance_of(&a.env, &a.token, &who), amount);
        }

        assert_eq!(a.client.total_claimed(), 100 + 200 + 300 + 400 + 500);
    }

    #[test]
    fn test_double_claim_fails() {
        let a = setup(4);
        let who = a.recipients.get(1).unwrap();
        let amount = a.amounts.get(1).unwrap();
        let proof = proof_for(&a.env, &a.leaves, 1);

        a.client.claim(&who, &amount, &proof);
        assert_eq!(
            a.client.try_claim(&who, &amount, &proof),
            Err(Ok(AirdropError::AlreadyClaimed.into()))
        );
        // The second attempt moved nothing.
        assert_eq!(balance_of(&a.env, &a.token, &who), amount);
        assert_eq!(a.client.total_claimed(), amount);
    }

    #[test]
    fn test_claiming_more_than_allocated_fails() {
        let a = setup(4);
        let who = a.recipients.get(2).unwrap();
        let proof = proof_for(&a.env, &a.leaves, 2);

        // The amount is part of the leaf, so inflating it invalidates the proof.
        assert_eq!(
            a.client.try_claim(&who, &99_999, &proof),
            Err(Ok(AirdropError::InvalidProof.into()))
        );
        assert!(!a.client.is_claimed(&who));
    }

    #[test]
    fn test_claim_with_another_recipients_proof_fails() {
        let a = setup(4);
        let attacker = a.recipients.get(3).unwrap();
        let victim_amount = a.amounts.get(0).unwrap();
        let victim_proof = proof_for(&a.env, &a.leaves, 0);

        assert_eq!(
            a.client.try_claim(&attacker, &victim_amount, &victim_proof),
            Err(Ok(AirdropError::InvalidProof.into()))
        );
    }

    #[test]
    fn test_claim_by_address_not_in_the_tree_fails() {
        let a = setup(4);
        let outsider = Address::generate(&a.env);
        let proof = proof_for(&a.env, &a.leaves, 0);

        assert_eq!(
            a.client.try_claim(&outsider, &100, &proof),
            Err(Ok(AirdropError::InvalidProof.into()))
        );
    }

    #[test]
    fn test_claim_rejects_non_positive_amount() {
        let a = setup(4);
        let who = a.recipients.get(0).unwrap();
        assert_eq!(
            a.client.try_claim(&who, &0, &Vec::new(&a.env)),
            Err(Ok(AirdropError::InvalidAmount.into()))
        );
    }

    #[test]
    fn test_claim_rejects_oversized_proof() {
        let a = setup(4);
        let who = a.recipients.get(0).unwrap();

        let mut proof: Vec<BytesN<32>> = Vec::new(&a.env);
        for i in 0..(MAX_PROOF_LEN + 1) {
            proof.push_back(BytesN::from_array(&a.env, &[(i % 256) as u8; 32]));
        }

        assert_eq!(
            a.client.try_claim(&who, &100, &proof),
            Err(Ok(AirdropError::ProofTooLong.into()))
        );
    }

    #[test]
    fn test_internal_node_cannot_be_replayed_as_a_leaf() {
        // Domain separation: an attacker who knows an internal node must not
        // be able to present it as an (address, amount) leaf.
        let a = setup(4);
        let layers = build_layers(&a.env, &a.leaves);
        let internal = layers.get(1).unwrap().get(0).unwrap();

        // There is no (address, amount) whose leaf hash equals an internal
        // node, because leaves are prefixed 0x00 and nodes 0x01.
        let who = a.recipients.get(0).unwrap();
        assert_ne!(leaf_of(&a.env, &who, 100), internal);
    }

    #[test]
    fn test_claim_after_deadline_fails() {
        let a = setup(4);
        let who = a.recipients.get(0).unwrap();
        let amount = a.amounts.get(0).unwrap();
        let proof = proof_for(&a.env, &a.leaves, 0);

        a.env.ledger().set_sequence_number(DEADLINE + 1);
        assert_eq!(
            a.client.try_claim(&who, &amount, &proof),
            Err(Ok(AirdropError::DeadlinePassed.into()))
        );
    }

    #[test]
    fn test_claim_on_the_deadline_ledger_still_succeeds() {
        let a = setup(4);
        let who = a.recipients.get(0).unwrap();
        let amount = a.amounts.get(0).unwrap();
        let proof = proof_for(&a.env, &a.leaves, 0);

        a.env.ledger().set_sequence_number(DEADLINE);
        a.client.claim(&who, &amount, &proof);
        assert_eq!(balance_of(&a.env, &a.token, &who), amount);
    }

    // ── Reclaiming ──────────────────────────────────────────────────────

    #[test]
    fn test_reclaim_before_deadline_fails() {
        let a = setup(4);
        assert_eq!(
            a.client.try_reclaim_unclaimed(),
            Err(Ok(AirdropError::DeadlineNotReached.into()))
        );
    }

    #[test]
    fn test_reclaim_on_the_deadline_ledger_fails() {
        let a = setup(4);
        a.env.ledger().set_sequence_number(DEADLINE);
        assert_eq!(
            a.client.try_reclaim_unclaimed(),
            Err(Ok(AirdropError::DeadlineNotReached.into()))
        );
    }

    #[test]
    fn test_reclaim_returns_only_the_unclaimed_remainder() {
        let a = setup(4);
        let who = a.recipients.get(0).unwrap();
        let amount = a.amounts.get(0).unwrap();
        a.client
            .claim(&who, &amount, &proof_for(&a.env, &a.leaves, 0));

        let admin_before = balance_of(&a.env, &a.token, &a.admin);
        a.env.ledger().set_sequence_number(DEADLINE + 1);

        // Funded 1000, claimed 100.
        assert_eq!(a.client.reclaim_unclaimed(), 900);
        assert_eq!(balance_of(&a.env, &a.token, &a.admin), admin_before + 900);
        assert_eq!(a.client.remaining_balance(), 0);
        assert!(a.client.is_reclaimed());
    }

    #[test]
    fn test_double_reclaim_fails() {
        let a = setup(4);
        a.env.ledger().set_sequence_number(DEADLINE + 1);
        a.client.reclaim_unclaimed();

        a.token_admin.mint(&a.client.address, &500);
        assert_eq!(
            a.client.try_reclaim_unclaimed(),
            Err(Ok(AirdropError::AlreadyReclaimed.into()))
        );
    }

    #[test]
    fn test_reclaim_with_nothing_left_fails() {
        let a = setup(4);
        for i in 0..a.recipients.len() {
            let who = a.recipients.get(i).unwrap();
            let amount = a.amounts.get(i).unwrap();
            a.client
                .claim(&who, &amount, &proof_for(&a.env, &a.leaves, i));
        }

        a.env.ledger().set_sequence_number(DEADLINE + 1);
        assert_eq!(
            a.client.try_reclaim_unclaimed(),
            Err(Ok(AirdropError::NothingToReclaim.into()))
        );
    }

    // ── Extending the deadline ──────────────────────────────────────────

    /// The second round `extend_deadline` exists for: the deadline passes
    /// before the admin has swept, so the deadline is pushed out and the
    /// treasury topped up on the same deployment rather than stranding it.
    #[test]
    fn test_extend_deadline_reopens_claiming_for_a_second_round() {
        let a = setup(4);
        let who = a.recipients.get(0).unwrap();
        let amount = a.amounts.get(0).unwrap();
        let proof = proof_for(&a.env, &a.leaves, 0);

        a.env.ledger().set_sequence_number(DEADLINE + 1);
        assert_eq!(
            a.client.try_claim(&who, &amount, &proof),
            Err(Ok(AirdropError::DeadlinePassed.into()))
        );

        let new_deadline = DEADLINE + 5_000;
        a.client.extend_deadline(&new_deadline);
        assert_eq!(a.client.get_deadline_ledger(), new_deadline);

        a.token_admin.mint(&a.admin, &100);
        a.client.fund(&a.admin, &100);
        assert_eq!(a.client.remaining_balance(), 1_100);

        a.client.claim(&who, &amount, &proof);
        assert_eq!(balance_of(&a.env, &a.token, &who), amount);

        // Reclaiming re-opens only after the *new* deadline.
        assert_eq!(
            a.client.try_reclaim_unclaimed(),
            Err(Ok(AirdropError::DeadlineNotReached.into()))
        );
    }

    #[test]
    fn test_extend_deadline_rejects_a_deadline_that_is_not_in_the_future() {
        let a = setup(4);
        a.env.ledger().set_sequence_number(DEADLINE + 1);
        assert_eq!(
            a.client.try_extend_deadline(&DEADLINE),
            Err(Ok(AirdropError::InvalidDeadline.into()))
        );
        assert_eq!(a.client.get_deadline_ledger(), DEADLINE);
    }

    /// The deadline is a promise to recipients, so it moves one way only.
    #[test]
    fn test_extend_deadline_cannot_pull_the_deadline_in() {
        let a = setup(4);
        a.env.ledger().set_sequence_number(DEADLINE - 5_000);
        // In the future, but earlier than the deadline already in force.
        assert_eq!(
            a.client.try_extend_deadline(&(DEADLINE - 1_000)),
            Err(Ok(AirdropError::InvalidDeadline.into()))
        );
        assert_eq!(a.client.get_deadline_ledger(), DEADLINE);
    }

    #[test]
    fn test_extend_deadline_is_bounded_by_twice_the_original_horizon() {
        let a = setup(4);
        a.env.ledger().set_sequence_number(1_000);
        // Original horizon: 10_000 (deadline) − 0 (ledger at initialize),
        // so the cap is 1_000 + 2 × 10_000 = 21_000.
        assert_eq!(
            a.client.try_extend_deadline(&21_001),
            Err(Ok(AirdropError::DeadlineTooFar.into()))
        );
        assert_eq!(a.client.get_deadline_ledger(), DEADLINE);

        a.client.extend_deadline(&21_000);
        assert_eq!(a.client.get_deadline_ledger(), 21_000);
    }

    /// Once reclaimed the airdrop is closed for good — reopening it would let
    /// `fund` in behind a balance nothing can sweep out again.
    #[test]
    fn test_extend_deadline_after_reclaim_fails() {
        let a = setup(4);
        a.env.ledger().set_sequence_number(DEADLINE + 1);
        a.client.reclaim_unclaimed();

        assert_eq!(
            a.client.try_extend_deadline(&(DEADLINE + 100)),
            Err(Ok(AirdropError::AlreadyReclaimed.into()))
        );
        assert_eq!(a.client.get_deadline_ledger(), DEADLINE);
    }

    #[test]
    fn test_extend_deadline_requires_admin_auth() {
        let a = setup(4);
        let stranger = Address::generate(&a.env);

        a.env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &a.client.address,
                fn_name: "extend_deadline",
                args: (DEADLINE + 100u32,).into_val(&a.env),
                sub_invokes: &[],
            },
        }]);

        assert!(a.client.try_extend_deadline(&(DEADLINE + 100)).is_err());
        assert_eq!(a.client.get_deadline_ledger(), DEADLINE);
    }

    // ── Administration ──────────────────────────────────────────────────
    //
    // Mirrors the token contract's admin suite (see
    // docs/admin-capability-matrix.md): two-step transfer with an expiry,
    // revoke_admin, pause/unpause, upgrade — each with its own event.

    #[test]
    fn test_propose_and_accept_admin() {
        let a = setup(2);
        let next = Address::generate(&a.env);

        a.client.propose_admin(&next);
        // The old admin keeps the role until the new one accepts.
        assert_eq!(a.client.get_admin(), a.admin);
        assert_eq!(a.client.pending_admin(), Some(next.clone()));

        a.client.accept_admin();
        assert_eq!(a.client.get_admin(), next);
        assert_eq!(a.client.pending_admin(), None);
    }

    #[test]
    fn test_propose_admin_overwrites_previous() {
        let a = setup(2);
        let first = Address::generate(&a.env);
        let second = Address::generate(&a.env);

        a.client.propose_admin(&first);
        a.client.propose_admin(&second);
        assert_eq!(a.client.pending_admin(), Some(second.clone()));

        a.client.accept_admin();
        assert_eq!(a.client.get_admin(), second);
    }

    #[test]
    fn test_propose_admin_rejects_current_admin() {
        let a = setup(2);
        assert_eq!(
            a.client.try_propose_admin(&a.admin.clone()),
            Err(Ok(AirdropError::InvalidAdmin.into()))
        );
    }

    #[test]
    fn test_cancel_admin_proposal_clears_pending_state() {
        let a = setup(2);
        let first = Address::generate(&a.env);
        let second = Address::generate(&a.env);

        a.client.propose_admin(&first);
        a.client.propose_admin(&second);
        a.client.cancel_admin_proposal();

        assert_eq!(a.client.pending_admin(), None);
        assert_eq!(a.client.get_admin(), a.admin);
    }

    #[test]
    fn test_accept_admin_without_proposal() {
        let a = setup(2);
        assert_eq!(
            a.client.try_accept_admin(),
            Err(Ok(AirdropError::NoPendingAdmin.into()))
        );
    }

    #[test]
    fn test_accept_admin_rejects_expired_proposal() {
        let a = setup(2);
        let next = Address::generate(&a.env);

        a.client.propose_admin(&next);
        // Exactly the expiry ledger: `>=` makes it lapsed, and one ledger
        // further would archive the instance entry first (the entry's own
        // TTL is the same constant), so this is the only observable edge.
        a.env
            .ledger()
            .set_sequence_number(ADMIN_PROPOSAL_EXPIRY_LEDGERS);

        assert_eq!(
            a.client.try_accept_admin(),
            Err(Ok(AirdropError::ProposalExpired.into()))
        );
        assert_eq!(a.client.get_admin(), a.admin);
    }

    /// The getter clears a lapsed proposal rather than reporting an address
    /// that `accept_admin` would then refuse — stale state must not linger.
    #[test]
    fn test_pending_admin_getter_clears_expired_proposal() {
        let a = setup(2);
        let next = Address::generate(&a.env);

        a.client.propose_admin(&next);
        a.env
            .ledger()
            .set_sequence_number(ADMIN_PROPOSAL_EXPIRY_LEDGERS);

        assert_eq!(a.client.pending_admin(), None);
        // Re-proposing works: expiry is a deadline, not a lockout.
        a.env.ledger().set_sequence_number(0);
        a.client.propose_admin(&next);
        assert_eq!(a.client.pending_admin(), Some(next));
    }

    #[test]
    fn test_old_admin_retains_role_until_accepted() {
        let a = setup(2);
        let next = Address::generate(&a.env);

        a.client.propose_admin(&next);
        // Still the admin — and still able to act as one.
        assert_eq!(a.client.get_admin(), a.admin);
        a.client.pause();
        assert!(a.client.is_paused());
        a.client.unpause();
        assert_eq!(a.client.get_admin(), a.admin);
    }

    #[test]
    fn test_accept_admin_blocked_when_paused() {
        let a = setup(2);
        let next = Address::generate(&a.env);

        a.client.propose_admin(&next);
        a.client.pause();

        assert_eq!(
            a.client.try_accept_admin(),
            Err(Ok(AirdropError::Paused.into()))
        );
        assert_eq!(a.client.get_admin(), a.admin);
    }

    #[test]
    fn test_propose_admin_requires_admin_auth() {
        let a = setup(2);
        let stranger = Address::generate(&a.env);
        let next = Address::generate(&a.env);

        a.env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &a.client.address,
                fn_name: "propose_admin",
                args: (next.clone(),).into_val(&a.env),
                sub_invokes: &[],
            },
        }]);

        assert!(a.client.try_propose_admin(&next).is_err());
        assert_eq!(a.client.pending_admin(), None);
    }

    #[test]
    fn test_revoke_admin_sets_locked_flag() {
        let a = setup(2);
        assert!(!a.client.is_locked());

        a.client.revoke_admin();

        assert!(a.client.is_locked());
    }

    #[test]
    fn test_get_admin_after_revoke_panics() {
        let a = setup(2);
        a.client.revoke_admin();
        assert_eq!(
            a.client.try_get_admin(),
            Err(Ok(AirdropError::Locked.into()))
        );
    }

    /// Every admin operation must be permanently unreachable after revoke —
    /// this is the row the whole matrix turns on.
    #[test]
    fn test_admin_operations_after_revoke_fail() {
        let a = setup(2);
        let next = Address::generate(&a.env);
        a.client.revoke_admin();

        assert_eq!(
            a.client.try_propose_admin(&next),
            Err(Ok(AirdropError::Locked.into()))
        );
        assert_eq!(
            a.client.try_extend_deadline(&(DEADLINE + 100)),
            Err(Ok(AirdropError::Locked.into()))
        );
        assert_eq!(a.client.try_pause(), Err(Ok(AirdropError::Locked.into())));
        assert_eq!(
            a.client
                .try_upgrade(&BytesN::from_array(&a.env, &[1u8; 32])),
            Err(Ok(AirdropError::Locked.into()))
        );
    }

    #[test]
    fn test_reclaim_after_revoke_fails() {
        let a = setup(2);
        a.client.revoke_admin();
        a.env.ledger().set_sequence_number(DEADLINE + 1);

        assert_eq!(
            a.client.try_reclaim_unclaimed(),
            Err(Ok(AirdropError::Locked.into()))
        );
    }

    /// Recipients are unaffected by the admin giving up the role: claims
    /// keep working up to the deadline.
    #[test]
    fn test_claim_still_works_after_revoke() {
        let a = setup(2);
        a.client.revoke_admin();

        let who = a.recipients.get(0).unwrap();
        let amount = a.amounts.get(0).unwrap();
        let proof = proof_for(&a.env, &a.leaves, 0);

        a.client.claim(&who, &amount, &proof);
        assert_eq!(balance_of(&a.env, &a.token, &who), amount);
    }

    /// `Initialized` is deliberately never cleared by `revoke_admin`, so
    /// revoking cannot re-open `initialize` (issue #322, token side).
    #[test]
    fn test_initialize_after_revoke_still_fails() {
        let a = setup(2);
        a.client.revoke_admin();

        let root = root_of(&a.env, &a.leaves);
        assert_eq!(
            a.client
                .try_initialize(&a.token, &a.admin, &root, &DEADLINE),
            Err(Ok(AirdropError::AlreadyInitialized.into()))
        );
    }

    #[test]
    fn test_pause_blocks_value_moving_operations() {
        let a = setup(2);
        assert!(!a.client.is_paused());
        a.client.pause();
        assert!(a.client.is_paused());

        let who = a.recipients.get(0).unwrap();
        let amount = a.amounts.get(0).unwrap();
        let proof = proof_for(&a.env, &a.leaves, 0);

        assert_eq!(
            a.client.try_claim(&who, &amount, &proof),
            Err(Ok(AirdropError::Paused.into()))
        );
        assert_eq!(
            a.client.try_fund(&a.admin.clone(), &1i128),
            Err(Ok(AirdropError::Paused.into()))
        );

        a.client.unpause();
        assert!(!a.client.is_paused());
        a.client.claim(&who, &amount, &proof);
        assert_eq!(balance_of(&a.env, &a.token, &who), amount);
    }

    #[test]
    fn test_pause_blocks_reclaim() {
        let a = setup(2);
        a.env.ledger().set_sequence_number(DEADLINE + 1);
        a.client.pause();

        assert_eq!(
            a.client.try_reclaim_unclaimed(),
            Err(Ok(AirdropError::Paused.into()))
        );
    }

    /// Policy setters and read-only getters stay available while paused so
    /// the state remains inspectable and the deadline can still be managed.
    #[test]
    fn test_extend_deadline_and_getters_work_while_paused() {
        let a = setup(2);
        a.client.pause();

        a.client.extend_deadline(&(DEADLINE + 100));
        assert_eq!(a.client.get_deadline_ledger(), DEADLINE + 100);

        assert!(a.client.is_paused());
        assert_eq!(a.client.get_admin(), a.admin);
        assert_eq!(a.client.get_token(), a.token);
        assert_eq!(a.client.total_claimed(), 0);
        assert!(a.client.remaining_balance() > 0);
    }

    #[test]
    fn test_non_admin_cannot_pause() {
        let a = setup(2);
        let stranger = Address::generate(&a.env);

        a.env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &a.client.address,
                fn_name: "pause",
                args: ().into_val(&a.env),
                sub_invokes: &[],
            },
        }]);

        assert!(a.client.try_pause().is_err());
        assert!(!a.client.is_paused());
    }

    #[test]
    fn test_non_admin_cannot_upgrade() {
        let a = setup(2);
        let stranger = Address::generate(&a.env);
        let hash = BytesN::from_array(&a.env, &[1u8; 32]);

        a.env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &a.client.address,
                fn_name: "upgrade",
                args: (hash.clone(),).into_val(&a.env),
                sub_invokes: &[],
            },
        }]);

        assert!(a.client.try_upgrade(&hash).is_err());
    }

    #[test]
    fn test_upgrade_rejects_zero_hash() {
        let a = setup(2);
        assert_eq!(
            a.client
                .try_upgrade(&BytesN::from_array(&a.env, &[0u8; 32])),
            Err(Ok(AirdropError::InvalidWasmHash.into()))
        );
    }

    /// The admin lifecycle emits one event per action, with the same topic-0
    /// symbols the token contract uses so a shared dashboard admin panel can
    /// render both.
    #[test]
    fn test_admin_lifecycle_emits_an_event_per_action() {
        let a = setup(2);
        let next = Address::generate(&a.env);
        let old_admin = a.admin.clone();
        let contract = a.client.address.clone();

        type Event = (
            soroban_sdk::Address,
            soroban_sdk::Vec<soroban_sdk::Val>,
            soroban_sdk::Val,
        );

        /// The single most recent event, wrapped in a `Vec` so it compares
        /// through `Vec`'s host-side `PartialEq` (`Val` itself has none).
        fn last_event(a: &Airdrop) -> soroban_sdk::Vec<Event> {
            let events = a.env.events().all();
            events.slice(events.len() - 1..)
        }

        a.client.propose_admin(&next);
        assert_eq!(
            last_event(&a),
            soroban_sdk::vec![
                &a.env,
                (
                    contract.clone(),
                    (symbol_short!("prop_adm"), old_admin.clone(), next.clone()).into_val(&a.env),
                    ().into_val(&a.env)
                )
            ]
        );

        a.client.cancel_admin_proposal();
        assert_eq!(
            last_event(&a),
            soroban_sdk::vec![
                &a.env,
                (
                    contract.clone(),
                    (symbol_short!("cncl_adm"),).into_val(&a.env),
                    ().into_val(&a.env)
                )
            ]
        );

        a.client.propose_admin(&next);
        a.client.accept_admin();
        assert_eq!(
            last_event(&a),
            soroban_sdk::vec![
                &a.env,
                (
                    contract.clone(),
                    (symbol_short!("set_admin"), old_admin.clone(), next.clone()).into_val(&a.env),
                    ().into_val(&a.env)
                )
            ]
        );
        assert_eq!(a.client.get_admin(), next.clone());

        a.client.pause();
        assert_eq!(
            last_event(&a),
            soroban_sdk::vec![
                &a.env,
                (
                    contract.clone(),
                    (symbol_short!("pause"),).into_val(&a.env),
                    ().into_val(&a.env)
                )
            ]
        );

        a.client.unpause();
        assert_eq!(
            last_event(&a),
            soroban_sdk::vec![
                &a.env,
                (
                    contract.clone(),
                    (symbol_short!("unpause"),).into_val(&a.env),
                    ().into_val(&a.env)
                )
            ]
        );

        a.client.revoke_admin();
        assert_eq!(
            last_event(&a),
            soroban_sdk::vec![
                &a.env,
                (
                    contract,
                    (symbol_short!("revoked"),).into_val(&a.env),
                    true.into_val(&a.env)
                )
            ]
        );
    }

    // ── Read-only helpers ───────────────────────────────────────────────

    #[test]
    fn test_verify_proof_matches_claimability() {
        let a = setup(4);
        let who = a.recipients.get(2).unwrap();
        let amount = a.amounts.get(2).unwrap();
        let proof = proof_for(&a.env, &a.leaves, 2);

        assert!(a.client.verify_proof(&who, &amount, &proof));
        assert!(!a.client.verify_proof(&who, &(amount + 1), &proof));
        assert!(!a.client.verify_proof(&who, &amount, &Vec::new(&a.env)));
        assert!(!a.client.verify_proof(&who, &0, &proof));

        // Still true after claiming — verify_proof answers "are you on the
        // list", not "can you claim right now".
        a.client.claim(&who, &amount, &proof);
        assert!(a.client.verify_proof(&who, &amount, &proof));
    }

    #[test]
    fn test_claimed_amount_is_zero_before_claiming() {
        let a = setup(4);
        let who = a.recipients.get(0).unwrap();
        assert!(!a.client.is_claimed(&who));
        assert_eq!(a.client.claimed_amount(&who), 0);
    }

    /// Pins the exact leaf preimage against a vector computed independently
    /// with `@noble/hashes` — the same vector
    /// `frontend/lib/__tests__/merkle.test.ts` asserts on. If either side's
    /// encoding drifts, one of the two tests fails instead of the airdrop
    /// silently becoming unclaimable.
    #[test]
    fn test_leaf_hash_matches_cross_language_vector() {
        let env = Env::default();
        let addr = Address::from_string(&String::from_str(
            &env,
            "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        ));

        let contract_id = env.register_contract(None, AirdropContract);
        let client = AirdropContractClient::new(&env, &contract_id);

        let expected = BytesN::from_array(
            &env,
            &[
                0x08, 0xe7, 0x12, 0x6d, 0xd5, 0x37, 0x8b, 0xd1, 0xe0, 0x09, 0xc0, 0x56, 0xce, 0x89,
                0xf2, 0x71, 0x18, 0x88, 0x71, 0x5a, 0xfd, 0xe9, 0x93, 0x57, 0x6d, 0xcc, 0x0e, 0xe0,
                0xe4, 0x67, 0x11, 0x47,
            ],
        );

        assert_eq!(client.leaf_hash(&addr, &1_000_000_000), expected);
    }

    #[test]
    fn test_ttl_ledgers_is_about_one_year() {
        assert_eq!(TTL_LEDGERS, 6_307_200);
    }

    /// Initializes a throwaway airdrop with `deadline`, then reports
    /// `_claim_ttl` next to the inputs that should determine it: the
    /// network's ceiling and the ledgers still to run before the deadline.
    fn claim_ttl_for(deadline: u32) -> (u32, u32, u32) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register_contract(None, AirdropContract);
        let client = AirdropContractClient::new(&env, &contract_id);
        let root = BytesN::from_array(&env, &[1u8; 32]);
        client.initialize(&token, &admin, &root, &deadline);

        env.as_contract(&contract_id, || {
            let ttl = AirdropContract::_claim_ttl(&env);
            let max_ttl = env.storage().max_ttl();
            let remaining = deadline.saturating_sub(env.ledger().sequence());
            (ttl, max_ttl, remaining)
        })
    }

    #[test]
    fn test_claim_ttl_never_exceeds_network_maximum() {
        // A deadline far past the network's TTL ceiling must still clamp.
        let (ttl, max_ttl, remaining) = claim_ttl_for(u32::MAX);
        assert!(remaining > max_ttl);
        assert_eq!(
            ttl, max_ttl,
            "claim TTL must be clamped to the network maximum"
        );
    }

    #[test]
    fn test_claim_ttl_tracks_the_deadline_it_is_asked_about() {
        // Past the default horizon, the marker's TTL is the remaining
        // ledgers — not the default horizon for every input.
        let (ttl, max_ttl, remaining) = claim_ttl_for(TTL_LEDGERS + 4_000);
        assert!(remaining > TTL_LEDGERS && remaining <= max_ttl);
        assert_eq!(ttl, remaining);

        // Before it, the default horizon is the floor.
        let (ttl, max_ttl, remaining) = claim_ttl_for(500);
        assert!(remaining < TTL_LEDGERS);
        assert_eq!(ttl, TTL_LEDGERS.min(max_ttl));
    }

    // ── Event schema ────────────────────────────────────────────────────

    const EXPECTED_TOPICS: [&str; 12] = [
        "init",
        "prop_adm",
        "cncl_adm",
        "set_admin",
        "revoked",
        "pause",
        "unpause",
        "upgrade",
        "fund",
        "claim",
        "reclaim",
        "extend",
    ];

    /// Asserts the set of `symbol_short!("...")` topic-0 literals used in
    /// this file's production code (everything before the test module)
    /// exactly matches `EXPECTED_TOPICS`, which is in turn what
    /// `docs/events.json` documents. Static rather than live because
    /// scanning every `.publish(...)` call site covers events regardless
    /// of how hard they are to trigger in a live scenario.
    #[test]
    fn test_emitted_topics_match_checked_in_fixture() {
        const SOURCE: &str = include_str!("lib.rs");
        let (production_source, _) = SOURCE
            .split_once("#[cfg(test)]\nmod test {")
            .expect("could not locate test module boundary in lib.rs");

        const NEEDLE: &str = "symbol_short!(\"";

        // Every expected topic must actually appear as a symbol_short! literal.
        for topic in EXPECTED_TOPICS {
            let mut rest = production_source;
            let mut found = false;
            while let Some(pos) = rest.find(NEEDLE) {
                let after = &rest[pos + NEEDLE.len()..];
                if after.len() > topic.len()
                    && after.starts_with(topic)
                    && after.as_bytes()[topic.len()] == b'"'
                {
                    found = true;
                    break;
                }
                rest = &after[1..];
            }
            assert!(
                found,
                "topic {topic:?} is listed in EXPECTED_TOPICS but no \
                 symbol_short!(\"{topic}\") literal was found in the contract"
            );
        }

        // No symbol_short! literal exists outside the expected set — i.e.
        // nothing new was added without updating the fixture (and
        // docs/events.json / docs/events.md alongside it).
        let mut rest = production_source;
        while let Some(pos) = rest.find(NEEDLE) {
            let after = &rest[pos + NEEDLE.len()..];
            let end = after.find('"').expect("unterminated symbol_short! literal");
            let topic = &after[..end];
            assert!(
                EXPECTED_TOPICS.contains(&topic),
                "contract emits topic {topic:?} but it is not listed in \
                 EXPECTED_TOPICS — update docs/events.json and re-run \
                 scripts/generate_events_doc.py"
            );
            rest = &after[end..];
        }
    }
}
