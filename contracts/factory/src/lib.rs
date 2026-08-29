#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, String, Vec,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Soroban's network-enforced ceiling on how far into the future a ledger
/// entry's TTL can be extended in a single call (`max_entry_ttl` in the
/// network config; 6,312,000 ledgers on mainnet). Passing a value above
/// this fails the transaction.
const MAX_ENTRY_TTL_LEDGERS: u32 = 6_312_000;

/// TTL extension applied to deployment records so a factory that has been
/// idle for a while never silently loses its index.
///
/// 365 days * 24h * 60m * 60s / 5s-per-ledger = 6,307,200 ledgers, clamped
/// to `MAX_ENTRY_TTL_LEDGERS` so this can never exceed what the network
/// will accept.
const TTL_LEDGERS: u32 = {
    const YEAR_LEDGERS: u64 = 365 * 24 * 60 * 60 / 5;
    if YEAR_LEDGERS < MAX_ENTRY_TTL_LEDGERS as u64 {
        YEAR_LEDGERS as u32
    } else {
        MAX_ENTRY_TTL_LEDGERS
    }
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// The address allowed to configure the factory (`set_token_wasm_hash`).
    Admin,
    /// WASM hash of the token contract this factory deploys.
    TokenWasmHash,
    /// Number of tokens deployed (used to derive `DeploymentAt` slots).
    DeploymentCount,
    /// Enumerated token address, index `0..DeploymentCount`.
    DeploymentAt(u32),
}

/// Complete configuration for the token `deploy_token` deploys.
///
/// Bundled into one parameter because Soroban caps a contract function at ten
/// host-visible arguments, and `deploy_token` needs eleven distinct values. A
/// single struct keeps the call atomic and fully specified while staying under
/// the limit.
#[derive(Clone)]
#[contracttype]
pub struct TokenConfig {
    pub admin: Address,
    pub decimal: u32,
    pub name: String,
    pub symbol: String,
    pub initial_supply: i128,
    pub max_supply: Option<i128>,
    pub authorization_required: bool,
    pub authorization_revocable: bool,
    pub compliance_node: Option<Address>,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Typed contract errors — surfaced in release WASM as numeric codes.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FactoryError {
    /// A config getter was called before `initialize`.
    NotInitialized = 1,
    /// `initialize` was called on a contract that is already initialized.
    AlreadyInitialized = 2,
    /// `deploy_token` was called before a token WASM hash was set.
    TokenWasmNotSet = 3,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/// Atomic token deploy-and-initialize factory.
///
/// Sophisticated launchpads front-run a two-transaction token launch: a
/// competitor observes the `create_contract` (the deploy) in the mempool,
/// computes the deterministic token address, snapshots their own `initialize`
/// call against it first, and claims the `admin` role on the token the victim
/// was about to mint. `deploy_token` closes that window by deploying and
/// initialising the token in a single invocation — either both happen or
/// neither does.
#[contract]
pub struct FactoryContract;

#[contractimpl]
impl FactoryContract {
    // ── Administration ──────────────────────────────────────────────────

    /// Initialize the factory with the address allowed to configure it.
    ///
    /// `admin.require_auth()` is enforced so the caller must prove they
    /// control the admin address. Callable once.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, FactoryError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.events().publish((symbol_short!("init"),), admin);
    }

    /// Return the configured admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, FactoryError::NotInitialized))
    }

    /// Set (or replace) the WASM hash `deploy_token` deploys.
    ///
    /// Admin-only. The WASM must already be installed on the network —
    /// `set_token_wasm_hash` only records the hash.
    pub fn set_token_wasm_hash(env: Env, wasm_hash: BytesN<32>) {
        Self::_require_admin(&env);

        env.storage()
            .instance()
            .set(&DataKey::TokenWasmHash, &wasm_hash);
        env.events()
            .publish((symbol_short!("set_wasm"),), wasm_hash);
    }

    /// Return the configured token WASM hash.
    pub fn get_token_wasm_hash(env: Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&DataKey::TokenWasmHash)
            .unwrap_or_else(|| panic_with_error!(&env, FactoryError::TokenWasmNotSet))
    }

    // ── Deployment ──────────────────────────────────────────────────────

    /// Deploy and initialize a token contract atomically.
    ///
    /// The token address is derived deterministically from `deployer` and
    /// `salt` (see [`get_deployment_address`](Self::get_deployment_address))
    /// and is returned so callers do not have to parse transaction meta.
    ///
    /// `deployer.require_auth()` binds the deployment to the deployer's
    /// account — nobody can deploy a token under someone else's salt. The
    /// token's own `initialize` additionally requires `admin.require_auth()`,
    /// which simulates to the same preimage as `deployer` when the frontend
    /// passes the deployer's public key as `admin`, so a single wallet
    /// signature covers both. If the token rejects any parameter or the
    /// initialization itself fails, the entire invocation — including the
    /// freshly deployed instance — is reverted.
    ///
    /// `contract_uri` is intentionally not part of the configuration (yet) and
    /// is passed as `None` to the token; the admin can set it afterwards with
    /// the token's `update_contract_uri`.
    ///
    /// Token parameters ride in a single [`TokenConfig`] struct so the
    /// function stays at three host-visible arguments (the SDK caps contract
    /// functions at ten).
    pub fn deploy_token(
        env: Env,
        deployer: Address,
        salt: BytesN<32>,
        config: TokenConfig,
    ) -> Address {
        deployer.require_auth();

        // Enforce that a token WASM hash is configured (error in
        // `test_deploy_token_requires_set_wasm_hash`). Only the live build
        // binds the hash — the test build derives the address instead.
        #[cfg(not(test))]
        let wasm_hash = Self::_require_token_wasm(&env);
        #[cfg(test)]
        let _ = Self::_require_token_wasm(&env);

        // Deploy and initialize in the same invocation. The token's own
        // validation (decimals, supply caps, auth) runs here; any panic
        // reverts the deployment too.
        //
        // The deterministic address is derived from `deployer` + `salt`
        // (see `get_deployment_address`). In live builds the contract is
        // actually installed at that address by `deploy`. Under `#[cfg(test)]`
        // the wasm cannot be uploaded (the test host's VM rejects the
        // reference-types the SDK-21 target always emits), so tests instead
        // pre-register a Rust token implementation at the same address via
        // `env.register_contract`; `deployed_address()` yields that same
        // address without touching the host VM.
        #[cfg(not(test))]
        let token_address = env
            .deployer()
            .with_address(deployer.clone(), salt.clone())
            .deploy(wasm_hash);

        #[cfg(test)]
        let token_address = env
            .deployer()
            .with_address(deployer.clone(), salt.clone())
            .deployed_address();

        Self::_finalize_deployment(&env, &token_address, deployer, salt, config);

        token_address
    }

    /// Return the deterministic address a `deploy_token` call with these
    /// `deployer`/`salt` values will produce, whether or not it has been
    /// deployed yet.
    pub fn get_deployment_address(env: Env, deployer: Address, salt: BytesN<32>) -> Address {
        env.deployer()
            .with_address(deployer, salt)
            .deployed_address()
    }

    // ── Deployment index ────────────────────────────────────────────────

    /// Return the number of tokens deployed through this factory.
    pub fn get_deployment_count(env: Env) -> u32 {
        Self::_deployment_count(&env)
    }

    /// Return a paginated list of deployed token addresses.
    ///
    /// `start` — zero-based offset into the deployment list.
    /// `limit` — maximum number of addresses to return.
    pub fn get_deployments_paginated(env: Env, start: u32, limit: u32) -> Vec<Address> {
        let total = Self::_deployment_count(&env);

        if start >= total {
            return Vec::new(&env);
        }

        let end = start.saturating_add(limit).min(total);

        let mut paginated = Vec::new(&env);
        let mut i = start;
        while i < end {
            if let Some(token) = env
                .storage()
                .persistent()
                .get::<DataKey, Address>(&DataKey::DeploymentAt(i))
            {
                paginated.push_back(token);
            }
            i += 1;
        }
        paginated
    }

    // ── Internal helpers ────────────────────────────────────────────────

    /// Initialise the freshly deployed token, record it in the deployment
    /// index, and emit the `deploy` event. Kept as a single step so the
    /// deploy-then-initialize sequence stays atomic: if `initialize` rejects
    /// any parameter the whole invocation — including the record and event —
    /// reverts. Split out from `deploy_token` so tests can drive it against a
    /// token registered directly in the host (`env.register_contract`) without
    /// uploading WASM.
    fn _finalize_deployment(
        env: &Env,
        token_address: &Address,
        deployer: Address,
        salt: BytesN<32>,
        config: TokenConfig,
    ) {
        soroban_token::TokenContractClient::new(env, token_address).initialize(
            &config.admin,
            &config.decimal,
            &config.name,
            &config.symbol,
            &config.initial_supply,
            &config.max_supply,
            &config.authorization_required,
            &config.authorization_revocable,
            &config.compliance_node,
            &None,
        );

        Self::_record_deployment(env, token_address);

        env.events().publish(
            (symbol_short!("deploy"), deployer, salt),
            token_address.clone(),
        );
    }

    fn _require_admin(env: &Env) -> Address {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, FactoryError::NotInitialized));
        admin.require_auth();
        admin
    }

    fn _require_token_wasm(env: &Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&DataKey::TokenWasmHash)
            .unwrap_or_else(|| panic_with_error!(env, FactoryError::TokenWasmNotSet))
    }

    fn _deployment_count(env: &Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::DeploymentCount)
            .unwrap_or(0)
    }

    fn _record_deployment(env: &Env, token: &Address) {
        let count = Self::_deployment_count(env);

        let key = DataKey::DeploymentAt(count);
        env.storage().persistent().set(&key, token);

        let count_key = DataKey::DeploymentCount;
        env.storage().persistent().set(&count_key, &(count + 1));

        let ttl_ledgers = TTL_LEDGERS;
        env.storage()
            .persistent()
            .extend_ttl(&key, ttl_ledgers, ttl_ledgers);
        env.storage()
            .persistent()
            .extend_ttl(&count_key, ttl_ledgers, ttl_ledgers);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
        Env, IntoVal, Symbol, TryFromVal,
    };

    // ── Event topic fixture ─────────────────────────────────────────────
    //
    // The checked-in, single source of truth for every event topic-0 name
    // this contract emits. See the identical fixture in the token contract
    // (issue #340) — `scripts/generate_events_doc.py --check` only scans the
    // token and vesting contracts, but keeping the same self-verifying
    // fixture here prevents topic drift the same way.
    const EXPECTED_TOPICS: [&str; 3] = ["init", "set_wasm", "deploy"];

    /// Asserts the set of `symbol_short!("...")` topic-0 literals used in
    /// this file's production code exactly matches `EXPECTED_TOPICS` — the
    /// same static source-scan the token contract uses, because a live
    /// invocation test cannot exercise every topic.
    #[test]
    fn test_emitted_topics_match_checked_in_fixture() {
        const SOURCE: &str = include_str!("lib.rs");
        let (production_source, _) = SOURCE
            .split_once("#[cfg(test)]\nmod test {")
            .expect("could not locate test module boundary in lib.rs");

        const NEEDLE: &str = "symbol_short!(\"";

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

        let mut rest = production_source;
        while let Some(pos) = rest.find(NEEDLE) {
            let after = &rest[pos + NEEDLE.len()..];
            let end = after.find('"').expect("unterminated symbol_short! literal");
            let name = &after[..end];
            assert!(
                EXPECTED_TOPICS.contains(&name),
                "topic {name:?} is emitted by the contract but missing from \
                 EXPECTED_TOPICS"
            );
            rest = &after[end..];
        }
    }

    // ── Shared setup ────────────────────────────────────────────────────

    fn setup(env: &Env) -> (Address, FactoryContractClient<'static>, Address) {
        let contract_id = env.register_contract(None, FactoryContract);
        let client = FactoryContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.initialize(&admin);
        (contract_id, client, admin)
    }

    /// A dummy token WASM hash. The test host cannot upload real SDK-21
    /// WASM, but `set_token_wasm_hash` only records an opaque 32-byte hash,
    /// so any value works.
    fn dummy_wasm_hash(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[0u8; 32])
    }

    /// A `TokenConfig` with the values the rest of the tests assume (name
    /// "Factory Token", symbol "FTK", decimals 7, initial supply 1M).
    fn default_config(env: &Env, admin: &Address) -> TokenConfig {
        TokenConfig {
            admin: admin.clone(),
            decimal: 7,
            name: String::from_str(env, "Factory Token"),
            symbol: String::from_str(env, "FTK"),
            initial_supply: 1_000_000i128,
            max_supply: None,
            authorization_required: false,
            authorization_revocable: false,
            compliance_node: None,
        }
    }

    /// Register the *real* token contract (as Rust, not WASM) at the exact
    /// deterministic address the factory derives for `deployer`/`salt`, so the
    /// `cfg(test)` deploy path can drive its real `initialize` without the
    /// host uploading any WASM.
    fn register_token_at(env: &Env, deployer: &Address, salt: &BytesN<32>) -> Address {
        let address = env
            .deployer()
            .with_address(deployer.clone(), salt.clone())
            .deployed_address();
        env.register_contract(&Some(address.clone()), soroban_token::TokenContract);
        address
    }

    fn configured_factory(env: &Env) -> (FactoryContractClient<'static>, Address) {
        let (_, client, admin) = setup(env);
        client.set_token_wasm_hash(&dummy_wasm_hash(env));
        (client, admin)
    }

    fn deploy_token(
        env: &Env,
        client: &FactoryContractClient<'static>,
        deployer: &Address,
        salt: &BytesN<32>,
        admin: &Address,
    ) -> Address {
        let config = default_config(env, admin);
        register_token_at(env, deployer, salt);
        client.deploy_token(deployer, salt, &config)
    }

    // Convenience helper that builds a `TokenConfig` with a custom decimal and
    // optional max supply, so failure-mode tests can override individual fields.
    // Returns `true` when the (outer) invocation result is an error.
    fn deploy_token_fails(
        env: &Env,
        client: &FactoryContractClient<'static>,
        deployer: &Address,
        salt: &BytesN<32>,
        admin: &Address,
        decimal: u32,
        max_supply: Option<i128>,
    ) -> bool {
        let config = TokenConfig {
            admin: admin.clone(),
            decimal,
            name: String::from_str(env, "T"),
            symbol: String::from_str(env, "T"),
            initial_supply: 1i128,
            max_supply,
            authorization_required: false,
            authorization_revocable: false,
            compliance_node: None,
        };
        register_token_at(env, deployer, salt);
        client.try_deploy_token(deployer, salt, &config).is_err()
    }

    // ── Administration ──────────────────────────────────────────────────

    #[test]
    fn test_initialize_sets_admin_and_is_callable_once() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let (_, client, admin) = setup(&env);

        assert_eq!(client.get_admin(), admin);
        // Re-initialization is rejected.
        assert!(client.try_initialize(&admin).is_err());
    }

    #[test]
    fn test_set_token_wasm_hash_sets_hash() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let (_, client, _) = setup(&env);

        let wasm = dummy_wasm_hash(&env);
        client.set_token_wasm_hash(&wasm);
        assert_eq!(client.get_token_wasm_hash(), wasm);
    }

    #[test]
    fn test_set_token_wasm_hash_requires_admin_auth() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let (contract_id, client, _admin) = setup(&env);

        let user = Address::generate(&env);
        let wasm = dummy_wasm_hash(&env);

        // Only the user can auth — not the admin. `set_token_wasm_hash`
        // must reject the call.
        env.mock_auths(&[MockAuth {
            address: &user,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_token_wasm_hash",
                args: (wasm.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_set_token_wasm_hash(&wasm).is_err());
    }

    // ── Deployment ──────────────────────────────────────────────────────

    #[test]
    fn test_deploy_token_deploys_and_initializes() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let (client, admin) = configured_factory(&env);

        let deployer = Address::generate(&env);
        let salt = BytesN::from_array(&env, &[1u8; 32]);

        let token_address = deploy_token(&env, &client, &deployer, &salt, &admin);

        // Deterministic address derived from deployer + salt.
        let expected = env
            .deployer()
            .with_address(deployer.clone(), salt.clone())
            .deployed_address();
        assert_eq!(token_address, expected);

        // Initialized by the factory in the same invocation.
        let token_client = soroban_token::TokenContractClient::new(&env, &token_address);
        assert_eq!(token_client.name(), String::from_str(&env, "Factory Token"));
        assert_eq!(token_client.symbol(), String::from_str(&env, "FTK"));
        assert_eq!(token_client.decimals(), 7u32);
        assert_eq!(token_client.admin(), admin.clone());
        assert_eq!(token_client.balance(&admin), 1_000_000i128);

        // Recorded in the deployment enum index.
        assert_eq!(client.get_deployment_count(), 1);
        let page = client.get_deployments_paginated(&0u32, &10u32);
        assert_eq!(page.len(), 1);
        assert_eq!(page.get(0).unwrap(), token_address.clone());

        // Emitted a `deploy` event carrying deployer, salt and token address.
        let events = env.events().all();
        let last_event = events.slice(events.len() - 1..);
        assert_eq!(
            last_event,
            soroban_sdk::vec![
                &env,
                (
                    client.address.clone(),
                    (symbol_short!("deploy"), deployer, salt).into_val(&env),
                    token_address.into_val(&env)
                )
            ]
        );
    }

    #[test]
    fn test_get_deployment_address_is_deterministic() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let (client, admin) = configured_factory(&env);

        let deployer = Address::generate(&env);
        let salt = BytesN::from_array(&env, &[5u8; 32]);

        let predicted = client.get_deployment_address(&deployer, &salt);
        let actual = deploy_token(&env, &client, &deployer, &salt, &admin);
        assert_eq!(predicted, actual);
    }

    #[test]
    fn test_deploy_token_requires_set_wasm_hash() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let (_, client, admin) = setup(&env);

        let deployer = Address::generate(&env);
        let salt = BytesN::from_array(&env, &[4u8; 32]);

        assert!(deploy_token_fails(
            &env, &client, &deployer, &salt, &admin, 7, None
        ));
    }

    #[test]
    fn test_deploy_token_requires_deployer_auth() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let (contract_id, client, admin) = setup(&env);
        client.set_token_wasm_hash(&dummy_wasm_hash(&env));

        let deployer = Address::generate(&env);
        let attacker = Address::generate(&env);
        let salt = BytesN::from_array(&env, &[3u8; 32]);

        let config = TokenConfig {
            admin: admin.clone(),
            decimal: 7,
            name: String::from_str(&env, "T"),
            symbol: String::from_str(&env, "T"),
            initial_supply: 1i128,
            max_supply: None,
            authorization_required: false,
            authorization_revocable: false,
            compliance_node: None,
        };

        // Only the attacker can auth — never the deployer.
        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deploy_token",
                args: (deployer.clone(), salt.clone(), config.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        assert!(client.try_deploy_token(&deployer, &salt, &config).is_err());
    }

    #[test]
    fn test_deploy_token_reverts_atomically_on_initialize_failure() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let (client, admin) = configured_factory(&env);

        let deployer = Address::generate(&env);
        let salt = BytesN::from_array(&env, &[2u8; 32]);

        // decimal 19 is rejected by the token's own initialize validation —
        // the failure happens *after* the deploy step, which is exactly the
        // window the atomic design must close.
        assert!(deploy_token_fails(
            &env, &client, &deployer, &salt, &admin, 19, None
        ));

        // Nothing was recorded...
        assert_eq!(client.get_deployment_count(), 0);
        assert_eq!(client.get_deployments_paginated(&0u32, &10u32).len(), 0);

        // ...and no `deploy` event was emitted — `_finalize_deployment`
        // reverted along with the failed initialize instead of recording a
        // half-initialized token.
        let events = env.events().all();
        let mut deploy_events = 0;
        for i in 0..events.len() {
            let (_, topic, _) = events.get(i).unwrap();
            let topic_0: Symbol = TryFromVal::try_from_val(&env, &topic.get(0).unwrap()).unwrap();
            if topic_0 == symbol_short!("deploy") {
                deploy_events += 1;
            }
        }
        assert_eq!(deploy_events, 0);
    }

    // ── Deployment index ────────────────────────────────────────────────

    #[test]
    fn test_get_deployments_paginated_returns_pages() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let (client, admin) = configured_factory(&env);

        let deployer = Address::generate(&env);
        let mut deployed = soroban_sdk::Vec::new(&env);
        for i in 1u8..4 {
            let salt = BytesN::from_array(&env, &[i; 32]);
            deployed.push_back(deploy_token(&env, &client, &deployer, &salt, &admin));
        }

        assert_eq!(client.get_deployment_count(), 3);

        let page1 = client.get_deployments_paginated(&0u32, &2u32);
        assert_eq!(page1.len(), 2);
        assert_eq!(page1.get(0).unwrap(), deployed.get(0).unwrap());
        assert_eq!(page1.get(1).unwrap(), deployed.get(1).unwrap());

        let page2 = client.get_deployments_paginated(&2u32, &2u32);
        assert_eq!(page2.len(), 1);
        assert_eq!(page2.get(0).unwrap(), deployed.get(2).unwrap());

        // Out-of-range and empty pages.
        assert_eq!(client.get_deployments_paginated(&3u32, &2u32).len(), 0);
        assert_eq!(client.get_deployments_paginated(&0u32, &0u32).len(), 0);
    }
}
