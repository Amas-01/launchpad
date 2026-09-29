# Product Requirements Document
## Soroban Token Launchpad

**Version:** 1.0  
**Status:** Draft  
**Last Updated:** February 2026

---

## 1. Problem Statement

Deploying a token on Stellar's Soroban requires deep knowledge of Rust, the Soroban SDK, and CLI tooling. There is no open-source, no-code UI that lets a founder, DAO, or developer launch a production-ready SEP-41 token with vesting and admin controls — without writing smart contract code themselves.

---

## 2. Goal

Build an open-source, full-stack launchpad that abstracts Soroban contract complexity behind a clean UI. A user should go from zero to a deployed, customized token in under 10 minutes.

---

## 3. Target Users

| User | Need |
|---|---|
| Founders / Project teams | Launch a token with team allocations and vesting |
| DAOs | Deploy governance tokens with controlled supply |
| Developers | Reference implementation of SEP-41 + vesting on Soroban |

---

## 4. Scope

### In Scope (v1.0)
- SEP-41 compliant token contract deployment via UI
- Configurable: name, symbol, decimals, initial supply, optional max supply cap
- Admin controls: mint, burn, freeze, transfer admin
- Vesting module: cliff + linear vesting per wallet address
- Dashboard: total supply, circulating supply, holder list, vesting progress
- Freighter wallet integration
- Testnet and Mainnet support

### Out of Scope (v1.0)
- DEX / swap integration (SoroPad is a token deployer, not a market: no pool is seeded at launch; users trade via an external DEX)
- Governance voting module
- Multi-token management (single token per session)
- NFT support
- Mobile wallet support

---

## 5. User Stories

**Token Creator**
- I want to fill out a form with my token's name, symbol, supply, and decimals so I can deploy it without writing code.
- I want to set an admin wallet so I retain control over mint/burn operations after deployment.
- I want to optionally cap the total supply so my token has a hard maximum.

**Treasury Manager**
- I want to configure vesting schedules (cliff + linear period) per wallet so token unlocks are automated.
- I want to see a vesting timeline for each allocation so I can track unlock events.
- I want to mint to a specific address as long as max supply hasn't been reached.

**Developer / Contributor**
- I want documented contract interfaces so I can build integrations on top of deployed tokens.
- I want a local testnet setup script so I can test the full flow without spending real XLM.

---

## 6. Functional Requirements

### 6.1 Token Deployment Flow
1. User connects Freighter wallet
2. User fills token config form: name, symbol, decimals, initial supply, max supply (optional), admin address
3. App builds and submits contract deployment transaction via Soroban RPC
4. On success, user is redirected to the token dashboard with the deployed contract ID

### 6.2 Token Contract (SEP-41 Interface)
- `initialize(admin, decimal, name, symbol, initial_supply, max_supply?)`
- `mint(to, amount)` — admin only
- `burn(from, amount)` — admin only
- `transfer(from, to, amount)`
- `transfer_from(spender, from, to, amount)`
- `approve(from, spender, amount, expiration_ledger)`
- `allowance(from, spender) → i128`
- `balance(id) → i128`
- `set_admin(new_admin)` — admin only
- `admin() → Address`
- `decimals() → u32`
- `name() → String`
- `symbol() → String`
- `total_supply() → i128`
- `max_supply() → Option<i128>`

### 6.3 Vesting Contract Interface
- `create_schedule(recipient, total_amount, cliff_ledger, end_ledger)` — admin only
- `release(recipient)` — callable by anyone; transfers unlocked tokens to recipient
- `revoke(recipient)` — admin only; reclaims unvested tokens
- `vested_amount(recipient) → i128`
- `released_amount(recipient) → i128`
- `get_schedule(recipient) → VestingSchedule`

### 6.4 Frontend Dashboard
- Token summary: name, symbol, contract ID, decimals, admin address
- Supply metrics: total supply, circulating supply, amount burned
- Holder table: address, balance, % of supply (via Horizon API)
- Vesting panel: schedules with progress bars and next unlock date
- Admin panel: mint form, burn form, transfer admin form (gated to admin wallet)

---

## 7. Non-Functional Requirements

- **Performance:** Dashboard loads in under 2s on testnet RPC
- **Accessibility:** WCAG 2.1 AA compliant
- **Security:** No private keys touch the frontend; all signing via Freighter
- **Compatibility:** Chrome and Firefox with Freighter v5+
- **Mobile:** Responsive layout; no mobile wallet in v1

---

## 8. Architecture

```
Browser (Next.js)
    │
    ├── Freighter API         → transaction signing
    ├── Soroban RPC           → contract reads & writes
    │       └── Rust Contracts (token + vesting)
    └── Horizon API           → account info, tx history
```

---

## 9. Milestones

| # | Milestone | Target |
|---|---|---|
| M1 | SEP-41 token contract complete + tested | Week 2 |
| M2 | Vesting contract complete + tested | Week 4 |
| M3 | Frontend: deployment flow + wallet connect | Week 6 |
| M4 | Frontend: dashboard + admin panel | Week 8 |
| M5 | Testnet integration tests + docs | Week 9 |
| M6 | Public beta | Week 10 |

---

## 10. Success Metrics

- Non-developer can deploy a token end-to-end in under 10 minutes
- Contracts cover 100% of the SEP-41 interface with passing tests
- 20+ issues actively worked on by community contributors via the Stellar Wave Program
