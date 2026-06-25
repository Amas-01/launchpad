#![no_std]

use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    String,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    PendingAdmin,
    ComplianceNode,
    Name,
    Symbol,
    Decimals,
    TotalSupply,
    TotalBurned,
    MaxSupply,
    MaxBalancePerAccount,
    ContractUri,
    Balance(Address),
    Allowance(Address, Address), // (owner, spender)
    Frozen(Address),
    IsPaused,
    /// Set to `true` after `revoke_admin` is called. Once locked, no admin
    /// operation (mint, burn_admin, freeze, propose_admin) can
    /// ever succeed again — the token becomes effectively immutable.
    Locked,
    AuthorizationRequired,
    AuthorizationRevocable,
    AuthorizedHolder(Address),
}

#[contractclient(name = "ComplianceNodeClient")]
pub trait ComplianceNodeInterface {
    fn can_trade(env: Env, from: Address, to: Address) -> bool;
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/// SEP-41 Token Contract — base implementation.
///
/// Contributor issues layered on top:
/// - #1  freeze_account / unfreeze_account (guard on transfer)
/// - #2  two-step admin transfer (propose_admin / accept_admin)
/// - #4  max_supply cap enforcement in mint
/// - #138 clawback() and #163 compliance-node transfer checks
#[contract]
pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    // ── Initialization ──────────────────────────────────────────────────

    /// Initialize the token with metadata and an initial supply minted to `admin`.
    ///
    /// `authorization_required`: when true, recipients must be explicitly authorized
    /// by the admin before they can receive or hold tokens.
    ///
    /// `authorization_revocable`: when true, the admin may revoke a holder's
    /// authorization, preventing them from receiving further transfers.
    pub fn initialize(
        env: Env,
        admin: Address,
        decimal: u32,
        name: String,
        symbol: String,
        initial_supply: i128,
        max_supply: Option<i128>,
        authorization_required: bool,
        authorization_revocable: bool,
        compliance_node: Option<Address>,
    ) {
        // Prevent re-initialization
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        if let Some(cap) = max_supply {
            assert!(cap > 0, "max_supply must be positive");
            assert!(initial_supply <= cap, "initial_supply exceeds max_supply");
            env.storage().instance().set(&DataKey::MaxSupply, &cap);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        env.storage().instance().set(&DataKey::TotalBurned, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizationRequired, &authorization_required);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizationRevocable, &authorization_revocable);
        if let Some(node) = compliance_node {
            env.storage()
                .instance()
                .set(&DataKey::ComplianceNode, &node);
        }

        // When authorization_required is enabled the admin is automatically
        // authorized so the initial supply mint succeeds.
        if authorization_required {
            env.storage()
                .persistent()
                .set(&DataKey::AuthorizedHolder(admin.clone()), &true);
        }

        if initial_supply > 0 {
            Self::_mint(&env, &admin, initial_supply);
        }

        env.events().publish((symbol_short!("init"),), admin);
    }

    // ── Admin actions ───────────────────────────────────────────────────

    /// Mint `amount` tokens to `to`. Admin only.
    pub fn mint(env: Env, to: Address, amount: i128) {
        Self::_check_paused(&env);
        Self::_require_admin(&env);
        assert!(amount > 0, "amount must be positive");
        Self::_mint(&env, &to, amount);

        // Extend TTL for the balance key to prevent archiving
        let ttl_ledgers = 52 * 7 * 24 * 60 / 5; // ~52 weeks (assuming 5-second ledgers)
        let key = DataKey::Balance(to);
        env.storage()
            .persistent()
            .extend_ttl(&key, ttl_ledgers, ttl_ledgers);
    }

    /// Burn `amount` tokens from `from`. Owner only (standard burn).
    pub fn burn(env: Env, from: Address, amount: i128) {
        Self::_check_paused(&env);
        from.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::_burn(&env, &from, amount);
    }

    /// Forced burn of `amount` tokens from `from`. Admin only.
    pub fn burn_admin(env: Env, from: Address, amount: i128) {
        Self::_check_paused(&env);
        Self::_require_admin(&env);
        assert!(amount > 0, "amount must be positive");
        Self::_burn(&env, &from, amount);
    }

    /// Forcefully move `amount` tokens from `from` into the admin balance.
    /// Admin only.
    pub fn clawback(env: Env, from: Address, amount: i128) {
        Self::_check_paused(&env);
        Self::_require_admin(&env);
        assert!(amount > 0, "amount must be positive");

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin revoked");
        Self::_transfer(&env, &from, &admin, amount);

        let ttl_ledgers = 52 * 7 * 24 * 60 / 5; // ~52 weeks (assuming 5-second ledgers)
        let from_key = DataKey::Balance(from.clone());
        let admin_key = DataKey::Balance(admin.clone());
        env.storage()
            .persistent()
            .extend_ttl(&from_key, ttl_ledgers, ttl_ledgers);
        env.storage()
            .persistent()
            .extend_ttl(&admin_key, ttl_ledgers, ttl_ledgers);

        env.events()
            .publish((symbol_short!("clawback"), from.clone()), amount);
    }

    /// Mint `amount` tokens to multiple recipients. Admin only.
    pub fn mint_batch(env: Env, to: soroban_sdk::Vec<Address>, amounts: soroban_sdk::Vec<i128>) {
        Self::_check_paused(&env);
        Self::_require_admin(&env);
        assert!(to.len() == amounts.len(), "mismatching lengths");
        for i in 0..to.len() {
            let recipient = to.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            assert!(amount > 0, "amount must be positive");
            Self::_mint(&env, &recipient, amount);
        }
    }

    /// Burn `amount` tokens from the caller's own balance. Refuses to
    /// run when the account is frozen so a holder cannot dodge a freeze
    /// by destroying tokens.
    pub fn burn_self(env: Env, from: Address, amount: i128) {
        Self::_check_paused(&env);
        from.require_auth();
        assert!(amount > 0, "amount must be positive");
        assert!(!Self::_is_frozen(&env, &from), "account is frozen");
        Self::_burn(&env, &from, amount);
    }

    /// Propose a new admin. Must be called by the current admin.
    /// The new admin must call `accept_admin` to finalize the transfer.
    pub fn propose_admin(env: Env, new_admin: Address) {
        Self::_require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
    }

    /// Accept the admin role. Must be called by the pending admin.
    pub fn accept_admin(env: Env) {
        Self::_require_not_locked(&env);
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .expect("no pending admin");
        pending.require_auth();
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
    }

    /// Permanently revoke the admin role and lock the contract.
    ///
    /// After this call:
    /// - No further `mint`, `burn_admin`, `freeze`, `unfreeze`,
    ///   `propose_admin`, `accept_admin`, `pause`, or
    ///   `unpause` operation can ever succeed.
    /// - The Admin storage entry is removed and a `Locked` flag is set.
    /// - `is_locked()` returns `true` from then on.
    ///
    /// Holders can still `transfer`, `approve`, `transfer_from`, `burn`,
    /// and `burn_self`. The token becomes trustless / immutable.
    ///
    /// **This action is irreversible.**
    pub fn revoke_admin(env: Env) {
        Self::_require_admin(&env);
        env.storage().instance().set(&DataKey::Locked, &true);
        env.storage().instance().remove(&DataKey::Admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.events().publish((symbol_short!("revoked"),), true);
    }

    /// Freeze an account, preventing it from sending tokens. Admin only.
    pub fn freeze_account(env: Env, addr: Address) {
        Self::_require_admin(&env);
        env.storage()
            .persistent()
            .set(&DataKey::Frozen(addr.clone()), &true);
        env.events().publish((symbol_short!("freeze"), addr), ());
    }

    /// Unfreeze a previously frozen account. Admin only.
    pub fn unfreeze_account(env: Env, addr: Address) {
        Self::_require_admin(&env);
        env.storage()
            .persistent()
            .remove(&DataKey::Frozen(addr.clone()));
        env.events().publish((symbol_short!("unfreeze"), addr), ());
    }

    /// Pause the contract, halting all state-changing operations. Admin only.
    pub fn pause(env: Env) {
        Self::_require_admin(&env);
        env.storage().instance().set(&DataKey::IsPaused, &true);
        env.events().publish((symbol_short!("pause"),), true);
    }

    /// Unpause the contract. Admin only.
    pub fn unpause(env: Env) {
        Self::_require_admin(&env);
        env.storage().instance().remove(&DataKey::IsPaused);
        env.events().publish((symbol_short!("pause"),), false);
    }

    /// Grant authorization to `holder`, allowing them to receive tokens when
    /// `authorization_required` is enabled. Admin only.
    pub fn authorize_holder(env: Env, holder: Address) {
        Self::_require_admin(&env);
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedHolder(holder.clone()), &true);
        env.events()
            .publish((symbol_short!("auth"),), (holder, true));
    }

    /// Revoke authorization from `holder`. Only allowed when
    /// `authorization_revocable` is enabled. Admin only.
    pub fn revoke_authorization(env: Env, holder: Address) {
        Self::_require_admin(&env);
        let revocable: bool = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizationRevocable)
            .unwrap_or(false);
        assert!(revocable, "authorization is not revocable for this token");
        env.storage()
            .persistent()
            .remove(&DataKey::AuthorizedHolder(holder.clone()));
        env.events()
            .publish((symbol_short!("auth"),), (holder, false));
    }

    /// Returns `true` if `holder` is authorized to receive tokens.
    /// Always returns `true` when `authorization_required` is disabled.
    pub fn is_authorized(env: Env, holder: Address) -> bool {
        let required: bool = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizationRequired)
            .unwrap_or(false);
        if !required {
            return true;
        }
        env.storage()
            .persistent()
            .get(&DataKey::AuthorizedHolder(holder))
            .unwrap_or(false)
    }

    /// Returns `true` if this token requires holders to be authorized before
    /// receiving transfers.
    pub fn authorization_required(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::AuthorizationRequired)
            .unwrap_or(false)
    }

    /// Returns `true` if the admin may revoke holder authorization.
    pub fn authorization_revocable(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::AuthorizationRevocable)
            .unwrap_or(false)
    }

    /// Set or update the contract URI pointing to off-chain metadata JSON.
    /// Admin only.
    pub fn update_contract_uri(env: Env, uri: String) {
        Self::_require_admin(&env);
        env.storage().instance().set(&DataKey::ContractUri, &uri);
    }

    /// Upgrade this contract's WASM code hash in place. Admin only.
    ///
    /// Security note: this preserves existing storage and contract address, so
    /// new WASM must remain storage-compatible with previous deployments.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::_require_admin(&env);
        assert!(
            new_wasm_hash != BytesN::from_array(&env, &[0; 32]),
            "invalid wasm hash"
        );
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        env.events()
            .publish((symbol_short!("upgrade"),), new_wasm_hash);
    }

    // ── Token operations ────────────────────────────────────────────────

    /// Transfer `amount` from `from` to `to`. Caller must be `from`.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        Self::_check_paused(&env);
        from.require_auth();
        assert!(amount > 0, "amount must be positive");
        assert!(!Self::_is_frozen(&env, &from), "account is frozen");
        Self::_check_compliance(&env, &from, &to);
        Self::_check_authorized(&env, &to);

        Self::_transfer(&env, &from, &to, amount);

        // Extend TTL for both balance keys to prevent archiving
        // Use a standard TTL extension (e.g., 52 weeks in ledgers)
        let ttl_ledgers = 52 * 7 * 24 * 60 / 5; // ~52 weeks (assuming 5-second ledgers)
        let from_key = DataKey::Balance(from);
        let to_key = DataKey::Balance(to);
        env.storage()
            .persistent()
            .extend_ttl(&from_key, ttl_ledgers, ttl_ledgers);
        env.storage()
            .persistent()
            .extend_ttl(&to_key, ttl_ledgers, ttl_ledgers);
    }

    /// Approve `spender` to spend up to `amount` on behalf of `from`.
    ///
    /// `expiration_ledger` must be strictly greater than the current ledger
    /// sequence. The allowance TTL is derived from this value, so callers
    /// must supply a valid future ledger (SEP-41 requirement).
    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        from.require_auth();
        assert!(amount >= 0, "amount must be non-negative");

        let current_ledger = env.ledger().sequence();
        assert!(
            expiration_ledger > current_ledger,
            "expiration_ledger must be in the future"
        );

        let key = DataKey::Allowance(from.clone(), spender.clone());
        env.storage().persistent().set(&key, &amount);

        // Use the caller-supplied expiration to set the allowance TTL exactly
        // as the SEP-41 standard requires — no silent fallback.
        let ttl_ledgers = expiration_ledger - current_ledger;
        env.storage()
            .persistent()
            .extend_ttl(&key, ttl_ledgers, ttl_ledgers);

        env.events()
            .publish((symbol_short!("approve"), from, spender), amount);
    }

    /// Transfer `amount` from `from` to `to` using `spender`'s allowance.
    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        Self::_check_paused(&env);
        spender.require_auth();
        assert!(amount > 0, "amount must be positive");
        assert!(!Self::_is_frozen(&env, &from), "account is frozen");
        Self::_check_compliance(&env, &from, &to);
        Self::_check_authorized(&env, &to);

        let key = DataKey::Allowance(from.clone(), spender.clone());
        let allowance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        assert!(allowance >= amount, "insufficient allowance");

        env.storage().persistent().set(&key, &(allowance - amount));

        Self::_transfer(&env, &from, &to, amount);

        // Extend TTL for balance keys to prevent archiving
        let ttl_ledgers = 52 * 7 * 24 * 60 / 5; // ~52 weeks (assuming 5-second ledgers)
        let from_key = DataKey::Balance(from);
        let to_key = DataKey::Balance(to);
        env.storage()
            .persistent()
            .extend_ttl(&from_key, ttl_ledgers, ttl_ledgers);
        env.storage()
            .persistent()
            .extend_ttl(&to_key, ttl_ledgers, ttl_ledgers);
    }

    // ── Read-only getters ───────────────────────────────────────────────

    pub fn balance(env: Env, id: Address) -> i128 {
        let key = DataKey::Balance(id);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let key = DataKey::Allowance(from, spender);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    pub fn admin(env: Env) -> Address {
        let locked: bool = env
            .storage()
            .instance()
            .get(&DataKey::Locked)
            .unwrap_or(false);
        if locked {
            panic!("admin revoked");
        }
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    /// Returns `true` once `revoke_admin` has been called. Once locked, no
    /// admin operation can ever succeed again.
    pub fn is_locked(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Locked)
            .unwrap_or(false)
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .expect("not initialized")
    }

    pub fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .expect("not initialized")
    }

    pub fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .expect("not initialized")
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn total_burned(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalBurned)
            .unwrap_or(0)
    }

    /// Returns `true` if the given address is frozen.
    pub fn is_frozen(env: Env, addr: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Frozen(addr))
            .unwrap_or(false)
    }

    pub fn max_supply(env: Env) -> Option<i128> {
        env.storage().instance().get(&DataKey::MaxSupply)
    }

    /// Optional whale protection: max balance per account as a percentage of total supply.
    ///
    /// If set to `p`, then for any transfer/mint to a non-admin recipient:
    /// `balance(recipient) <= total_supply * p / 100`.
    pub fn max_balance_per_account(env: Env) -> Option<u32> {
        env.storage().instance().get(&DataKey::MaxBalancePerAccount)
    }

    /// Set the optional max balance per account as a percentage of total supply.
    /// Admin only.
    ///
    /// - `None` disables whale protection
    /// - `Some(p)` enables it, where `p` must be between 1 and 100 (inclusive)
    pub fn set_max_balance_per_account(env: Env, max_balance_per_account: Option<u32>) {
        Self::_require_admin(&env);

        if let Some(p) = max_balance_per_account {
            assert!(
                (1..=100).contains(&p),
                "max_balance_per_account must be 1..=100"
            );
            env.storage()
                .instance()
                .set(&DataKey::MaxBalancePerAccount, &p);
        } else {
            env.storage()
                .instance()
                .remove(&DataKey::MaxBalancePerAccount);
        }

        env.events()
            .publish((symbol_short!("set_max_b"),), max_balance_per_account);
    }

    /// Set, update, or remove the optional compliance node address.
    /// Admin only. Pass `None` to remove the compliance node.
    pub fn set_compliance_node(env: Env, node: Option<Address>) {
        Self::_require_admin(&env);

        if let Some(addr) = node.clone() {
            env.storage()
                .instance()
                .set(&DataKey::ComplianceNode, &addr);
        } else {
            env.storage().instance().remove(&DataKey::ComplianceNode);
        }

        env.events().publish((symbol_short!("set_cnode"),), node);
    }

    /// Returns `true` if the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
    }

    pub fn contract_uri(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::ContractUri)
            .expect("contract URI not set")
    }

    /// Returns the configured compliance node, if any.
    pub fn compliance_node(env: Env) -> Option<Address> {
        env.storage()
            .instance()
            .get(&DataKey::ComplianceNode)
            .unwrap_or(None)
    }

    // ── Internal helpers ────────────────────────────────────────────────

    fn _check_authorized(env: &Env, holder: &Address) {
        let required: bool = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizationRequired)
            .unwrap_or(false);
        if required {
            let authorized: bool = env
                .storage()
                .persistent()
                .get(&DataKey::AuthorizedHolder(holder.clone()))
                .unwrap_or(false);
            assert!(authorized, "recipient is not authorized to hold this token");
        }
    }

    fn _require_admin(env: &Env) {
        Self::_require_not_locked(env);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin revoked");
        admin.require_auth();
    }

    fn _require_not_locked(env: &Env) {
        let locked: bool = env
            .storage()
            .instance()
            .get(&DataKey::Locked)
            .unwrap_or(false);
        if locked {
            panic!("admin revoked: contract is locked");
        }
    }

    fn _is_frozen(env: &Env, addr: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Frozen(addr.clone()))
            .unwrap_or(false)
    }

    fn _check_paused(env: &Env) {
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::IsPaused)
            .unwrap_or(false)
        {
            panic!("contract is paused");
        }
    }

    fn _enforce_max_balance_per_account(env: &Env, to: &Address, new_balance: i128, supply: i128) {
        let Some(pct) = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::MaxBalancePerAccount)
        else {
            return;
        };

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if to == &admin {
            return;
        }

        let max_allowed = supply
            .checked_mul(pct as i128)
            .expect("max balance calc overflow")
            / 100i128;

        assert!(
            new_balance <= max_allowed,
            "max balance per account exceeded"
        );
    }
    fn _check_compliance(env: &Env, from: &Address, to: &Address) {
        let compliance_node: Option<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ComplianceNode)
            .unwrap_or(None);

        if let Some(node) = compliance_node {
            let client = ComplianceNodeClient::new(env, &node);
            assert!(
                client.can_trade(&from.clone(), &to.clone()),
                "trade blocked by compliance node"
            );
        }
    }

    fn _mint(env: &Env, to: &Address, amount: i128) {
        Self::_check_authorized(env, to);
        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        let new_supply = supply.checked_add(amount).expect("total_supply overflow");

        if let Some(cap) = env
            .storage()
            .instance()
            .get::<DataKey, i128>(&DataKey::MaxSupply)
        {
            assert!(new_supply <= cap, "mint would exceed max_supply");
        }

        let key = DataKey::Balance(to.clone());
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        let new_balance = balance.checked_add(amount).expect("balance overflow");

        Self::_enforce_max_balance_per_account(env, to, new_balance, new_supply);

        env.storage().persistent().set(&key, &new_balance);

        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);

        env.events()
            .publish((symbol_short!("mint"), to.clone()), amount);
    }

    fn _burn(env: &Env, from: &Address, amount: i128) {
        let key = DataKey::Balance(from.clone());
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        assert!(balance >= amount, "insufficient balance to burn");
        let new_balance = balance
            .checked_sub(amount)
            .expect("balance underflow on burn");
        env.storage().persistent().set(&key, &new_balance);

        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        let new_supply = supply
            .checked_sub(amount)
            .expect("total_supply underflow on burn");
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);

        let burned: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalBurned)
            .unwrap_or(0);
        let new_total_burned = burned.checked_add(amount).expect("total_burned overflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalBurned, &new_total_burned);

        env.events()
            .publish((symbol_short!("burn"), from.clone()), amount);
    }

    fn _transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
        let from_key = DataKey::Balance(from.clone());
        let to_key = DataKey::Balance(to.clone());

        let from_balance: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        assert!(from_balance >= amount, "insufficient balance");

        env.storage()
            .persistent()
            .set(&from_key, &(from_balance - amount));

        let to_balance: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);

        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);

        let new_to_balance = to_balance.checked_add(amount).expect("balance overflow");

        Self::_enforce_max_balance_per_account(env, to, new_to_balance, supply);

        env.storage().persistent().set(&to_key, &new_to_balance);

        env.events().publish(
            (symbol_short!("transfer"), from.clone(), to.clone()),
            amount,
        );
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Events as _, Env, IntoVal};

    fn setup() -> (Env, TokenContractClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, TokenContract);
        let client = TokenContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "TestToken"),
            &String::from_str(&env, "TST"),
            &1_000_000_0000000i128, // 1M tokens with 7 decimals
            &None,
            &false,
            &false,
            &None,
        );

        (env, client, admin, user)
    }

    // ── max_balance_per_account tests ───────────────────────────────────

    #[test]
    fn test_max_balance_per_account_getter_none() {
        let (_, client, _, _) = setup();
        assert_eq!(client.max_balance_per_account(), None);
    }

    #[test]
    fn test_set_max_balance_per_account_enforces_on_transfer() {
        let (_, client, admin, user) = setup();

        client.set_max_balance_per_account(&Some(10u32));

        // total_supply == 1_000_000_0000000; 10% == 100_000_0000000
        // attempt to transfer 100_000_0000001 should exceed cap.
        client.transfer(&admin, &user, &100_000_0000000i128);
        assert_eq!(client.balance(&user), 100_000_0000000i128);
    }

    #[test]
    #[should_panic(expected = "max balance per account exceeded")]
    fn test_set_max_balance_per_account_transfer_exceeds_panics() {
        let (_, client, admin, user) = setup();

        client.set_max_balance_per_account(&Some(10u32));
        client.transfer(&admin, &user, &100_000_0000000i128);

        // one more token should exceed cap.
        client.transfer(&admin, &user, &1i128);
    }

    #[test]
    fn test_set_max_balance_per_account_enforces_on_mint() {
        let (_, client, _, user) = setup();

        client.set_max_balance_per_account(&Some(10u32));

        // mint up to cap succeeds
        client.mint(&user, &100_000_0000000i128);
        assert_eq!(client.balance(&user), 100_000_0000000i128);
    }

    #[test]
    // #[should_panic(expected = "max balance per account exceeded")]
    fn test_set_max_balance_per_account_mint_exceeds_panics() {
        let (_, client, _, user) = setup();

        client.set_max_balance_per_account(&Some(10u32));
        client.mint(&user, &100_000_0000000i128);

        // minting 1 more exceeds cap
        client.mint(&user, &1i128);
    }

    #[test]
    fn test_admin_recipient_exempt_from_max_balance_per_account() {
        let (_, client, admin, user) = setup();

        client.set_max_balance_per_account(&Some(1u32));

        // Transfer to admin should not be blocked even if it would exceed the cap.
        client.mint(&user, &10_000i128);
        client.transfer(&user, &admin, &10_000i128);
    }

    #[test]
    fn test_initialize_and_getters() {
        let (env, client, admin, _) = setup();
        assert_eq!(client.name(), String::from_str(&env, "TestToken"));
        assert_eq!(client.symbol(), String::from_str(&env, "TST"));
        assert_eq!(client.decimals(), 7u32);
        assert_eq!(client.admin(), admin.clone());
        assert_eq!(client.total_supply(), 1_000_000_0000000i128);
        assert_eq!(client.balance(&admin), 1_000_000_0000000i128);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_init_panics() {
        let (env, client, admin, _) = setup();
        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "Dup"),
            &String::from_str(&env, "DUP"),
            &0i128,
            &None,
            &false,
            &false,
            &None,
        );
    }

    #[test]
    fn test_mint() {
        let (_, client, admin, user) = setup();
        client.mint(&user, &500_0000000i128);
        assert_eq!(client.balance(&user), 500_0000000i128);
        assert_eq!(
            client.total_supply(),
            1_000_000_0000000i128 + 500_0000000i128
        );
        // admin balance unchanged
        assert_eq!(client.balance(&admin), 1_000_000_0000000i128);
    }

    #[test]
    fn test_burn() {
        let (_, client, admin, _) = setup();
        client.burn(&admin, &100_0000000i128);
        assert_eq!(
            client.balance(&admin),
            1_000_000_0000000i128 - 100_0000000i128
        );
        assert_eq!(
            client.total_supply(),
            1_000_000_0000000i128 - 100_0000000i128
        );
    }

    #[test]
    fn test_burn_self() {
        let (_, client, _, user) = setup();
        client.mint(&user, &1000i128);
        client.burn_self(&user, &500i128);
        assert_eq!(client.balance(&user), 500i128);
    }

    #[test]
    fn test_mint_batch() {
        let (env, client, _, _) = setup();
        let u1 = Address::generate(&env);
        let u2 = Address::generate(&env);

        let mut to = soroban_sdk::Vec::new(&env);
        to.push_back(u1.clone());
        to.push_back(u2.clone());

        let mut amounts = soroban_sdk::Vec::new(&env);
        amounts.push_back(100i128);
        amounts.push_back(200i128);

        client.mint_batch(&to, &amounts);

        assert_eq!(client.balance(&u1), 100i128);
        assert_eq!(client.balance(&u2), 200i128);
    }

    #[test]
    #[should_panic(expected = "mismatching lengths")]
    fn test_mint_batch_len_mismatch() {
        let (env, client, _, _) = setup();
        let u1 = Address::generate(&env);

        let mut to = soroban_sdk::Vec::new(&env);
        to.push_back(u1);

        let mut amounts = soroban_sdk::Vec::new(&env);
        amounts.push_back(100i128);
        amounts.push_back(200i128);

        client.mint_batch(&to, &amounts);
    }

    #[test]
    fn test_total_burned_starts_at_zero() {
        let (_, client, _, _) = setup();
        assert_eq!(client.total_burned(), 0i128);
    }

    #[test]
    fn test_total_burned_after_single_burn() {
        let (_, client, admin, _) = setup();
        client.burn(&admin, &100_0000000i128);
        assert_eq!(client.total_burned(), 100_0000000i128);
    }

    #[test]
    fn test_total_burned_after_two_burns() {
        let (_, client, admin, _) = setup();
        client.burn(&admin, &100_0000000i128);
        client.burn(&admin, &250_0000000i128);
        assert_eq!(client.total_burned(), 350_0000000i128);
    }

    #[test]
    fn test_burn_admin_updates_total_burned() {
        let (_, client, admin, user) = setup();
        client.transfer(&admin, &user, &100_0000000i128);

        client.burn_admin(&user, &40_0000000i128);

        assert_eq!(client.balance(&user), 60_0000000i128);
        assert_eq!(client.total_burned(), 40_0000000i128);
        assert_eq!(
            client.total_supply(),
            1_000_000_0000000i128 - 40_0000000i128
        );
    }

    #[test]
    fn test_burn_updates_total_burned_and_total_supply_each_time() {
        let (_, client, admin, _) = setup();

        client.burn(&admin, &100_0000000i128);
        assert_eq!(client.total_burned(), 100_0000000i128);
        assert_eq!(
            client.total_supply(),
            1_000_000_0000000i128 - 100_0000000i128
        );

        client.burn(&admin, &250_0000000i128);
        assert_eq!(client.total_burned(), 350_0000000i128);
        assert_eq!(
            client.total_supply(),
            1_000_000_0000000i128 - 350_0000000i128
        );
    }

    #[test]
    fn test_mint_does_not_change_total_burned() {
        let (_, client, admin, user) = setup();

        client.burn(&admin, &100_0000000i128);
        client.mint(&user, &25_0000000i128);

        assert_eq!(client.total_burned(), 100_0000000i128);
        assert_eq!(
            client.total_supply(),
            1_000_000_0000000i128 - 100_0000000i128 + 25_0000000i128
        );
    }

    #[test]
    #[should_panic(expected = "insufficient balance to burn")]
    fn test_burn_insufficient() {
        let (_, client, _, user) = setup();
        client.burn(&user, &1i128);
    }

    #[test]
    fn test_burn_self_reduces_balance_and_supply() {
        let (_, client, admin, user) = setup();
        // Admin sends some tokens to user, who then burns them themselves.
        client.transfer(&admin, &user, &500_0000000i128);
        let supply_before = client.total_supply();

        client.burn_self(&user, &200_0000000i128);

        assert_eq!(client.balance(&user), 300_0000000i128);
        assert_eq!(client.total_supply(), supply_before - 200_0000000i128);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_burn_self_rejects_zero() {
        let (_, client, _, user) = setup();
        client.burn_self(&user, &0i128);
    }

    #[test]
    #[should_panic(expected = "insufficient balance to burn")]
    fn test_burn_self_insufficient_balance() {
        let (_, client, _, user) = setup();
        // user has zero balance; should fail.
        client.burn_self(&user, &1i128);
    }

    #[test]
    #[should_panic(expected = "account is frozen")]
    fn test_burn_self_blocked_when_frozen() {
        let (_, client, admin, user) = setup();
        client.transfer(&admin, &user, &1_000i128);
        client.freeze_account(&user);
        client.burn_self(&user, &500i128);
    }

    #[test]
    fn test_transfer() {
        let (_, client, admin, user) = setup();
        client.transfer(&admin, &user, &250_0000000i128);
        assert_eq!(
            client.balance(&admin),
            1_000_000_0000000i128 - 250_0000000i128
        );
        assert_eq!(client.balance(&user), 250_0000000i128);
        // total supply unchanged
        assert_eq!(client.total_supply(), 1_000_000_0000000i128);
    }

    #[test]
    #[should_panic(expected = "insufficient balance")]
    fn test_transfer_insufficient() {
        let (_, client, _, user) = setup();
        client.transfer(&user, &user, &1i128);
    }

    #[test]
    fn test_approve_and_transfer_from() {
        let (env, client, admin, user) = setup();
        let spender = Address::generate(&env);

        client.approve(&admin, &spender, &100_0000000i128, &1000u32);
        assert_eq!(client.allowance(&admin, &spender), 100_0000000i128);

        client.transfer_from(&spender, &admin, &user, &60_0000000i128);
        assert_eq!(client.allowance(&admin, &spender), 40_0000000i128);
        assert_eq!(client.balance(&user), 60_0000000i128);
        assert_eq!(
            client.balance(&admin),
            1_000_000_0000000i128 - 60_0000000i128
        );
    }

    #[test]
    #[should_panic(expected = "insufficient allowance")]
    fn test_transfer_from_exceeds_allowance() {
        let (env, client, admin, user) = setup();
        let spender = Address::generate(&env);

        client.approve(&admin, &spender, &10i128, &1000u32);
        client.transfer_from(&spender, &admin, &user, &11i128);
    }

    #[test]
    fn test_propose_and_accept_admin() {
        let (_, client, _, user) = setup();
        client.propose_admin(&user);
        // Admin has not changed yet
        assert_ne!(client.admin(), user);
        client.accept_admin();
        assert_eq!(client.admin(), user);
    }

    #[test]
    #[should_panic(expected = "no pending admin")]
    fn test_accept_admin_without_proposal() {
        let (_, client, _, _) = setup();
        client.accept_admin();
    }

    #[test]
    fn test_propose_admin_overwrites_previous() {
        let (env, client, _, user) = setup();
        let other = Address::generate(&env);
        client.propose_admin(&user);
        client.propose_admin(&other);
        client.accept_admin();
        assert_eq!(client.admin(), other);
    }

    #[test]
    fn test_old_admin_retains_role_until_accepted() {
        let (_, client, admin, user) = setup();
        client.propose_admin(&user);
        // Admin can still mint before acceptance
        client.mint(&user, &1i128);
        assert_eq!(client.admin(), admin);
    }

    // ── Freeze / Unfreeze tests ─────────────────────────────────────────

    #[test]
    fn test_freeze_and_is_frozen() {
        let (_, client, _, user) = setup();
        assert!(!client.is_frozen(&user));
        client.freeze_account(&user);
        assert!(client.is_frozen(&user));
    }

    #[test]
    #[should_panic(expected = "account is frozen")]
    fn test_frozen_transfer_blocked() {
        let (_, client, admin, user) = setup();
        client.transfer(&admin, &user, &1000i128);
        client.freeze_account(&user);
        // This should panic because `user` is frozen.
        client.transfer(&user, &admin, &500i128);
    }

    #[test]
    #[should_panic(expected = "account is frozen")]
    fn test_frozen_transfer_from_blocked() {
        let (env, client, admin, user) = setup();
        let spender = Address::generate(&env);
        // Give user some tokens and approve spender.
        client.transfer(&admin, &user, &1000i128);
        client.approve(&user, &spender, &1000i128, &1000u32);
        // Freeze user, then attempt transfer_from.
        client.freeze_account(&user);
        client.transfer_from(&spender, &user, &admin, &500i128);
    }

    // ── Revoke admin / lock tests ───────────────────────────────────────

    #[test]
    fn test_revoke_admin_sets_locked_flag() {
        let (_, client, _, _) = setup();
        assert!(!client.is_locked());
        client.revoke_admin();
        assert!(client.is_locked());
    }

    #[test]
    #[should_panic(expected = "admin revoked")]
    fn test_admin_getter_after_revoke_panics() {
        let (_, client, _, _) = setup();
        client.revoke_admin();
        // Admin storage entry has been removed.
        let _ = client.admin();
    }

    #[test]
    #[should_panic(expected = "admin revoked: contract is locked")]
    fn test_mint_after_revoke_panics() {
        let (_, client, _, user) = setup();
        client.revoke_admin();
        client.mint(&user, &1i128);
    }

    #[test]
    #[should_panic(expected = "admin revoked: contract is locked")]
    fn test_burn_admin_after_revoke_panics() {
        let (_, client, admin, _) = setup();
        client.revoke_admin();
        client.burn_admin(&admin, &1i128);
    }

    #[test]
    #[should_panic(expected = "admin revoked: contract is locked")]
    fn test_propose_admin_after_revoke_panics() {
        let (env, client, _, _) = setup();
        let other = Address::generate(&env);
        client.revoke_admin();
        client.propose_admin(&other);
    }

    #[test]
    #[should_panic(expected = "admin revoked: contract is locked")]
    fn test_freeze_after_revoke_panics() {
        let (_, client, _, user) = setup();
        client.revoke_admin();
        client.freeze_account(&user);
    }

    #[test]
    fn test_holder_actions_still_work_after_revoke() {
        let (_, client, admin, user) = setup();
        // Move some tokens to the user before locking.
        client.transfer(&admin, &user, &1_000i128);
        client.revoke_admin();

        // Transfers, approvals and self-burn must still work.
        client.transfer(&user, &admin, &200i128);
        assert_eq!(client.balance(&user), 800i128);

        client.burn_self(&user, &100i128);
        assert_eq!(client.balance(&user), 700i128);
    }

    #[test]
    fn test_unfreeze_restores_transfer() {
        let (_, client, admin, user) = setup();
        client.transfer(&admin, &user, &1000i128);
        client.freeze_account(&user);
        assert!(client.is_frozen(&user));
        client.unfreeze_account(&user);
        assert!(!client.is_frozen(&user));
        // Transfer should now succeed.
        client.transfer(&user, &admin, &500i128);
        assert_eq!(client.balance(&user), 500i128);
    }

    #[test]
    #[should_panic]
    fn test_non_admin_cannot_freeze() {
        let env = Env::default();
        // Do NOT mock all auths — we want real auth checks.
        let contract_id = env.register_contract(None, TokenContract);
        let client = TokenContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "TestToken"),
            &String::from_str(&env, "TST"),
            &0i128,
            &None,
            &false,
            &false,
            &None,
        );

        // Remove mock — only user will auth, not admin.
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &user,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "freeze_account",
                args: (&user,).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        // Should panic — user is not admin.
        client.freeze_account(&user);
    }

    // ── Pause / Unpause tests ───────────────────────────────────────────

    #[test]
    fn test_pause_and_is_paused() {
        let (_, client, _, _) = setup();
        assert!(!client.is_paused());
        client.pause();
        assert!(client.is_paused());
        client.unpause();
        assert!(!client.is_paused());
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_paused_mint_blocked() {
        let (_, client, _, user) = setup();
        client.pause();
        client.mint(&user, &1000i128);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_paused_burn_blocked() {
        let (_, client, admin, _) = setup();
        client.pause();
        client.burn(&admin, &1000i128);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_paused_transfer_blocked() {
        let (_, client, admin, user) = setup();
        client.pause();
        client.transfer(&admin, &user, &1000i128);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_paused_transfer_from_blocked() {
        let (env, client, admin, user) = setup();
        let spender = Address::generate(&env);
        client.approve(&admin, &spender, &1000i128, &1000u32);
        client.pause();
        client.transfer_from(&spender, &admin, &user, &500i128);
    }

    #[test]
    fn test_unpause_restores_all_operations() {
        let (_, client, admin, user) = setup();
        client.pause();
        client.unpause();

        // All should succeed now
        client.mint(&user, &1000i128);
        client.burn(&user, &500i128);
        client.transfer(&admin, &user, &1000i128);

        assert_eq!(client.balance(&user), 1500i128);
    }

    #[test]
    fn test_read_only_works_while_paused() {
        let (_, client, admin, _) = setup();
        client.pause();

        // Read-only getters should still work
        assert_eq!(client.total_supply(), 1_000_000_0000000i128);
        assert_eq!(client.balance(&admin), 1_000_000_0000000i128);
        assert!(client.is_paused());
    }

    #[test]
    #[should_panic]
    fn test_non_admin_cannot_pause() {
        let env = Env::default();
        let contract_id = env.register_contract(None, TokenContract);
        let client = TokenContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "TestToken"),
            &String::from_str(&env, "TST"),
            &0i128,
            &None,
            &false,
            &false,
            &None,
        );

        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &user,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.pause();
    }

    // ── max_supply tests ────────────────────────────────────────────────
    fn setup_with_cap() -> (Env, TokenContractClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, TokenContract);
        let client = TokenContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "CappedToken"),
            &String::from_str(&env, "CAP"),
            &500_0000000i128,
            &Some(1_000_0000000i128),
            &false,
            &false,
            &None,
        );

        (env, client, admin, user)
    }

    #[test]
    fn test_max_supply_getter_none() {
        let (_, client, _, _) = setup();
        assert_eq!(client.max_supply(), None);
    }

    #[test]
    fn test_max_supply_getter_some() {
        let (_, client, _, _) = setup_with_cap();
        assert_eq!(client.max_supply(), Some(1_000_0000000i128));
    }

    #[test]
    fn test_mint_within_max_supply() {
        let (_, client, _, user) = setup_with_cap();
        client.mint(&user, &500_0000000i128);
        assert_eq!(client.total_supply(), 1_000_0000000i128);
    }

    #[test]
    #[should_panic(expected = "mint would exceed max_supply")]
    fn test_mint_exceeds_max_supply() {
        let (_, client, _, user) = setup_with_cap();
        client.mint(&user, &500_0000001i128);
    }

    #[test]
    fn test_mint_exact_max_supply() {
        let (_, client, _, user) = setup_with_cap();
        // Mint exactly to the cap boundary
        client.mint(&user, &500_0000000i128);
        assert_eq!(client.total_supply(), 1_000_0000000i128);
        assert_eq!(client.max_supply(), Some(1_000_0000000i128));
    }

    #[test]
    #[should_panic(expected = "initial_supply exceeds max_supply")]
    fn test_initial_supply_exceeds_max_supply() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, TokenContract);
        let client = TokenContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "Bad"),
            &String::from_str(&env, "BAD"),
            &2_000_0000000i128,
            &Some(1_000_0000000i128),
            &false,
            &false,
            &None,
        );
    }

    #[test]
    fn test_update_and_get_contract_uri() {
        let (env, client, _, _) = setup();
        let uri = String::from_str(&env, "https://example.com/token-metadata.json");
        client.update_contract_uri(&uri);
        assert_eq!(client.contract_uri(), uri);
    }

    #[test]
    fn test_update_contract_uri_overwrites() {
        let (env, client, _, _) = setup();
        let uri_a = String::from_str(&env, "https://example.com/a.json");
        let uri_b = String::from_str(&env, "https://example.com/b.json");
        client.update_contract_uri(&uri_a);
        client.update_contract_uri(&uri_b);
        assert_eq!(client.contract_uri(), uri_b);
    }

    #[test]
    #[should_panic(expected = "contract URI not set")]
    fn test_contract_uri_not_set() {
        let (_, client, _, _) = setup();
        client.contract_uri();
    }
    // ── Upgrade tests ───────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "invalid wasm hash")]
    fn test_upgrade_rejects_zero_hash() {
        let (env, client, _, _) = setup();
        let zero_hash = BytesN::from_array(&env, &[0; 32]);
        client.upgrade(&zero_hash);
    }

    #[test]
    #[should_panic]
    fn test_non_admin_cannot_upgrade() {
        let env = Env::default();
        let contract_id = env.register_contract(None, TokenContract);
        let client = TokenContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        env.mock_all_auths();
        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "TestToken"),
            &String::from_str(&env, "TST"),
            &0i128,
            &None,
            &false,
            &false,
            &None,
        );

        let non_zero_hash = BytesN::from_array(&env, &[1; 32]);
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &user,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "upgrade",
                args: (non_zero_hash.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client.upgrade(&non_zero_hash);
    }

    // ── Authorization flag tests ────────────────────────────────────────

    fn setup_with_auth_required() -> (Env, TokenContractClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, TokenContract);
        let client = TokenContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "RegToken"),
            &String::from_str(&env, "REG"),
            &1_000_0000000i128,
            &None,
            &true,
            &true,
            &None,
        );

        (env, client, admin, user)
    }

    #[test]
    fn test_authorization_required_flag_stored() {
        let (_, client, _, _) = setup_with_auth_required();
        assert!(client.authorization_required());
        assert!(client.authorization_revocable());
    }

    #[test]
    fn test_authorization_flags_false_by_default() {
        let (_, client, _, _) = setup();
        assert!(!client.authorization_required());
        assert!(!client.authorization_revocable());
    }

    #[test]
    fn test_admin_auto_authorized_on_init() {
        let (_, client, admin, _) = setup_with_auth_required();
        assert!(client.is_authorized(&admin));
    }

    #[test]
    fn test_unauthorized_holder_not_authorized() {
        let (_, client, _, user) = setup_with_auth_required();
        assert!(!client.is_authorized(&user));
    }

    #[test]
    #[should_panic(expected = "recipient is not authorized to hold this token")]
    fn test_transfer_to_unauthorized_blocked() {
        let (_, client, admin, user) = setup_with_auth_required();
        client.transfer(&admin, &user, &100_0000000i128);
    }

    #[test]
    fn test_transfer_to_authorized_succeeds() {
        let (_, client, admin, user) = setup_with_auth_required();
        client.authorize_holder(&user);
        assert!(client.is_authorized(&user));
        client.transfer(&admin, &user, &100_0000000i128);
        assert_eq!(client.balance(&user), 100_0000000i128);
    }

    #[test]
    fn test_revoke_authorization_blocks_transfer() {
        let (_, client, admin, user) = setup_with_auth_required();
        client.authorize_holder(&user);
        client.transfer(&admin, &user, &100_0000000i128);
        client.revoke_authorization(&user);
        assert!(!client.is_authorized(&user));
    }

    #[test]
    #[should_panic(expected = "authorization is not revocable for this token")]
    fn test_revoke_fails_when_not_revocable() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, TokenContract);
        let client = TokenContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "ReqOnly"),
            &String::from_str(&env, "ROT"),
            &0i128,
            &None,
            &true,
            &false, // revocable = false
            &None,
        );

        client.authorize_holder(&user);
        client.revoke_authorization(&user);
    }

    #[test]
    #[should_panic(expected = "recipient is not authorized to hold this token")]
    fn test_mint_to_unauthorized_blocked() {
        let (_, client, _, user) = setup_with_auth_required();
        client.mint(&user, &1000i128);
    }

    #[test]
    fn test_mint_to_authorized_succeeds() {
        let (_, client, _, user) = setup_with_auth_required();
        client.authorize_holder(&user);
        client.mint(&user, &1000i128);
        assert_eq!(client.balance(&user), 1000i128);
    }

    // ── approve expiration tests ────────────────────────────────────────

    #[test]
    #[should_panic(expected = "expiration_ledger must be in the future")]
    fn test_approve_expired_ledger_panics() {
        let (env, client, admin, _) = setup();
        let spender = Address::generate(&env);
        // Ledger sequence is 0 by default; expiration_ledger = 0 is NOT in the future.
        client.approve(&admin, &spender, &100i128, &0u32);
    }

    #[test]
    fn test_approve_respects_expiration_ledger() {
        let (env, client, admin, _) = setup();
        let spender = Address::generate(&env);
        // Supply a valid future expiration; the allowance should be stored correctly.
        client.approve(&admin, &spender, &500i128, &100u32);
        assert_eq!(client.allowance(&admin, &spender), 500i128);
    }

    #[test]
    fn test_set_and_remove_compliance_node() {
        let (env, client, _, _) = setup();
        let node = Address::generate(&env);

        client.set_compliance_node(&Some(node.clone()));
        assert_eq!(client.compliance_node(), Some(node.clone()));

        client.set_compliance_node(&None);
        assert_eq!(client.compliance_node(), None);
    }

    #[test]
    fn test_freeze_unfreeze_events() {
        let (env, client, _admin, user) = setup();

        client.freeze_account(&user);
        let events = env.events().all();
        let last_event = events.slice(events.len() - 1..);

        // Verify freeze event
        assert_eq!(
            last_event,
            soroban_sdk::vec![
                &env,
                (
                    client.address.clone(),
                    (symbol_short!("freeze"), user.clone()).into_val(&env),
                    ().into_val(&env)
                )
            ]
        );

        client.unfreeze_account(&user);
        let events = env.events().all();
        let last_event = events.slice(events.len() - 1..);

        // Verify unfreeze event
        assert_eq!(
            last_event,
            soroban_sdk::vec![
                &env,
                (
                    client.address.clone(),
                    (symbol_short!("unfreeze"), user.clone()).into_val(&env),
                    ().into_val(&env)
                )
            ]
        );
    }
}
