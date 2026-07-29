#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Map, Vec};

// ---------------------------------------------------------------------------
// Storage types
// ---------------------------------------------------------------------------

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    PendingAdmin,
    TokenContract,
    IsPaused,
    Schedule(Address, u32),
    ScheduleCount(Address),
    RecipientCount,
    RecipientAt(u32),
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct VestingSchedule {
    pub recipient: Address,
    pub total_amount: i128,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
    pub released: i128,
    pub revoked: bool,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct ScheduleInput {
    pub recipient: Address,
    pub total_amount: i128,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/// Vesting Contract — cliff + linear unlock schedules.
///
/// Contributor issues layered on top:
/// - #3  revoke() — admin reclaims unvested tokens
/// - #5  structured events audit
/// - #149 pause/unpause circuit breaker
#[contract]
pub struct VestingContract;

#[contractimpl]
impl VestingContract {
    // ── Initialization ──────────────────────────────────────────────────

    /// Set the admin and the token contract this vesting module manages.
    pub fn initialize(env: Env, admin: Address, token_contract: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::TokenContract, &token_contract);

        env.events()
            .publish((symbol_short!("init"),), (admin, token_contract));
    }

    // ── Admin actions ───────────────────────────────────────────────────

    /// Propose a new admin. Must be called by the current admin.
    /// The new admin must call `accept_admin` to finalize the transfer.
    pub fn propose_admin(env: Env, new_admin: Address) {
        Self::_require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        env.events()
            .publish((symbol_short!("prop_adm"),), new_admin);
    }

    /// Accept the admin role. Must be called by the pending admin.
    pub fn accept_admin(env: Env) {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .expect("no pending admin");
        pending.require_auth();
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.events().publish((symbol_short!("acc_adm"),), pending);
    }

    /// Create a cliff + linear vesting schedule for `recipient`.
    ///
    /// `cliff_ledger` — ledger number when tokens start unlocking.
    /// `end_ledger`   — ledger number when 100 % is vested.
    ///
    /// This function atomically transfers `total_amount` tokens from the admin
    /// to this contract's address using transfer, ensuring the contract
    /// is properly funded in the same transaction.
    pub fn create_schedule(
        env: Env,
        recipient: Address,
        total_amount: i128,
        cliff_ledger: u32,
        end_ledger: u32,
    ) {
        Self::_check_paused(&env);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        assert!(total_amount > 0, "total_amount must be positive");
        assert!(
            end_ledger > cliff_ledger,
            "end_ledger must be after cliff_ledger"
        );

        let schedule_index = Self::_schedule_count(&env, &recipient);
        let key = Self::_schedule_key(&recipient, schedule_index);

        // Get the token contract address
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .expect("not initialized");

        // Atomically transfer tokens from admin to this contract
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        token_client.transfer(&admin, &env.current_contract_address(), &total_amount);

        let schedule = VestingSchedule {
            recipient: recipient.clone(),
            total_amount,
            cliff_ledger,
            end_ledger,
            released: 0,
            revoked: false,
        };

        env.storage().persistent().set(&key, &schedule);

        // Extend TTL for the schedule to prevent archiving during vesting period
        let ttl_ledgers = Self::_ttl_ledgers(&env, end_ledger);
        Self::_extend_persistent_ttl(&env, &key, ttl_ledgers);
        Self::_set_schedule_count(&env, &recipient, schedule_index + 1, ttl_ledgers);

        // Track the recipient in the recipients list (only if new to this contract)
        if schedule_index == 0 {
            Self::_add_recipient(&env, &recipient);
        }

        env.events()
            .publish((symbol_short!("create"), recipient), total_amount);
    }

    /// Create multiple vesting schedules in a single transaction.
    ///
    /// Atomically transfers the sum of all `total_amount` values from the admin
    /// to this contract (Phase 2), then writes each schedule (Phase 3). If any
    /// step panics the entire transaction rolls back, including the token transfer.
    ///
    /// **Maximum batch size: 50 recipients.** Larger batches risk exceeding
    /// Soroban's per-transaction compute budget and will be rejected up front
    /// with a clear error rather than an opaque resource failure.
    pub fn create_schedules_batch(env: Env, schedules: Vec<ScheduleInput>) -> u32 {
        Self::_check_paused(&env);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        assert!(schedules.len() > 0, "schedules cannot be empty");
        assert!(schedules.len() <= 50, "batch size exceeds maximum of 50");

        // Get the token contract address
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .expect("not initialized");

        let mut total_amount: i128 = 0;
        let mut assigned_indexes = Vec::new(&env);
        let mut next_indexes = Map::new(&env);

        // Phase 1: Validate all schedules and calculate total amount
        for i in 0..schedules.len() {
            let input = schedules.get(i).expect("index out of bounds");

            assert!(input.total_amount > 0, "total_amount must be positive");
            assert!(
                input.end_ledger > input.cliff_ledger,
                "end_ledger must be after cliff_ledger"
            );

            let schedule_index = next_indexes
                .get(input.recipient.clone())
                .unwrap_or(Self::_schedule_count(&env, &input.recipient));
            next_indexes.set(input.recipient.clone(), schedule_index + 1);
            assigned_indexes.push_back(schedule_index);

            total_amount = total_amount
                .checked_add(input.total_amount)
                .expect("total amount overflow");
        }

        // Phase 2: Transfer total amount from admin to contract in one transaction
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        token_client.transfer(&admin, &env.current_contract_address(), &total_amount);

        // Phase 3: Create all schedules
        let mut created_count: u32 = 0;
        for i in 0..schedules.len() {
            let input = schedules.get(i).expect("index out of bounds");
            let schedule_index = assigned_indexes.get(i).expect("index out of bounds");

            let schedule = VestingSchedule {
                recipient: input.recipient.clone(),
                total_amount: input.total_amount,
                cliff_ledger: input.cliff_ledger,
                end_ledger: input.end_ledger,
                released: 0,
                revoked: false,
            };

            let key = Self::_schedule_key(&input.recipient, schedule_index);
            env.storage().persistent().set(&key, &schedule);

            // Extend TTL for the schedule (clamped to the network maximum, see
            // `_ttl_ledgers`)
            let ttl_ledgers = Self::_ttl_ledgers(&env, input.end_ledger);
            Self::_extend_persistent_ttl(&env, &key, ttl_ledgers);
            Self::_set_schedule_count(&env, &input.recipient, schedule_index + 1, ttl_ledgers);

            // Track the recipient in the recipients list (only if new to this contract)
            if schedule_index == 0 {
                Self::_add_recipient(&env, &input.recipient);
            }

            env.events().publish(
                (symbol_short!("create"), input.recipient.clone()),
                input.total_amount,
            );

            created_count += 1;
        }

        // Publish batch event
        env.events()
            .publish((symbol_short!("batch"),), (created_count, total_amount));

        created_count
    }

    /// Release all currently vested (but unreleased) tokens to the recipient.
    /// Can be called by anyone.
    pub fn release(env: Env, recipient: Address, index: Option<u32>) {
        Self::_check_paused(&env);
        let (key, mut schedule) = Self::_load_schedule(&env, &recipient, index);

        assert!(!schedule.revoked, "schedule has been revoked");

        let vested = Self::_vested_amount(&env, &schedule);
        let releasable = vested - schedule.released;
        assert!(releasable > 0, "nothing to release");

        schedule.released += releasable;
        env.storage().persistent().set(&key, &schedule);

        // Extend TTL for the schedule to prevent archiving
        // saturating_sub prevents u32 underflow when the schedule has fully vested (current_ledger > end_ledger)
        let remaining_ledgers = schedule
            .end_ledger
            .saturating_sub(env.ledger().sequence())
            .min(env.storage().max_ttl());
        if remaining_ledgers > 0 {
            env.storage()
                .persistent()
                .extend_ttl(&key, remaining_ledgers, remaining_ledgers);
        }

        // Transfer tokens from the vesting contract to the recipient via
        // the token contract's transfer function.
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .expect("not initialized");

        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &recipient, &releasable);

        env.events()
            .publish((symbol_short!("release"), recipient), releasable);
    }

    /// Refresh a schedule's storage TTL without releasing tokens.
    ///
    /// Schedules whose remaining duration exceeds the network's maximum
    /// entry TTL (roughly 180 days) have their storage TTL clamped at
    /// creation time (see `_ttl_ledgers`). For such long-dated grants,
    /// call this at least once per TTL window to keep the entry from
    /// being archived between claims. Can be called by anyone.
    pub fn keep_alive(env: Env, recipient: Address, index: Option<u32>) {
        Self::_check_paused(&env);
        let (key, schedule) = Self::_load_schedule(&env, &recipient, index);

        let remaining_ledgers = schedule
            .end_ledger
            .saturating_sub(env.ledger().sequence())
            .min(env.storage().max_ttl());
        if remaining_ledgers > 0 {
            env.storage()
                .persistent()
                .extend_ttl(&key, remaining_ledgers, remaining_ledgers);
        }
    }

    /// Admin-only: revoke a schedule, send vested portion to recipient,
    /// return unvested remainder to admin.
    pub fn revoke(env: Env, recipient: Address, index: Option<u32>) {
        Self::_check_paused(&env);
        Self::_require_admin(&env);

        let (key, mut schedule) = Self::_load_schedule(&env, &recipient, index);

        assert!(!schedule.revoked, "schedule already revoked");

        let vested = Self::_vested_amount(&env, &schedule);
        let releasable = vested - schedule.released;
        let unvested = schedule.total_amount - vested;

        // Update schedule state
        schedule.revoked = true;
        schedule.released = vested; // All vested tokens are now accounted for as released (or being released)
        env.storage().persistent().set(&key, &schedule);

        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenContract)
            .expect("not initialized");

        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);

        // 1. Transfer releasable vested tokens to recipient
        if releasable > 0 {
            token_client.transfer(&env.current_contract_address(), &recipient, &releasable);
        }

        // 2. Transfer unvested tokens back to admin
        if unvested > 0 {
            let admin: Address = env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .expect("not initialized");
            token_client.transfer(&env.current_contract_address(), &admin, &unvested);
        }

        env.events()
            .publish((symbol_short!("revoke"), recipient), (releasable, unvested));
    }

    /// Admin-only: extend the cliff ledger of an existing (non-revoked) schedule.
    ///
    /// Rules enforced:
    /// - `new_cliff` must be strictly greater than the current `cliff_ledger`
    ///   (extension only — reduction is never allowed).
    /// - The current ledger must still be before the cliff (once the cliff has
    ///   already passed there is nothing left to delay).
    /// - `new_cliff` must remain strictly less than `end_ledger`.
    pub fn extend_cliff(env: Env, recipient: Address, new_cliff: u32, index: Option<u32>) {
        Self::_check_paused(&env);
        Self::_require_admin(&env);

        let (key, mut schedule) = Self::_load_schedule(&env, &recipient, index);

        assert!(!schedule.revoked, "schedule has been revoked");
        assert!(
            env.ledger().sequence() < schedule.cliff_ledger,
            "cliff has already passed"
        );
        assert!(
            new_cliff > schedule.cliff_ledger,
            "new_cliff must be later than current cliff"
        );
        assert!(
            new_cliff < schedule.end_ledger,
            "new_cliff must be before end_ledger"
        );

        // Capture old value before mutation
        let old_cliff = schedule.cliff_ledger;
        schedule.cliff_ledger = new_cliff;
        env.storage().persistent().set(&key, &schedule);

        // Emit event with tuple payload
        env.events().publish(
            (symbol_short!("clf_ext"), recipient),
            (old_cliff, new_cliff),
        );
    }

    // ── Read-only queries ───────────────────────────────────────────────

    /// Total amount vested so far (may or may not have been released).
    pub fn vested_amount(env: Env, recipient: Address, index: Option<u32>) -> i128 {
        let (_, schedule) = Self::_load_schedule(&env, &recipient, index);
        Self::_vested_amount(&env, &schedule)
    }

    /// Amount already released to the recipient.
    pub fn released_amount(env: Env, recipient: Address, index: Option<u32>) -> i128 {
        let (_, schedule) = Self::_load_schedule(&env, &recipient, index);
        schedule.released
    }

    /// Returns `true` if the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
    }

    /// Pause the vesting contract. Admin only.
    pub fn pause(env: Env) {
        Self::_require_admin(&env);
        env.storage().instance().set(&DataKey::IsPaused, &true);
        env.events().publish((symbol_short!("pause"),), ());
    }

    /// Unpause the vesting contract. Admin only.
    pub fn unpause(env: Env) {
        Self::_require_admin(&env);
        env.storage().instance().remove(&DataKey::IsPaused);
        env.events().publish((symbol_short!("unpause"),), ());
    }

    /// Return the number of schedules stored for a recipient.
    pub fn get_schedule_count(env: Env, recipient: Address) -> u32 {
        Self::_schedule_count(&env, &recipient)
    }

    /// Return the full schedule struct for a recipient.
    pub fn get_schedule(env: Env, recipient: Address, index: Option<u32>) -> VestingSchedule {
        let (_, schedule) = Self::_load_schedule(&env, &recipient, index);
        schedule
    }

    /// Returns the admin address of this vesting contract.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    /// Returns the token contract address managed by this vesting contract.
    pub fn get_token_contract(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::TokenContract)
            .expect("not initialized")
    }

    /// Return the number of recipients tracked (including any pruned slots).
    pub fn get_recipient_count(env: Env) -> u32 {
        Self::_recipient_count(&env)
    }

    /// Return paginated list of recipients with vesting schedules.
    ///
    /// `start` — zero-based offset into the recipients list.
    /// `limit` — maximum number of recipients to return.
    ///
    /// Pruned slots (see `prune_recipient`) are omitted from the result, so
    /// a page may contain fewer than `limit` entries even if more remain.
    pub fn get_recipients_paginated(env: Env, start: u32, limit: u32) -> Vec<Address> {
        let total = Self::_recipient_count(&env);

        if start >= total {
            return Vec::new(&env);
        }

        let end = start.saturating_add(limit).min(total);

        let mut paginated = Vec::new(&env);
        let mut i = start;
        while i < end {
            if let Some(recipient) = env
                .storage()
                .persistent()
                .get::<DataKey, Address>(&DataKey::RecipientAt(i))
            {
                paginated.push_back(recipient);
            }
            i += 1;
        }
        paginated
    }

    /// Admin-only: remove a fully-settled recipient from the enumeration
    /// index. Does not touch the recipient's schedules — it only prunes the
    /// enumeration slot(s) so `get_recipients_paginated` stops listing them.
    pub fn prune_recipient(env: Env, recipient: Address) {
        Self::_require_admin(&env);

        let total = Self::_recipient_count(&env);
        let mut i = 0u32;
        let mut pruned = false;
        while i < total {
            let key = DataKey::RecipientAt(i);
            if let Some(stored) = env.storage().persistent().get::<DataKey, Address>(&key) {
                if stored == recipient {
                    env.storage().persistent().remove(&key);
                    pruned = true;
                }
            }
            i += 1;
        }

        assert!(pruned, "recipient not tracked");
        env.events().publish((symbol_short!("prune"),), recipient);
    }

    // ── Internals ───────────────────────────────────────────────────────

    fn _require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
    }

    fn _check_paused(env: &Env) {
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::IsPaused)
            .unwrap_or(false)
        {
            panic!("vesting contract is paused");
        }
    }

    fn _schedule_key(recipient: &Address, index: u32) -> DataKey {
        DataKey::Schedule(recipient.clone(), index)
    }

    fn _schedule_count(env: &Env, recipient: &Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::ScheduleCount(recipient.clone()))
            .unwrap_or(0)
    }

    fn _set_schedule_count(env: &Env, recipient: &Address, count: u32, ttl_ledgers: u32) {
        let key = DataKey::ScheduleCount(recipient.clone());
        env.storage().persistent().set(&key, &count);
        Self::_extend_persistent_ttl(env, &key, ttl_ledgers);
    }

    fn _resolve_schedule_index(env: &Env, recipient: &Address, index: Option<u32>) -> u32 {
        let count = Self::_schedule_count(env, recipient);
        let resolved = match index {
            Some(index) => index,
            None => {
                assert!(count > 0, "no schedule found");
                count - 1
            }
        };
        assert!(resolved < count, "schedule index out of bounds");
        resolved
    }

    fn _load_schedule(
        env: &Env,
        recipient: &Address,
        index: Option<u32>,
    ) -> (DataKey, VestingSchedule) {
        let resolved_index = Self::_resolve_schedule_index(env, recipient, index);
        let key = Self::_schedule_key(recipient, resolved_index);
        let schedule: VestingSchedule = env
            .storage()
            .persistent()
            .get(&key)
            .expect("no schedule found");
        (key, schedule)
    }

    fn _ttl_ledgers(env: &Env, end_ledger: u32) -> u32 {
        let current_ledger = env.ledger().sequence();
        let desired = if end_ledger > current_ledger {
            end_ledger - current_ledger
        } else {
            // Default TTL if end_ledger is in the past
            52 * 7 * 24 * 60 / 5
        };
        // Soroban rejects extend_to above the network's max entry TTL. Schedules
        // whose end is further out than one TTL window still need a keep-alive
        // (via `release` or `keep_alive`) at least once per window to stay live.
        desired.min(env.storage().max_ttl())
    }

    fn _extend_persistent_ttl(env: &Env, key: &DataKey, ttl_ledgers: u32) {
        env.storage()
            .persistent()
            .extend_ttl(key, ttl_ledgers, ttl_ledgers);
    }

    /// Cliff + linear vesting formula.
    ///
    /// - Before cliff → 0
    /// - Between cliff and end → proportional
    /// - After end → total_amount
    fn _vested_amount(env: &Env, schedule: &VestingSchedule) -> i128 {
        let current = env.ledger().sequence();

        if current < schedule.cliff_ledger {
            return 0;
        }
        if current >= schedule.end_ledger {
            return schedule.total_amount;
        }

        // Linear interpolation between cliff and end
        let elapsed = (current - schedule.cliff_ledger) as i128;
        let duration = (schedule.end_ledger - schedule.cliff_ledger) as i128;
        schedule.total_amount * elapsed / duration
    }

    fn _recipient_count(env: &Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::RecipientCount)
            .unwrap_or(0)
    }

    fn _add_recipient(env: &Env, recipient: &Address) {
        // `_add_recipient` is only called when `schedule_index == 0`, i.e. the
        // caller has already established this is the recipient's first
        // schedule with this contract, so no linear scan is needed here.
        let count = Self::_recipient_count(env);
        let key = DataKey::RecipientAt(count);
        env.storage().persistent().set(&key, recipient);

        let ttl_ledgers = 52 * 7 * 24 * 60 / 5; // ~1 year in ledger units
        Self::_extend_persistent_ttl(env, &key, ttl_ledgers);

        let count_key = DataKey::RecipientCount;
        env.storage().persistent().set(&count_key, &(count + 1));
        Self::_extend_persistent_ttl(env, &count_key, ttl_ledgers);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Events as _, testutils::Ledger, Env};

    // ── Event topic fixture ─────────────────────────────────────────────
    //
    // The checked-in, single source of truth for every event topic-0 name
    // this contract emits. `docs/events.md` is generated from
    // `docs/events.json`, which must list exactly this set — see issue
    // #340, where the doc drifted from the contract (documented 3 of the
    // ~10 events this contract actually emits) and a frontend indexer was
    // built against the stale doc instead of the contract, dropping whole
    // categories of activity. `scripts/generate_events_doc.py --check`
    // re-derives this same set directly from source and fails CI if it
    // and `docs/events.json` disagree.
    const EXPECTED_TOPICS: [&str; 10] = [
        "init", "prop_adm", "acc_adm", "create", "batch", "release", "revoke", "clf_ext", "pause",
        "unpause",
    ];

    /// Asserts the set of `symbol_short!("...")` topic-0 literals used in
    /// this file's production code (everything before the test module)
    /// exactly matches `EXPECTED_TOPICS`. Static rather than live because
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
                if after.as_bytes().len() > topic.len()
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
            let name = &after[..end];
            assert!(
                EXPECTED_TOPICS.contains(&name),
                "topic {name:?} is emitted by the contract but missing from \
                 EXPECTED_TOPICS (and likely docs/events.json / docs/events.md)"
            );
            rest = &after[end..];
        }
    }

    fn latest_index() -> Option<u32> {
        None
    }

    fn index(value: u32) -> Option<u32> {
        Some(value)
    }

    fn get_schedule_latest(client: &VestingContractClient, recipient: &Address) -> VestingSchedule {
        client.get_schedule(recipient, &latest_index())
    }

    fn get_schedule_at(
        client: &VestingContractClient,
        recipient: &Address,
        schedule_index: u32,
    ) -> VestingSchedule {
        client.get_schedule(recipient, &index(schedule_index))
    }

    fn vested_amount_latest(client: &VestingContractClient, recipient: &Address) -> i128 {
        client.vested_amount(recipient, &latest_index())
    }

    fn vested_amount_at(
        client: &VestingContractClient,
        recipient: &Address,
        schedule_index: u32,
    ) -> i128 {
        client.vested_amount(recipient, &index(schedule_index))
    }

    fn released_amount_latest(client: &VestingContractClient, recipient: &Address) -> i128 {
        client.released_amount(recipient, &latest_index())
    }

    fn released_amount_at(
        client: &VestingContractClient,
        recipient: &Address,
        schedule_index: u32,
    ) -> i128 {
        client.released_amount(recipient, &index(schedule_index))
    }

    fn release_latest(client: &VestingContractClient, recipient: &Address) {
        client.release(recipient, &latest_index());
    }

    fn release_at(client: &VestingContractClient, recipient: &Address, schedule_index: u32) {
        client.release(recipient, &index(schedule_index));
    }

    fn revoke_latest(client: &VestingContractClient, recipient: &Address) {
        client.revoke(recipient, &latest_index());
    }

    fn revoke_at(client: &VestingContractClient, recipient: &Address, schedule_index: u32) {
        client.revoke(recipient, &index(schedule_index));
    }

    fn extend_cliff_latest(client: &VestingContractClient, recipient: &Address, new_cliff: u32) {
        client.extend_cliff(recipient, &new_cliff, &latest_index());
    }

    fn setup_schedule(env: &Env, client: &VestingContractClient) -> (Address, Address) {
        let admin = Address::generate(env);
        let recipient = Address::generate(env);

        // Register a mock token contract
        let token = env.register_stellar_asset_contract(admin.clone());
        let token_client = soroban_sdk::token::StellarAssetClient::new(env, &token);

        // Mint tokens to the admin
        token_client.mint(&admin, &1_000_000i128);

        client.initialize(&admin, &token);

        // cliff at ledger 100, fully vested at ledger 200
        // The admin will transfer tokens directly in create_schedule
        client.create_schedule(&recipient, &1_000i128, &100u32, &200u32);

        (admin, recipient)
    }

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        client.initialize(&admin, &token);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_init() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        client.initialize(&admin, &token);
        client.initialize(&admin, &token);
    }

    #[test]
    fn test_create_schedule_and_getters() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let (_, recipient) = setup_schedule(&env, &client);

        let schedule = get_schedule_latest(&client, &recipient);
        assert_eq!(schedule.total_amount, 1_000);
        assert_eq!(schedule.cliff_ledger, 100);
        assert_eq!(schedule.end_ledger, 200);
        assert_eq!(schedule.released, 0);
        assert!(!schedule.revoked);
    }

    #[test]
    fn test_vested_before_cliff() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let (_, recipient) = setup_schedule(&env, &client);

        env.ledger().set_sequence_number(50);
        assert_eq!(vested_amount_latest(&client, &recipient), 0);
    }

    #[test]
    fn test_vested_midway() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let (_, recipient) = setup_schedule(&env, &client);

        env.ledger().set_sequence_number(150);
        assert_eq!(vested_amount_latest(&client, &recipient), 500);
    }

    #[test]
    fn test_release_incremental() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let (_, recipient) = setup_schedule(&env, &client);

        env.ledger().set_sequence_number(125);
        release_latest(&client, &recipient);
        assert_eq!(released_amount_latest(&client, &recipient), 250);

        env.ledger().set_sequence_number(150);
        release_latest(&client, &recipient);
        assert_eq!(released_amount_latest(&client, &recipient), 500);

        env.ledger().set_sequence_number(200);
        release_latest(&client, &recipient);
        assert_eq!(released_amount_latest(&client, &recipient), 1000);
    }

    #[test]
    #[should_panic(expected = "nothing to release")]
    fn test_double_release_same_ledger_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let (_, recipient) = setup_schedule(&env, &client);

        env.ledger().set_sequence_number(150);
        release_latest(&client, &recipient);
        release_latest(&client, &recipient);
    }

    // ── Regression tests for issue #215: u32 underflow in release() ────

    #[test]
    fn test_release_after_full_vesting() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);
        asset_client.mint(&admin, &1000);

        // Create schedule: cliff at 100, end at 200
        client.create_schedule(&recipient, &1000, &100, &200);

        // Advance past end_ledger to simulate fully vested schedule
        env.ledger().set_sequence_number(250);

        // This should succeed without u32 underflow
        release_latest(&client, &recipient);

        // Verify full amount was released
        assert_eq!(released_amount_latest(&client, &recipient), 1000);
        assert_eq!(token_client.balance(&recipient), 1000);
    }

    #[test]
    fn test_release_at_exact_end_ledger() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);
        asset_client.mint(&admin, &1000);

        client.create_schedule(&recipient, &1000, &100, &200);

        // Advance to exactly end_ledger
        env.ledger().set_sequence_number(200);

        release_latest(&client, &recipient);

        // Verify full amount was released
        assert_eq!(released_amount_latest(&client, &recipient), 1000);
        assert_eq!(token_client.balance(&recipient), 1000);
    }

    #[test]
    fn test_release_one_ledger_before_end() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);
        asset_client.mint(&admin, &1000);

        client.create_schedule(&recipient, &1000, &100, &200);

        // Advance to one ledger before end
        env.ledger().set_sequence_number(199);

        release_latest(&client, &recipient);

        // Verify nearly full amount was released (990 out of 1000)
        assert_eq!(released_amount_latest(&client, &recipient), 990);
        assert_eq!(token_client.balance(&recipient), 990);
    }

    #[test]
    fn test_release_far_past_end_ledger() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);
        asset_client.mint(&admin, &1000);

        client.create_schedule(&recipient, &1000, &100, &200);

        // Advance well past end_ledger (simulating a schedule left unclaimed for some time)
        // Using 500 to avoid test environment archiving issues while still testing the fix
        env.ledger().set_sequence_number(500);

        // This should succeed without u32 underflow
        release_latest(&client, &recipient);

        assert_eq!(released_amount_latest(&client, &recipient), 1000);
        assert_eq!(token_client.balance(&recipient), 1000);
    }

    // ────────────────────────────────────────────────────────────────────

    #[test]
    fn test_revoke_transfers_correctly() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);
        asset_client.mint(&admin, &1000);

        client.create_schedule(&recipient, &1000, &100, &200);

        env.ledger().set_sequence_number(150);
        revoke_latest(&client, &recipient);

        assert_eq!(token_client.balance(&recipient), 500);
        assert_eq!(token_client.balance(&admin), 500);
    }

    #[test]
    fn test_revoke_after_partial_release() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);
        asset_client.mint(&admin, &1000);

        client.create_schedule(&recipient, &1000, &100, &200);

        env.ledger().set_sequence_number(125);
        release_latest(&client, &recipient);
        assert_eq!(token_client.balance(&recipient), 250);

        env.ledger().set_sequence_number(175);
        revoke_latest(&client, &recipient);

        assert_eq!(token_client.balance(&recipient), 750);
        assert_eq!(token_client.balance(&admin), 250);
    }

    #[test]
    #[should_panic(expected = "schedule has been revoked")]
    fn test_release_after_revoke_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let (_, recipient) = setup_schedule(&env, &client);

        env.ledger().set_sequence_number(150);
        revoke_latest(&client, &recipient);

        env.ledger().set_sequence_number(200);
        release_latest(&client, &recipient);
    }

    #[test]
    #[should_panic(expected = "schedule already revoked")]
    fn test_double_revoke_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let (_, recipient) = setup_schedule(&env, &client);

        revoke_latest(&client, &recipient);
        revoke_latest(&client, &recipient);
    }

    #[test]
    #[should_panic]
    fn test_revoke_non_admin_panics() {
        let env = Env::default();
        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = Address::generate(&env);
        client.initialize(&admin, &token);
        client.revoke(&recipient, &latest_index());
    }

    // ── extend_cliff tests ─────────────────────────────────────────────

    #[test]
    fn test_extend_cliff_success() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let (_, recipient) = setup_schedule(&env, &client);

        // Cliff is at 100; extend it to 150 while current ledger is still 0
        extend_cliff_latest(&client, &recipient, 150u32);

        let schedule = get_schedule_latest(&client, &recipient);
        assert_eq!(schedule.cliff_ledger, 150);
        assert_eq!(schedule.end_ledger, 200); // unchanged

        // Verify event emission contains (old_cliff, new_cliff)
        use soroban_sdk::xdr::ToXdr;
        use soroban_sdk::IntoVal;
        let events = env.events().all();
        let last_event = events.slice(events.len() - 1..);
        assert_eq!(
            last_event,
            soroban_sdk::vec![
                &env,
                (
                    contract_id,
                    (symbol_short!("clf_ext"), recipient).into_val(&env),
                    (100u32, 150u32).into_val(&env)
                )
            ]
        );
    }

    #[test]
    #[should_panic(expected = "new_cliff must be later than current cliff")]
    fn test_extend_cliff_cannot_reduce() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let (_, recipient) = setup_schedule(&env, &client);

        // cliff is 100; trying to set it to 50 must panic
        extend_cliff_latest(&client, &recipient, 50u32);
    }

    #[test]
    #[should_panic(expected = "cliff has already passed")]
    fn test_extend_cliff_after_cliff_passed() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let (_, recipient) = setup_schedule(&env, &client);

        // Jump past the cliff
        env.ledger().set_sequence_number(120);
        extend_cliff_latest(&client, &recipient, 150u32);
    }

    #[test]
    #[should_panic]
    fn test_extend_cliff_non_admin_panics() {
        let env = Env::default();
        // Do NOT mock all auths — only mock nothing so admin auth fails
        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract(admin.clone());
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);

        // Use mock_all_auths only for setup
        env.mock_all_auths();
        client.initialize(&admin, &token);
        asset_client.mint(&admin, &1_000_000i128);
        let recipient = Address::generate(&env);
        client.create_schedule(&recipient, &1_000i128, &100u32, &200u32);

        // Clear auths so the next call fails
        env.set_auths(&[]);
        client.extend_cliff(&recipient, &150u32, &latest_index());
    }

    #[test]
    #[should_panic(expected = "vesting contract is paused")]
    fn test_extend_cliff_blocked_when_paused() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);
        let (_, recipient) = setup_schedule(&env, &client);

        client.pause();
        // Must panic: "vesting contract is paused"
        extend_cliff_latest(&client, &recipient, 150u32);
    }

    #[test]
    #[should_panic(expected = "total_amount must be positive")]
    fn test_create_schedule_invalid_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, recipient) = (
            VestingContractClient::new(&env, &env.register_contract(None, VestingContract)),
            Address::generate(&env),
            Address::generate(&env),
        );
        client.initialize(&admin, &Address::generate(&env));
        client.create_schedule(&recipient, &0, &100, &200);
    }

    #[test]
    fn test_create_schedules_batch_basic() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);

        // Mint enough tokens for all schedules
        asset_client.mint(&admin, &5000);

        // Create batch of 3 schedules
        let recipient1 = Address::generate(&env);
        let recipient2 = Address::generate(&env);
        let recipient3 = Address::generate(&env);

        let mut schedules = Vec::new(&env);
        schedules.push_back(ScheduleInput {
            recipient: recipient1.clone(),
            total_amount: 1000,
            cliff_ledger: 100,
            end_ledger: 200,
        });
        schedules.push_back(ScheduleInput {
            recipient: recipient2.clone(),
            total_amount: 2000,
            cliff_ledger: 150,
            end_ledger: 250,
        });
        schedules.push_back(ScheduleInput {
            recipient: recipient3.clone(),
            total_amount: 1500,
            cliff_ledger: 120,
            end_ledger: 220,
        });

        let count = client.create_schedules_batch(&schedules);
        assert_eq!(count, 3);

        // Verify all schedules were created correctly
        let schedule1 = get_schedule_latest(&client, &recipient1);
        assert_eq!(schedule1.total_amount, 1000);
        assert_eq!(schedule1.cliff_ledger, 100);
        assert_eq!(schedule1.end_ledger, 200);

        let schedule2 = get_schedule_latest(&client, &recipient2);
        assert_eq!(schedule2.total_amount, 2000);
        assert_eq!(schedule2.cliff_ledger, 150);
        assert_eq!(schedule2.end_ledger, 250);

        let schedule3 = get_schedule_latest(&client, &recipient3);
        assert_eq!(schedule3.total_amount, 1500);
        assert_eq!(schedule3.cliff_ledger, 120);
        assert_eq!(schedule3.end_ledger, 220);
    }

    #[test]
    fn test_create_schedules_batch_large() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);

        // Mint enough tokens for 50 schedules
        asset_client.mint(&admin, &50_000);

        // Create batch of 50 schedules (simulating staff/investor distribution)
        let mut schedules = Vec::new(&env);
        for i in 0..50 {
            let recipient = Address::generate(&env);
            schedules.push_back(ScheduleInput {
                recipient,
                total_amount: 1000,
                cliff_ledger: 100,
                end_ledger: 200,
            });
        }

        let count = client.create_schedules_batch(&schedules);
        assert_eq!(count, 50);
    }

    #[test]
    #[should_panic(expected = "batch size exceeds maximum of 50")]
    fn test_create_schedules_batch_too_large() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);

        // Ensure funding checks do not mask the batch-size assertion.
        asset_client.mint(&admin, &100_000);

        let mut schedules = Vec::new(&env);
        for _ in 0..51 {
            schedules.push_back(ScheduleInput {
                recipient: Address::generate(&env),
                total_amount: 1000,
                cliff_ledger: 100,
                end_ledger: 200,
            });
        }

        client.create_schedules_batch(&schedules);
    }

    #[test]
    #[should_panic(expected = "schedules cannot be empty")]
    fn test_create_schedules_batch_empty() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());

        client.initialize(&admin, &token_addr);

        let schedules = Vec::new(&env);
        client.create_schedules_batch(&schedules);
    }

    #[test]
    #[should_panic(expected = "total_amount must be positive")]
    fn test_create_schedules_batch_invalid_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());

        client.initialize(&admin, &token_addr);

        let recipient = Address::generate(&env);
        let mut schedules = Vec::new(&env);
        schedules.push_back(ScheduleInput {
            recipient,
            total_amount: 0,
            cliff_ledger: 100,
            end_ledger: 200,
        });

        client.create_schedules_batch(&schedules);
    }

    #[test]
    #[should_panic(expected = "end_ledger must be after cliff_ledger")]
    fn test_create_schedules_batch_invalid_ledgers() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());

        client.initialize(&admin, &token_addr);

        let recipient = Address::generate(&env);
        let mut schedules = Vec::new(&env);
        schedules.push_back(ScheduleInput {
            recipient,
            total_amount: 1000,
            cliff_ledger: 200,
            end_ledger: 100,
        });

        client.create_schedules_batch(&schedules);
    }

    #[test]
    fn test_create_schedules_batch_duplicate_recipient_assigns_indexes() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);
        asset_client.mint(&admin, &5000);

        let recipient = Address::generate(&env);
        let mut schedules = Vec::new(&env);
        schedules.push_back(ScheduleInput {
            recipient: recipient.clone(),
            total_amount: 1000,
            cliff_ledger: 100,
            end_ledger: 200,
        });
        schedules.push_back(ScheduleInput {
            recipient: recipient.clone(),
            total_amount: 2000,
            cliff_ledger: 150,
            end_ledger: 250,
        });

        let count = client.create_schedules_batch(&schedules);
        assert_eq!(count, 2);
        assert_eq!(client.get_schedule_count(&recipient), 2);

        let first_schedule = get_schedule_at(&client, &recipient, 0);
        assert_eq!(first_schedule.total_amount, 1000);
        assert_eq!(first_schedule.end_ledger, 200);

        let latest_schedule = get_schedule_latest(&client, &recipient);
        assert_eq!(latest_schedule.total_amount, 2000);
        assert_eq!(latest_schedule.end_ledger, 250);
    }

    #[test]
    fn test_create_schedules_batch_existing_schedule_appends_new_index() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);
        asset_client.mint(&admin, &5000);

        let recipient = Address::generate(&env);

        // Create a schedule first
        client.create_schedule(&recipient, &1000, &100, &200);

        // Try to create batch with same recipient
        let mut schedules = Vec::new(&env);
        schedules.push_back(ScheduleInput {
            recipient: recipient.clone(),
            total_amount: 2000,
            cliff_ledger: 150,
            end_ledger: 250,
        });

        client.create_schedules_batch(&schedules);

        assert_eq!(client.get_schedule_count(&recipient), 2);
        assert_eq!(get_schedule_at(&client, &recipient, 0).total_amount, 1000);
        assert_eq!(get_schedule_at(&client, &recipient, 1).total_amount, 2000);
    }

    #[test]
    fn test_create_schedules_batch_release_works() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);
        asset_client.mint(&admin, &3000);

        let recipient1 = Address::generate(&env);
        let recipient2 = Address::generate(&env);

        let mut schedules = Vec::new(&env);
        schedules.push_back(ScheduleInput {
            recipient: recipient1.clone(),
            total_amount: 1000,
            cliff_ledger: 100,
            end_ledger: 200,
        });
        schedules.push_back(ScheduleInput {
            recipient: recipient2.clone(),
            total_amount: 2000,
            cliff_ledger: 100,
            end_ledger: 200,
        });

        client.create_schedules_batch(&schedules);

        // Test release for both recipients
        env.ledger().set_sequence_number(150);

        release_latest(&client, &recipient1);
        assert_eq!(token_client.balance(&recipient1), 500);

        release_latest(&client, &recipient2);
        assert_eq!(token_client.balance(&recipient2), 1000);
    }

    #[test]
    fn test_multiple_schedules_for_same_recipient_can_be_released_independently() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);
        asset_client.mint(&admin, &3000);

        client.create_schedule(&recipient, &1000, &100, &200);
        client.create_schedule(&recipient, &2000, &150, &250);

        assert_eq!(client.get_schedule_count(&recipient), 2);
        assert_eq!(get_schedule_latest(&client, &recipient).total_amount, 2000);
        assert_eq!(vested_amount_latest(&client, &recipient), 0);

        env.ledger().set_sequence_number(200);

        assert_eq!(vested_amount_at(&client, &recipient, 0), 1000);
        assert_eq!(vested_amount_at(&client, &recipient, 1), 1000);

        release_at(&client, &recipient, 0);
        assert_eq!(released_amount_at(&client, &recipient, 0), 1000);
        assert_eq!(released_amount_latest(&client, &recipient), 0);

        release_latest(&client, &recipient);
        assert_eq!(released_amount_latest(&client, &recipient), 1000);
        assert_eq!(token_client.balance(&recipient), 2000);
    }

    #[test]
    fn test_revoke_can_target_older_schedule_by_index() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VestingContract);
        let client = VestingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract(admin.clone());
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let asset_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        client.initialize(&admin, &token_addr);
        asset_client.mint(&admin, &3000);

        client.create_schedule(&recipient, &1000, &100, &200);
        client.create_schedule(&recipient, &2000, &150, &250);

        env.ledger().set_sequence_number(175);
        revoke_at(&client, &recipient, 0);

        assert!(get_schedule_at(&client, &recipient, 0).revoked);
        assert!(!get_schedule_latest(&client, &recipient).revoked);
        assert_eq!(token_client.balance(&recipient), 750);
        assert_eq!(token_client.balance(&admin), 250);
    }
}
