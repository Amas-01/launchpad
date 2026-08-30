//! # Fuzz / Property-Based Tests for Token Arithmetic
//!
//! This module validates the core arithmetic invariants of the `TokenContract`
//! using property-based (fuzz) testing via the [`proptest`] crate.
//!
//! ## Invariants
//!
//! The following invariants **must** hold at all times:
//!
//! 1. **Balance–Supply Conservation**
//!    `∑ balance(account) == total_supply` for every tracked account.
//!
//! 2. **Mint Additivity**
//!    `mint(to, amount)` ⟹ `balance(to)' == balance(to) + amount`
//!    **and** `total_supply' == total_supply + amount`.
//!
//! 3. **Burn Additivity**
//!    `burn(from, amount)` ⟹ `balance(from)' == balance(from) - amount`
//!    **and** `total_supply' == total_supply - amount`.
//!
//! 4. **Transfer Conservation**
//!    `transfer(from, to, amount)` ⟹ `total_supply' == total_supply`
//!    **and** `balance(from)' + balance(to)' == balance(from) + balance(to)`.
//!
//! 5. **Non-Negative Balances**
//!    `balance(account) >= 0` for every account, always.
//!
//! 6. **Max-Supply Cap**
//!    If `max_supply` is set then `total_supply <= max_supply` always.
//!
//! 7. **Zero-Amount Rejection**
//!    `mint(_, 0)`, `burn(_, 0)`, and `transfer(_, _, 0)` must revert.
//!
//! 8. **Overflow Protection**
//!    Operations whose result would overflow `i128` must revert rather than
//!    wrapping silently.

use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env, String};
use soroban_token::{TokenContract, TokenContractClient};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// 1 000 000 tokens with 7 decimals.
const INITIAL_SUPPLY: i128 = 10_000_000_000_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Create an uncapped token environment with three distinct addresses.
fn setup_env() -> (Env, TokenContractClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let id = env.register_contract(None, TokenContract);
    let client = TokenContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    client.initialize(
        &admin,
        &7u32,
        &String::from_str(&env, "FuzzToken"),
        &String::from_str(&env, "FZT"),
        &INITIAL_SUPPLY,
        &None,
        &false,
        &false,
        &None,
        &None,
    );

    (env, client, admin, user1, user2)
}

/// Create a capped token environment.
fn setup_capped_env(
    initial: i128,
    cap: i128,
) -> (Env, TokenContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let id = env.register_contract(None, TokenContract);
    let client = TokenContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(
        &admin,
        &7u32,
        &String::from_str(&env, "CappedFuzz"),
        &String::from_str(&env, "CFZ"),
        &initial,
        &Some(cap),
        &false,
        &false,
        &None,
        &None,
    );

    (env, client, admin, user)
}

/// **Invariant 1** — sum of all tracked balances == total_supply.
fn assert_supply_invariant(client: &TokenContractClient, accounts: &[&Address]) {
    let sum: i128 = accounts.iter().map(|a| client.balance(a)).sum();
    let supply = client.total_supply();
    assert_eq!(
        sum, supply,
        "INVARIANT VIOLATED: sum of balances ({sum}) != total_supply ({supply})"
    );
}

/// **Invariant 5** — every balance >= 0.
fn assert_non_negative_balances(client: &TokenContractClient, accounts: &[&Address]) {
    for acct in accounts {
        let bal = client.balance(acct);
        assert!(bal >= 0, "INVARIANT VIOLATED: negative balance {bal}");
    }
}

/// **Invariant 6** — total_supply <= max_supply (when a cap exists).
fn assert_max_supply_invariant(client: &TokenContractClient) {
    if let Some(cap) = client.max_supply() {
        let supply = client.total_supply();
        assert!(
            supply <= cap,
            "INVARIANT VIOLATED: total_supply ({supply}) > max_supply ({cap})"
        );
    }
}

// ===========================================================================
// Property tests
// ===========================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    // ── Mint ────────────────────────────────────────────────────────────

    /// Invariant 2: mint increases balance and total_supply by exactly `amount`.
    #[test]
    fn prop_mint_preserves_balance_and_supply(amount in 1i128..=1_000_000_000_000i128) {
        let (_, client, admin, user, _) = setup_env();
        let supply_before = client.total_supply();
        let bal_before    = client.balance(&user);

        client.mint(&user, &amount);

        prop_assert_eq!(client.balance(&user), bal_before + amount);
        prop_assert_eq!(client.total_supply(), supply_before + amount);
        assert_supply_invariant(&client, &[&admin, &user]);
        assert_non_negative_balances(&client, &[&admin, &user]);
    }

    /// Multiple sequential mints accumulate correctly.
    #[test]
    fn prop_sequential_mints_accumulate(
        a1 in 1i128..=500_000_000i128,
        a2 in 1i128..=500_000_000i128,
        a3 in 1i128..=500_000_000i128,
    ) {
        let (_, client, admin, user, _) = setup_env();
        let supply_before = client.total_supply();

        client.mint(&user, &a1);
        client.mint(&user, &a2);
        client.mint(&user, &a3);

        let total_minted = a1 + a2 + a3;
        prop_assert_eq!(client.balance(&user), total_minted);
        prop_assert_eq!(client.total_supply(), supply_before + total_minted);
        assert_supply_invariant(&client, &[&admin, &user]);
    }

    // ── Burn ────────────────────────────────────────────────────────────

    /// Invariant 3: burn decreases balance and total_supply by exactly `amount`.
    #[test]
    fn prop_burn_preserves_balance_and_supply(amount in 1i128..=INITIAL_SUPPLY) {
        let (_, client, admin, _, _) = setup_env();
        let supply_before = client.total_supply();
        let bal_before    = client.balance(&admin);
        let burned_before = client.total_burned();

        client.burn(&admin, &amount);

        prop_assert_eq!(client.balance(&admin), bal_before - amount);
        prop_assert_eq!(client.total_supply(), supply_before - amount);
        prop_assert_eq!(client.total_burned(), burned_before + amount);
        assert_supply_invariant(&client, &[&admin]);
        assert_non_negative_balances(&client, &[&admin]);
    }

    /// Burn followed by an equal mint returns state to the original values.
    #[test]
    fn prop_burn_then_mint_roundtrip(amount in 1i128..=INITIAL_SUPPLY) {
        let (_, client, admin, _, _) = setup_env();
        let supply_before = client.total_supply();
        let bal_before    = client.balance(&admin);
        let burned_before = client.total_burned();

        client.burn(&admin, &amount);
        client.mint(&admin, &amount);

        prop_assert_eq!(client.balance(&admin), bal_before);
        prop_assert_eq!(client.total_supply(), supply_before);
        prop_assert_eq!(client.total_burned(), burned_before + amount);
    }

    // ── Transfer ────────────────────────────────────────────────────────

    /// Invariant 4: transfer preserves total_supply and the pair-wise sum.
    #[test]
    fn prop_transfer_conserves_supply(amount in 1i128..=INITIAL_SUPPLY) {
        let (_, client, admin, user, _) = setup_env();
        let supply_before = client.total_supply();
        let sum_before    = client.balance(&admin) + client.balance(&user);

        client.transfer(&admin, &user, &amount);

        prop_assert_eq!(client.total_supply(), supply_before);
        prop_assert_eq!(
            client.balance(&admin) + client.balance(&user),
            sum_before
        );
        assert_supply_invariant(&client, &[&admin, &user]);
        assert_non_negative_balances(&client, &[&admin, &user]);
    }

    /// Transfer A → B then B → A returns both balances to their originals.
    #[test]
    fn prop_transfer_roundtrip(amount in 1i128..=INITIAL_SUPPLY) {
        let (_, client, admin, user, _) = setup_env();
        let admin_bal = client.balance(&admin);
        let user_bal  = client.balance(&user);

        client.transfer(&admin, &user, &amount);
        client.transfer(&user, &admin, &amount);

        prop_assert_eq!(client.balance(&admin), admin_bal);
        prop_assert_eq!(client.balance(&user), user_bal);
    }

    // ── Sequential mixed operations ─────────────────────────────────────

    /// A random mint → transfer → burn sequence must keep all invariants.
    #[test]
    fn prop_mint_transfer_burn_sequence(
        mint_amt     in 1i128..=5_000_000_000_000_i128,
        transfer_pct in 1u32..=100u32,
        burn_pct     in 1u32..=100u32,
    ) {
        let (_, client, admin, user1, user2) = setup_env();
        let accounts = [&admin, &user1, &user2];

        // Step 1 — mint to user1
        client.mint(&user1, &mint_amt);
        assert_supply_invariant(&client, &accounts);

        // Step 2 — transfer a percentage of user1's balance to user2
        let user1_bal = client.balance(&user1);
        let xfer_amt  = (user1_bal as u128 * transfer_pct as u128 / 100) as i128;
        if xfer_amt > 0 {
            client.transfer(&user1, &user2, &xfer_amt);
            assert_supply_invariant(&client, &accounts);
        }

        // Step 3 — burn a percentage of admin's balance
        let admin_bal = client.balance(&admin);
        let burn_amt  = (admin_bal as u128 * burn_pct as u128 / 100) as i128;
        if burn_amt > 0 {
            client.burn(&admin, &burn_amt);
            assert_supply_invariant(&client, &accounts);
        }

        assert_non_negative_balances(&client, &accounts);
    }

    /// Repeated small operations across multiple accounts preserve the invariant.
    #[test]
    fn prop_many_transfers_preserve_invariant(
        a1 in 1i128..=1_000_000_000_i128,
        a2 in 1i128..=1_000_000_000_i128,
        a3 in 1i128..=1_000_000_000_i128,
    ) {
        let (_, client, admin, user1, user2) = setup_env();
        let accounts = [&admin, &user1, &user2];

        // Distribute from admin to multiple users
        client.transfer(&admin, &user1, &a1);
        client.transfer(&admin, &user2, &a2);
        assert_supply_invariant(&client, &accounts);

        // user1 → user2
        let user1_bal = client.balance(&user1);
        let xfer = a3.min(user1_bal);
        if xfer > 0 {
            client.transfer(&user1, &user2, &xfer);
        }
        assert_supply_invariant(&client, &accounts);

        // user2 → admin (return some tokens)
        let user2_bal = client.balance(&user2);
        if user2_bal > 0 {
            client.transfer(&user2, &admin, &user2_bal);
        }

        assert_supply_invariant(&client, &accounts);
        assert_non_negative_balances(&client, &accounts);
    }

    // ── Max-supply enforcement ──────────────────────────────────────────

    /// Invariant 6: minting within the remaining cap succeeds and respects the cap.
    #[test]
    fn prop_mint_within_cap_preserves_invariant(amount in 1i128..=5_000_000_000_i128) {
        let initial = 5_000_000_000_i128;
        let cap     = 10_000_000_000_i128;
        let (_, client, admin, user) = setup_capped_env(initial, cap);

        let remaining = cap - client.total_supply();
        prop_assume!(amount <= remaining);

        client.mint(&user, &amount);

        assert_max_supply_invariant(&client);
        assert_supply_invariant(&client, &[&admin, &user]);
    }
}

// ===========================================================================
// Zero-amount edge cases (Invariant 7)
// ===========================================================================

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_zero_amount_mint_rejected() {
    let (_, client, _, user, _) = setup_env();
    client.mint(&user, &0i128);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_zero_amount_burn_rejected() {
    let (_, client, admin, _, _) = setup_env();
    client.burn(&admin, &0i128);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_zero_amount_transfer_rejected() {
    let (_, client, admin, user, _) = setup_env();
    client.transfer(&admin, &user, &0i128);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_negative_amount_mint_rejected() {
    let (_, client, _, user, _) = setup_env();
    client.mint(&user, &-1i128);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_negative_amount_burn_rejected() {
    let (_, client, admin, _, _) = setup_env();
    client.burn(&admin, &-1i128);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_negative_amount_transfer_rejected() {
    let (_, client, admin, user, _) = setup_env();
    client.transfer(&admin, &user, &-1i128);
}

// ===========================================================================
// i128 overflow / underflow (Invariant 8)
// ===========================================================================

#[test]
#[should_panic]
fn test_mint_i128_overflow() {
    let env = Env::default();
    env.mock_all_auths();

    let id = env.register_contract(None, TokenContract);
    let client = TokenContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Start near i128::MAX so the next mint overflows total_supply.
    client.initialize(
        &admin,
        &7u32,
        &String::from_str(&env, "OverflowToken"),
        &String::from_str(&env, "OVF"),
        &(i128::MAX - 1),
        &None,
        &false,
        &false,
        &None,
        &None,
    );

    // total_supply is (i128::MAX − 1); minting 2 overflows.
    client.mint(&user, &2i128);
}

#[test]
#[should_panic(expected = "insufficient balance to burn")]
fn test_burn_underflow_rejected() {
    let (_, client, _, user, _) = setup_env();
    // user has 0 balance — burning 1 must revert.
    client.burn(&user, &1i128);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_transfer_underflow_rejected() {
    let (_, client, _, user1, user2) = setup_env();
    // user1 has 0 balance — transferring 1 must revert.
    client.transfer(&user1, &user2, &1i128);
}

#[test]
#[should_panic(expected = "mint would exceed max_supply")]
fn test_mint_exceeds_max_supply_rejected() {
    let initial = 5_000_000_000_i128;
    let cap = 10_000_000_000_i128;
    let (_, client, _, user) = setup_capped_env(initial, cap);

    // Remaining capacity is 500_0000000 — minting 1 more overflows the cap.
    client.mint(&user, &(500_0000001i128));
}

// ===========================================================================
// Decimal range validation (issue #261)
// ===========================================================================

#[test]
#[should_panic(expected = "decimals must be <= 18")]
fn test_initialize_rejects_decimals_above_18() {
    let env = Env::default();
    env.mock_all_auths();

    let id = env.register_contract(None, TokenContract);
    let client = TokenContractClient::new(&env, &id);
    let admin = Address::generate(&env);

    client.initialize(
        &admin,
        &19u32,
        &String::from_str(&env, "BadToken"),
        &String::from_str(&env, "BAD"),
        &0i128,
        &None,
        &false,
        &false,
        &None,
        &None,
    );
}

#[test]
fn test_initialize_accepts_decimals_at_boundary() {
    let env = Env::default();
    env.mock_all_auths();

    let id = env.register_contract(None, TokenContract);
    let client = TokenContractClient::new(&env, &id);
    let admin = Address::generate(&env);

    client.initialize(
        &admin,
        &18u32,
        &String::from_str(&env, "EdgeToken"),
        &String::from_str(&env, "EDG"),
        &0i128,
        &None,
        &false,
        &false,
        &None,
        &None,
    );

    assert_eq!(client.decimals(), 18u32);
}

// ===========================================================================
// Regression: partial transfer_from / burn_from with above-max-TTL allowance
// (#344 / #400)
//
// approve correctly clamps the TTL it writes but stores the *unclamped*
// expiration_ledger in AllowanceValue.  transfer_from and burn_from were
// calling extend_ttl with that unclamped delta, which the host rejects for
// Temporary entries.  A full spend escaped via the remove() branch; a
// partial spend always reverted.
//
// The test sets the ledger's max_entry_ttl to the real mainnet value
// (3,110,400) so the default harness ceiling (6,312,000) cannot hide the
// regression, then asserts that a partial spend succeeds.
// ===========================================================================

/// Real Soroban mainnet max_entry_ttl (seconds / 5 s per ledger ≈ 180 days).
const MAINNET_MAX_ENTRY_TTL: u32 = 3_110_400;

/// Approve for 365 days, which is ~6,307,200 ledgers — well above
/// MAINNET_MAX_ENTRY_TTL.  This is exactly what ApproveForm defaults to
/// (see issue #400).
const APPROVE_LEDGERS_365_DAYS: u32 = 365 * 24 * 60 * 60 / 5; // 6,307,200

#[test]
fn test_partial_transfer_from_succeeds_with_above_max_ttl_allowance() {
    let env = Env::default();
    env.mock_all_auths();

    // Force max_entry_ttl to the real mainnet value so the harness default
    // (6,312,000) cannot mask the regression.
    env.ledger().set_max_entry_ttl(MAINNET_MAX_ENTRY_TTL);

    let id = env.register_contract(None, TokenContract);
    let client = TokenContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    let initial_supply = 10_000i128;
    client.initialize(
        &admin,
        &7u32,
        &String::from_str(&env, "TestToken"),
        &String::from_str(&env, "TST"),
        &initial_supply,
        &None,
        &false,
        &false,
        &None,
        &None,
    );

    // Fund the owner account.
    client.transfer(&admin, &owner, &1_000i128);

    // Approve spender for 1,000 tokens with a 365-day expiry
    // (6,307,200 ledgers from now — above MAINNET_MAX_ENTRY_TTL).
    let current = env.ledger().sequence();
    let expiration = current + APPROVE_LEDGERS_365_DAYS;
    client.approve(&owner, &spender, &1_000i128, &expiration);

    // Partial spend: take 400.  Before the fix this reverted with
    // Storage/InvalidAction because extend_ttl was called with a delta that
    // exceeded max_entry_ttl.
    let recipient = Address::generate(&env);
    client.transfer_from(&spender, &owner, &recipient, &400i128);

    assert_eq!(client.balance(&recipient), 400i128);
    assert_eq!(client.allowance(&owner, &spender), 600i128);
}

#[test]
fn test_partial_burn_from_succeeds_with_above_max_ttl_allowance() {
    let env = Env::default();
    env.mock_all_auths();

    // Same real-mainnet ceiling.
    env.ledger().set_max_entry_ttl(MAINNET_MAX_ENTRY_TTL);

    let id = env.register_contract(None, TokenContract);
    let client = TokenContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    let initial_supply = 10_000i128;
    client.initialize(
        &admin,
        &7u32,
        &String::from_str(&env, "TestToken"),
        &String::from_str(&env, "TST"),
        &initial_supply,
        &None,
        &false,
        &false,
        &None,
        &None,
    );

    client.transfer(&admin, &owner, &1_000i128);

    let current = env.ledger().sequence();
    let expiration = current + APPROVE_LEDGERS_365_DAYS;
    client.approve(&owner, &spender, &1_000i128, &expiration);

    // Partial burn: destroy 400 of the 1,000 allowance.
    client.burn_from(&spender, &owner, &400i128);

    assert_eq!(client.balance(&owner), 600i128);
    assert_eq!(client.allowance(&owner, &spender), 600i128);
}
