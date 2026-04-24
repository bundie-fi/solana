# Bundie

> Agent-curated prediction markets for DeFi interest rates on Solana.

**Colosseum Frontier Hackathon** — DeFi + Consumer Tracks

Three autonomous agents run competing DeFi strategies. Each agent watches the others' vaults and opens prediction markets on their peers' future performance. Humans bet YES/NO. Markets settle on-chain — no oracle needed.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Tier 1 — Strategy Agents                                   │
│  alice.bundie  bob.bundie  charlie.bundie                   │
│  Zerion-managed keypairs · DENY-by-default policies         │
│  Redpill (Claude Sonnet 4.5) decides strategy each tick     │
│  Strategies simulated on surfpool (mainnet fork)            │
└──────────────────────────┬──────────────────────────────────┘
                           │ peer NAV observations
┌──────────────────────────▼──────────────────────────────────┐
│  Tier 2 — Market-Creator Agents (same agents, different hat)│
│  Scan peer vault NAVs + on-chain rate surfaces              │
│  Open LS-LMSR prediction markets on devnet                  │
│  On-chain guard: agent CANNOT create market on own vault    │
└──────────────────────────┬──────────────────────────────────┘
                           │ YES / NO shares
┌──────────────────────────▼──────────────────────────────────┐
│  Tier 3 — Humans                                            │
│  Web UI + Seeker TWA · buy YES or NO                        │
│  Resolution reads on-chain NAV — no external oracle         │
└─────────────────────────────────────────────────────────────┘
```

**Two-chain split:**
- **Surfpool** (mainnet fork at `http://127.0.0.1:8899`) — agents observe real Kamino / Marinade / Jupiter rates, reason with live data, simulate strategy execution.
- **Devnet** — prediction market program lives here. Every `create_market_v2` tx is persistent evidence. Markets persist; surfpool state does not.

**Insider-trading prevention:** The on-chain `create_market_v2` instruction enforces `InsiderMarketForbidden` — `target_agent != creator` at the program level. Not a convention, a hard constraint.

---

## Monorepo Structure

```
packages/
├── web/                  # Next.js 14 PWA (Seeker TWA wrapper)
├── backend/              # Hono API (Railway)
├── programs/             # Anchor + pinocchio workspace
│   ├── programs/prediction-market/   # LS-LMSR, oracle-free resolution
│   └── scripts/chaos-sim/            # Agent daemon (LLM-brained)
├── zerion-agent/         # Zerion CLI fork — DENY-by-default policy enforcer
├── beethoven/            # Local fork of blueshift-gg/beethoven (CPI router)
├── common/               # Shared TS types, IDLs, constants
├── docs/                 # Docs site (solana.bundie.fi/docs)
└── landing-page/         # Marketing site (solana.bundie.fi)

agents/
├── alice.bundie.sol/     # policies.yaml + brain.md (LST rotation)
├── bob.bundie.sol/       # policies.yaml + brain.md (basis trade)
└── charlie.bundie.sol/   # policies.yaml + brain.md (60/40 conservative)
```

---

## Bounty Alignment

| Bounty | How we qualify |
|--------|---------------|
| **Zerion** | All agent swaps route through `zerion tx swap` (CLI fork in `packages/zerion-agent/`). DENY-by-default: 6-predicate policy gates every action before signing. |
| **SNS** | `bundie.sol` owned on mainnet. Three subdomains (`alice.bundie`, `bob.bundie`, `charlie.bundie`) registered under a protocol-owned `.bundie` root on devnet. Every market card surfaces its creator's SNS handle. |

---

## Key Agents

| Agent | SNS | Strategy | Vault |
|-------|-----|----------|-------|
| alice | alice.bundie | LST yield rotation (Marinade → Jito arbitrage) | `5ZnHtnSBvy4L9fGzGYaecVZ3WonWK3rLCqb4uaEgGXcm` |
| bob | bob.bundie | Basis trade (fund rate arbitrage, Kamino USDC) | `EBYDp5c3JC6yx3KFrSXnQnRXGFtMJyB85cPVY83SFmr7` |
| charlie | charlie.bundie | 60/40 conservative split (yield + cash) | `8zNazDgyrTX1CTaPk4G6hZ8r47SbVajh1vcFrqNAzBFg` |

---

## Programs

| Program | Address | Purpose |
|---------|---------|---------|
| Prediction Market | `Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4` | LS-LMSR markets, oracle-free resolution (devnet) |

**Market kinds in use:**
- `5` — Rate Barrier ("Kamino USDC supply APY will exceed X%")
- `6` — Agent vs Benchmark ("alice.bundie's NAV will beat benchmark by 200bps")

---

## Quick Start

```bash
# Dependencies
pnpm install

# Web app (port 3000)
pnpm --filter web dev

# Backend (port 3001)
pnpm --filter backend dev

# Build + test Solana programs
cd packages/programs && anchor build && anchor test

# Run one agent tick (smoke test)
cd packages/programs
pnpm chaos:agent-demo alice

# Run agent daemon (continuous, all three agents)
pnpm chaos:agent-daemon
```

### Run surfpool (mainnet fork for strategy simulation)

```bash
# Requires surfpool binary
cd packages/programs/scripts/chaos-sim
bash start-surfpool.sh
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 PWA, Tailwind CSS, Mobile Wallet Adapter, Seeker TWA |
| Backend | Hono, Supabase (Railway) |
| Smart Contracts | Anchor 1.0 (prediction-market), pinocchio (strategy side utils) |
| Agent Brain | Redpill → Claude Sonnet 4.5 |
| Swap Routing | Zerion CLI (DENY-by-default, 6 predicates) |
| Strategy Simulation | Surfpool (mainnet fork) |
| Protocol CPI | Beethoven → Kamino, Marinade |
| Identity | SNS — bundie.sol (mainnet), .bundie root (devnet) |
| Deployment | Railway (surfpool + 3 agent daemons + web) |
| Network | Devnet (markets) + Surfpool (strategy simulation) |

---

## Environment Variables

```bash
# Web app
cp packages/web/.env.example packages/web/.env.local

# Backend
cp packages/backend/.env.example packages/backend/.env

# Agent daemon (gitignored)
# packages/programs/scripts/chaos-sim/.env
REDPILL_API_KEY=...
REDPILL_MODEL=anthropic/claude-sonnet-4.5
ZERION_API_KEY=...
SURFPOOL_RPC_URL=http://127.0.0.1:8899
DEVNET_RPC_URL=https://api.devnet.solana.com
```

---

## Team

| Person | Owns |
|--------|------|
| **Yudhi** | Architecture, PM program, agent daemon, Zerion integration, SNS |
| **Sean** | LS-LMSR math, resolve logic, NAV byte readers |
| **Junheng** | Webapp, wallet integration, Seeker TWA |

---

## License

Private — Colosseum Frontier Hackathon submission.
