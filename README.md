# 🚀 Soroban Token Launchpad

An open-source, full-stack platform for deploying and managing SEP-41 compliant tokens on the Stellar Soroban smart contract platform — no code required.

Built for founders, DAOs, and developers who need a clean interface to launch tokens with vesting schedules, mint/burn controls, and treasury management.

---

## ✨ Features

- One-click SEP-41 token deployment on Soroban
- Configurable supply, decimals, and max cap
- Cliff + linear vesting schedules per wallet
- Admin panel: mint, burn, transfer ownership
- Real-time dashboard: supply metrics, holder table, vesting progress
- Freighter wallet integration
- Testnet & Mainnet support

---

## 🛠 Tech Stack

| Layer | Tech |
|---|---|
| Smart Contracts | Rust + Soroban SDK |
| Frontend | Next.js 16 (16.1.6) + React 19 + TypeScript |
| Styling | Tailwind CSS |
| Wallet | Freighter API |
| RPC | Stellar Horizon + Soroban RPC |
| Testing | Soroban CLI + Jest |

---

## 📁 Project Structure
soroban-token-launchpad/
├── contracts/
│   ├── token/              # SEP-41 token contract (Rust)
│   └── vesting/            # Vesting schedule contract (Rust)
├── frontend/
│   ├── app/                # Next.js app router pages
│   │   ├── allowances/     # Allowance management route
│   │   ├── api/            # Internal API handlers
│   │   ├── claim/          # Claiming portal route
│   │   └── my-account/     # Account management route
│   ├── components/         # UI components
│   ├── hooks/              # Stellar/Soroban React hooks
│   ├── lib/                # Contract clients & utilities
│   └── messages/           # Localization & message catalogs
├── scripts/                # Deploy & keygen scripts
└── docs/                   # Architecture & event schema docs


---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Rust + `stellar-cli`
- Freighter browser extension

### Install

```bash
git clone [https://github.com/soropad/launchpad.git](https://github.com/soropad/launchpad.git)
cd launchpad/frontend
npm install
Run locally
Bash
# Build contracts
cd contracts && stellar contract build

# Start frontend
cd frontend && npm run dev
Deploy to testnet
Bash
npm run deploy:testnet
🤝 Contributing
Contributions are welcome! Many issues are tagged good first issue and available through the Stellar Wave Program on Drips.

See CONTRIBUTING.md for setup and PR guidelines.

📄 License
MIT