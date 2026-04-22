# Bundie (Solana)

> Turn investment strategies into tradeable assets on Solana. Earn by investing. Profit by predicting.

**Colosseum Frontier Hackathon** — DeFi + Consumer Tracks

## What Is This

Bundie is a Solana protocol with two interlocking primitives:

1. **Strategy Shares** — Anyone (human or AI agent) creates an investment strategy. The protocol mints tradeable SPL tokens tracking the strategy's live portfolio value. Others buy shares for proportional exposure. Creators earn performance fees.

2. **Self-Resolving Prediction Markets** — Anyone opens a prediction market on a strategy's future performance ("Will this strategy exceed 15% APY this month?"). Markets use LS-LMSR for guaranteed liquidity from the first trade. Settlement reads live on-chain NAV data — no external oracle needed.

Three ways to earn:
- **Invest** in strategies you trust (gold mode)
- **Predict** which strategies will outperform (purple mode)
- **Create** a strategy and collect fees from followers

## Monorepo Structure

```
packages/
├── web/          # Next.js 14 PWA (wraps as Seeker TWA)
├── backend/      # Hono API server
├── programs/     # Anchor + pinocchio workspace
│   ├── programs/strategy-token/      # Strategy share minting, NAV tracking (pinocchio)
│   └── programs/prediction-market/   # LS-LMSR markets, oracle-free resolution (Anchor)
├── common/       # Shared TypeScript types, IDLs, constants
├── landing-page/ # Marketing site (solana.bundie.fi)
└── docs/         # Technical documentation
```

The CLI (`@bundie/sol-cli`, `bundie-sol`) lives in a separate repo at
[bundie-fi/cli](https://github.com/bundie-fi/cli) under `solana/`.
MCP and Skills follow the same evm/solana split.

The mobile surface is the webapp wrapped as a Seeker TWA, not a separate native app.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start web app (port 3000)
pnpm --filter web dev

# Start backend (port 3001)
pnpm --filter backend dev

# Build Solana programs
cd packages/programs && anchor build

# Run program tests
cd packages/programs && anchor test

# Use the CLI (agent surface — separate repo)
git clone https://github.com/bundie-fi/cli && cd cli/solana && pnpm install && pnpm build
node dist/index.js --help
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 PWA, Tailwind CSS, Wallet Adapter, Seeker TWA |
| Backend | Hono, Supabase |
| Smart Contracts | Anchor 0.31.1 (prediction-market) + pinocchio (strategy-token) |
| Protocols | Beethoven CPI → Kamino (lending) |
| Deployment | Railway |
| Network | Solana Devnet |

## Team

| Person | Role | Owns |
|--------|------|------|
| **Yudhi** | Team Lead | Strategy Token Program, Beethoven integration, NAV oracle, CLI, Agent SKILLS |
| **Sean** | Engineer | Prediction Market Program, LS-LMSR, tx wiring |
| **Junheng** | Engineer | Webapp, wallet integration, polish, PWA/TWA wrap |

## Key Design Decisions

- **LS-LMSR** over constant-product AMM — guaranteed liquidity at every price from first trade
- **Oracle-free resolution** — prediction markets settle using on-chain NAV data, not Pyth/Switchboard
- **Beethoven CPI** for protocol routing — swap protocols without changing contract code
- **Gold (#d4a853)** = Earn mode, **Purple (#a78bfa)** = Predict mode
- **SNS .sol names** for identity and leaderboard

## Environment Variables

Copy `.env.example` files in each package:
```bash
cp packages/web/.env.example packages/web/.env.local
cp packages/backend/.env.example packages/backend/.env
```

## License

Private — Colosseum Frontier Hackathon submission.
