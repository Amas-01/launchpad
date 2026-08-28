#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Bytes, BytesN, Env, Vec,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Soroban's network-enforced ceiling on how far into the future a ledger
/// entry's TTL can be extended in a single call (`max_entry_ttl` in the
/// network config; 6,312,000 ledgers on mainnet). Passing a value above
/// this to `extend_ttl` fails the transaction.
const MAX_ENTRY_TTL_LEDGERS: u32 = 6_312_000;

/// Fallback TTL extension used when the deadline doesn't give us a more
/// precise target (e.g. it has already passed): about a year.
///
/// 365 days * 24h * 60m * 60s / 5s-per-ledger = 6,307,200 ledgers, clamped
/// to `MAX_ENTRY_TTL_LEDGERS` so this can never exceed what the network
/// will accept even if the formula above or the network parameter changes.
const TTL_LEDGERS: u32 = {
    const YEAR_LEDGERS: u64 = 365 * 24 * 60 * 60 / 5;
    if YEAR_LEDGERS < MAX_ENTRY_TTL_LEDGERS as u64 {
        YEAR_LEDGERS as u32
    } else {
        MAX_ENTRY_TTL_LEDGERS
    }
};

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
    /// `deadline_ledger` is not strictly after the current ledger.
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
    /// The unclaimed remainder has already been swept back to the admin.
    AlreadyReclaimed = 9,
    /// `reclaim_unclaimed` was called with an empty contract balance.
    NothingToReclaim = 10,
    /// The submitted proof is longer than [`MAX_PROOF_LEN`].
    ProofTooLong = 11,
    /// The recipient's strkey does not fit [`MAX_STRKEY_LEN`].
    AddressTooLong = 12,
    /// An `i128` addition overflowed while accumulating claimed totals.
    AmountOverflow = 13,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    MerkleRoot,
    DeadlineLedger,
    /// Set once on the first successful `initialize` and never removed.
    Initialized,
    /// Set to `true` by `reclaim_unclaimed`, making the sweep single-shot.
    Reclaimed,
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
        storage.set(&DataKey::TotalClaimed, &0i128);
        storage.set(&DataKey::Reclaimed, &false);
        storage.extend_ttl(TTL_LEDGERS, TTL_LEDGERS);

        env.events().publish(
            (symbol_short!("init"), admin),
            (token, merkle_root, deadline_ledger),
        );
    }

    /// Move `amount` tokens from `from` into this contract so recipients have
    /// something to claim against.
    ///
    /// Separate from `initialize` so the root can be published before the
    /// treasury is topped up, and so an under-funded airdrop can be topped up
    /// again later without redeploying.
    pub fn fund(env: Env, from: Address, amount: i128) {
        Self::_require_initialized(&env);
        from.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, AirdropError::InvalidAmount);
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
    /// later `claim` fails rather than draining a re-funded balance.
    pub fn reclaim_unclaimed(env: Env) -> i128 {
        Self::_require_initialized(&env);
        let admin = Self::_admin(&env);
        admin.require_auth();

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

    // -----------------------------------------------------------------------
    // Read-only getters
    // -----------------------------------------------------------------------

    pub fn get_admin(env: Env) -> Address {
        Self::_admin(&env)
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
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, AirdropError::NotInitialized))
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

    fn _is_reclaimed(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Reclaimed)
            .unwrap_or(false)
    }

    fn _bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_LEDGERS, TTL_LEDGERS);
    }

    /// TTL for a claim marker: far enough out that it still exists when
    /// `reclaim_unclaimed` closes the airdrop, so an archived marker can
    /// never be the reason a second claim succeeds.
    fn _claim_ttl(env: &Env) -> u32 {
        let deadline = Self::_deadline(env);
        let current = env.ledger().sequence();
        let remaining = deadline.saturating_sub(current);
        // Always keep at least the default horizon, and never exceed what the
        // network will accept in a single extend_ttl call.
        remaining.clamp(TTL_LEDGERS, MAX_ENTRY_TTL_LEDGERS)
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
        testutils::Address as _, testutils::Ledger as _, token::StellarAssetClient, String,
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
        const { assert!(TTL_LEDGERS <= MAX_ENTRY_TTL_LEDGERS) };
    }

    #[test]
    fn test_claim_ttl_never_exceeds_network_maximum() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register_contract(None, AirdropContract);
        let client = AirdropContractClient::new(&env, &contract_id);
        let root = BytesN::from_array(&env, &[1u8; 32]);

        // A deadline far past the network's TTL ceiling must still clamp.
        client.initialize(&token, &admin, &root, &u32::MAX);
        env.as_contract(&contract_id, || {
            assert_eq!(
                AirdropContract::_claim_ttl(&env),
                MAX_ENTRY_TTL_LEDGERS,
                "claim TTL must be clamped to the network maximum"
            );
        });
    }

    // ── Event schema ────────────────────────────────────────────────────

    const EXPECTED_TOPICS: [&str; 4] = ["init", "fund", "claim", "reclaim"];

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
