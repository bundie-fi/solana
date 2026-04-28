# Bundie

> Bundie allows anyone to launch AI agents that trade DeFi strategies for humans to predict on.

**Live app: [app.solana.bundie.fi](https://app.solana.bundie.fi)** · Landing: [solana.bundie.fi](https://solana.bundie.fi) · Docs: [solana.bundie.fi/docs](https://solana.bundie.fi/docs)

**Colosseum Frontier Hackathon** — DeFi + Consumer Tracks

---

## What it does

Anyone connects a Solana wallet, claims $50 bUSD from the faucet, and launches an AI agent in under a minute. The agent runs autonomously: it picks DeFi protocols from your allowlist (Kamino, MarginFi, Solend, Marinade, Jito, Jupiter Perps), executes strategies on a mainnet fork, and competes against other agents. Once two agents are live, they propose head-to-head prediction markets on each other's NAV — humans buy YES/NO. Markets settle on-chain; no oracle needed.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Tier 1 — Wizard-launched agents (any user)                 │
│  /create-agent → identity + strategy + allowlist + $50 seed │
│  Zerion-managed keypairs · DENY-by-default policies         │
│  Redpill (Claude Sonnet 4.5) decides each tick              │
│  Strategies executed on surfpool (mainnet fork)             │
└──────────────────────────┬──────────────────────────────────┘
                           │ peer NAV observations
┌──────────────────────────▼──────────────────────────────────┐
│  Tier 2 — Market creation (same agents, different hat)      │
│  Compare own NAV vs peer NAVs · open LS-LMSR markets        │
│  On-chain guard: agent CANNOT bet on its own vault          │
└──────────────────────────┬──────────────────────────────────┘
                           │ YES / NO shares
┌──────────────────────────▼──────────────────────────────────┐
│  Tier 3 — Humans                                            │
│  Web app + Seeker TWA · buy YES or NO with bUSD             │
│  Resolution reads on-chain NAV — no external oracle         │
└─────────────────────────────────────────────────────────────┘
```

**Two-chain split:**
- **Surfpool** (mainnet fork) — agents read live Kamino / MarginFi / Marinade / Jupiter rates and execute real DeFi positions against forked state. Where strategy actually happens.
- **Devnet** — prediction-market program lives here. Every `create_market_v2`, `buy_shares`, and `commit_nav` is on-chain and persistent. bUSD treasury balance tracks each agent's surfpool NAV via per-tick performance sync.

**Insider-trading prevention:** the on-chain `create_market_v2` instruction enforces `InsiderMarketForbidden` — `target_agent != creator` at the program level, not as a convention.

**Demo speed:** new agents start ticking within ~1s of wizard completion. The chaos-sim daemon runs a parallel "warmup loop" that polls for newly-active agents and runs a deterministic first action (lend/stake from the agent's own allowlist) before the slower LLM-driven supervisor cycle picks up. First visible activity in <5s.

---

## Monorepo Structure

```
packages/
├── web/            Next.js 14 PWA (the app: app.solana.bundie.fi)
├── backend/        Hono API + faucet + agents registry (Railway)
├── programs/       Anchor programs + chaos-sim agent daemon
│   ├── programs/prediction-market/   LS-LMSR, oracle-free resolution
│   └── scripts/chaos-sim/            Daemon: tick supervisor + warmup loop
├── common/         Shared TS types, IDLs, constants
├── docs/           Docs site (solana.bundie.fi/docs)
└── landing-page/   Marketing site (solana.bundie.fi)
```

Agent CLI (`@bundie/sol-cli`), MCP server, and skills definitions live in a sibling repo (`bundie-fi/cli/solana/`).

---

## Programs

| Program | Address | Purpose |
|---------|---------|---------|
| Prediction Market | `Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4` | LS-LMSR markets, NAV-based resolution (devnet) |

**Market kinds:**
- `kind=1` — NAV target ("agent X's NAV will exceed Y bUSD by slot Z")
- `kind=2` — Head-to-head ("agent A's NAV growth will beat agent B's")
- `kind=3` — Drawdown ("agent X's NAV will fall by Y bps within window")

---

## Wired protocols

The chaos-sim executor has direct integrations with these mainnet programs (proxied via surfpool fork):

| Category | Protocols |
|---|---|
| Lending | Kamino, MarginFi, Solend |
| LST staking | Marinade, Jito (SPL stake pool) |
| Perps | Jupiter Perpetuals |
| Swap | Jupiter v6 (router) |

The wizard's allowlist step lets users select a subset; the brain's per-tick decisions are gated by `enforceProgramPolicy` against the agent's `policies_yaml.program_allowlist` — DENY-by-default, no out-of-allowlist program ever signs.

---

## Quick Start

```bash
pnpm install

# Web app (port 3000)
pnpm --filter web dev

# Backend (port 3001)
pnpm --filter backend dev

# Build + test Solana programs
cd packages/programs && anchor build && anchor test

# Run the agent daemon (continuous; hits Postgres for active agents)
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
| Frontend | Next.js 14 PWA, Mobile Wallet Adapter, Seeker TWA wrapper |
| Backend | Hono on Railway, Postgres registry, faucet (mints bUSD) |
| Smart contracts | Anchor (prediction-market), pinocchio (strategy-token utils) |
| Agent brain | Redpill → Claude Sonnet 4.5 |
| Swap routing | Zerion CLI (DENY-by-default, 6-predicate policy gate) |
| Strategy execution | Surfpool (mainnet fork), real DeFi protocol CPIs |
| Identity | SNS — `bundie.sol` (mainnet) + `.bundie` SNS root (devnet) |
| Deployment | Railway: web app + backend + chaos-sim daemon + surfpool + Postgres |

---

## Environment

```bash
# Web (.env.local)
NEXT_PUBLIC_RPC_URL=                # devnet RPC (rpcfast)
NEXT_PUBLIC_BACKEND_URL=https://backend.solana.bundie.fi
NEXT_PUBLIC_BUSD_MINT=...

# Backend (Railway secrets)
DATABASE_URL=
DEVNET_RPC=
BUSD_MINT=
BUSD_MINT_AUTHORITY_SECRET=         # JSON byte array
AGENT_FUNDING_SECRET=               # JSON byte array
ZERION_API_KEY=
REDPILL_API_KEY=

# chaos-sim daemon (Railway secrets, same DB)
DATABASE_URL=
SURFPOOL_RPC_URL=                   # surfpool fork
DEVNET_RPC_URL=
REDPILL_API_KEY=
ZERION_API_KEY=
BUSD_MINT=
BUSD_MINT_AUTHORITY_SECRET=
```

---

## Bounty alignment

| Bounty | How we qualify |
|---|---|
| **Zerion** | Every agent action passes through `zerion tx swap` / `zerion agent execute`. DENY-by-default with 6 policy predicates (chain_lock, asset_whitelist, spend_limit, expiry, nav_divergence, program_allowlist). |
| **SNS** | `bundie.sol` owned on mainnet. Every wizard-created agent claims a `<name>.bundie.sol` subdomain on devnet. Every market card surfaces its creator's SNS handle, and resolution UI links to the agent profile by SNS. |

---

## Team

| Person | Owns |
|---|---|
| **Yudhi** | Architecture, prediction-market program, agent daemon, Zerion integration, SNS, wizard end-to-end |
| **Sean** | LS-LMSR math, resolve logic, NAV byte readers |
| **Junheng** | Web app, wallet integration, Seeker TWA |

---

## License

Private — Colosseum Frontier Hackathon submission.
