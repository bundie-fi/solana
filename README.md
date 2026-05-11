# Bundie

> The index of DeFi performance you can trade on.

**Live app:** [app.solana.bundie.fi](https://app.solana.bundie.fi) · **Landing:** [solana.bundie.fi](https://solana.bundie.fi)

**Colosseum Frontier Hackathon** — DeFi (primary) + Consumer Apps (secondary)

---

## What it does

Bundie hosts AI trading agents that execute real DeFi strategies on Solana, and runs binary prediction markets on their NAV performance. Bettors browse a leaderboard of agents ranked by realized 30-day return, drill into agent detail pages with live NAV charts, and place YES/NO bets on whether an agent's NAV will cross a target by a resolution date. Markets settle automatically by reading on-chain NAV at the resolution slot. **No oracle, no committee, no off-chain attestation.**

Six trading agents are live on devnet at launch. Each runs autonomously through a chaos-sim daemon: an LLM brain reasons over live mainnet rate surfaces (Kamino utilization, Marinade mSOL above-par, Jupiter Perps funding) and emits on-chain actions. Strategies execute on a Solana mainnet fork (surfpool); markets and NAV settlement live on devnet.

---

## The six agents at launch

| SNS handle | Display | Strategy |
|---|---|---|
| `kamino-stacker` | Kaito | Kamino USDC supply — maximally simple lending |
| `apy-rotator` | Maya | Yield rotation between Kamino and Solend USDC reserves |
| `funding-shorter` | Felix | Funding-rate carry: short SOL perp on Jupiter when funding is positive |
| `stable-arber` | Stella | Stablecoin yield aggregation across lending venues |
| `barbell` | Asher | 50% Kamino USDC + 50% jupiter-perps SOL long |
| `lst-shopper` | Leo | Compares Marinade vs Jito above-par rates each epoch |

---

## Architecture

```
                 ┌─────────────────────────────────────┐
                 │  Discover · Markets · Portfolio     │
                 │  Web app + Seeker TWA               │
                 └────────────────┬────────────────────┘
                                  │ YES / NO bets
                                  │ in bUSD
                 ┌────────────────▼────────────────────┐
                 │  LS-LMSR prediction market program  │
                 │  Anchor · devnet · oracle-free      │
                 └────────────────┬────────────────────┘
                                  │ commit_nav per slot
                 ┌────────────────▼────────────────────┐
                 │  AI trading agent (Redpill brain)   │
                 │  observe → reason → execute         │
                 └────────────────┬────────────────────┘
                                  │ direct SDK calls
                 ┌────────────────▼────────────────────┐
                 │  Kamino · Marinade · Solend ·       │
                 │  Jito · Jupiter · Jupiter Perps     │
                 │  on a Solana mainnet fork (surfpool)│
                 └─────────────────────────────────────┘
```

**Two-chain split.** Strategy actions land on **surfpool** (mainnet fork) so agents read live protocol state and execute against real reserves. The prediction-market program lives on **devnet** — every `create_market_v2`, `buy_shares`, and `commit_nav` is on-chain and persistent. The bUSD treasury balance tracks each agent's surfpool NAV via per-tick performance sync.

**Insider-trading prevention.** The `create_market_v2` instruction enforces `InsiderMarketForbidden` at the program level — `target_agent != creator`. Not a convention.

**Demo speed.** From wallet connect to placed bet in under 30 seconds. Agent ticks land at 15s cadence; the warmup loop runs a deterministic first action so a newly-active agent shows visible activity in <5s.

---

## Monorepo

```
packages/
├── web/            Next.js 14 PWA  (app.solana.bundie.fi)
├── backend/        Hono API + faucet + agents registry on Railway
├── programs/       Anchor program + chaos-sim agent daemon
│   ├── programs/prediction-market/   LS-LMSR + oracle-free resolution
│   └── scripts/chaos-sim/            Daemon: tick supervisor + warmup loop
├── common/         Shared TypeScript types, IDLs, constants
└── landing-page/   Marketing site  (solana.bundie.fi)
```

---

## Programs

| Program | Address | Purpose |
|---|---|---|
| Prediction Market | `Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4` | LS-LMSR markets + NAV-based resolution (devnet) |

**Market kinds:**
- `kind=1` — NAV target: agent X's NAV will exceed Y bUSD by slot Z
- `kind=2` — Head-to-head: agent A's NAV growth will beat agent B's
- `kind=3` — Drawdown: agent X's NAV will fall by Y bps within window

---

## Wired DeFi protocols

The chaos-sim executor has direct SDK integrations with these mainnet programs (read via surfpool fork):

| Category | Protocols |
|---|---|
| Lending | Kamino, Solend |
| LST staking | Marinade, Jito (SPL stake pool) |
| Perps | Jupiter Perps |
| Swap | Jupiter v6 router |

No third-party CPI middleware. Each agent's positions are read directly from chain state for NAV computation.

---

## Quick Start

```bash
pnpm install

# Web app (port 3000)
pnpm --filter @bundie/web dev

# Backend (port 3001)
pnpm --filter @bundie/backend dev

# Build + test Solana programs
cd packages/programs && anchor build && anchor test

# Run the agent daemon (polls Postgres for active agents)
pnpm chaos:agent-daemon
```

### Surfpool mainnet fork

```bash
cd packages/programs/scripts/chaos-sim
bash start-surfpool.sh
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 PWA, Solana Wallet Adapter, Seeker TWA wrapper |
| Backend | Hono on Railway, Postgres agent registry, bUSD faucet |
| On-chain | Anchor (prediction-market), pinocchio (utility programs) |
| Agent brain | Redpill → Claude Sonnet 4.5 |
| Strategy execution | Surfpool mainnet fork, direct DeFi SDK calls |
| Identity | SNS — `bundie.sol` (mainnet) + `.bundie` SNS root (devnet) |
| Deployment | Railway: web · backend · chaos-sim daemon · surfpool · Postgres |

---

## Environment

```bash
# Web (.env.local)
NEXT_PUBLIC_RPC_URL=                # devnet RPC
NEXT_PUBLIC_BACKEND_URL=https://backend.solana.bundie.fi
NEXT_PUBLIC_BUSD_MINT=...

# Backend (Railway secrets)
DATABASE_URL=
DEVNET_RPC=
BUSD_MINT=
BUSD_MINT_AUTHORITY_SECRET=         # JSON byte array
AGENT_FUNDING_SECRET=               # JSON byte array

# chaos-sim daemon (Railway secrets, same DB)
DATABASE_URL=
SURFPOOL_RPC_URL=                   # surfpool fork
MAINNET_RPC_URL=                    # for live rate-surface reads
REDPILL_API_KEY=
BUSD_MINT=
BUSD_MINT_AUTHORITY_SECRET=
```

---

## Team

| Person | Owns |
|---|---|
| **Yudhishthra** | Anchor programs, on-chain NAV streaming, Solana protocol SDK integrations |
| **Yee Chian** | Positioning, partnerships, agent operator outreach |
| **Junheng** | Frontend, Seeker TWA, demo experience |

---

## License

[MIT](./LICENSE) — © 2026 Bundie. Open-source as part of the Colosseum Frontier Hackathon submission.
