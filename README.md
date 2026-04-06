# Yields.so v2

> Turn investment strategies into tradeable assets on Solana. Earn by investing. Profit by predicting.

**Colosseum Frontier Hackathon** — DeFi + Consumer Tracks

## What Is This

Yields.so is a Solana protocol with two interlocking primitives:

1. **Strategy Shares** — Anyone (human or AI agent) creates an investment strategy. The protocol mints tradeable SPL tokens tracking the strategy's live portfolio value. Others buy shares for proportional exposure. Creators earn performance fees.

2. **Self-Resolving Prediction Markets** — Anyone opens a prediction market on a strategy's future performance ("Will this strategy exceed 15% APY this month?"). Markets use LS-LMSR for guaranteed liquidity from the first trade. Settlement reads live on-chain NAV data — no external oracle needed.

Three ways to earn:
- **Invest** in strategies you trust (gold mode)
- **Predict** which strategies will outperform (purple mode)
- **Create** a strategy and collect fees from followers

## Monorepo Structure

```
packages/
├── web/          # Next.js 14 frontend — responsive, Railway deployment
├── backend/      # Hono API server — shared by web + mobile
├── programs/     # Anchor workspace
│   ├── programs/strategy-token/      # Strategy share minting, NAV tracking
│   └── programs/prediction-market/   # LS-LMSR markets, oracle-free resolution
├── mobile/       # Expo React Native — Seeker phone + Google Play
├── common/       # Shared TypeScript types, IDL bindings, constants
└── docs/         # Technical documentation
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Start web app (port 3000)
pnpm --filter web dev

# Start backend (port 3001)
pnpm --filter backend dev

# Start mobile app
pnpm --filter mobile start

# Build Solana programs
cd packages/programs && anchor build

# Run program tests
cd packages/programs && anchor test
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend (Web) | Next.js 14, Tailwind CSS, Wallet Adapter |
| Frontend (Mobile) | Expo, React Native, NativeWind, Solana Mobile Wallet Adapter |
| Backend | Hono, Supabase |
| Smart Contracts | Anchor 0.31.1, Rust |
| Protocols | Beethoven CPI → Kamino (lending) |
| Deployment | Railway (web + backend + Supabase) |
| Network | Solana Devnet |

## Team

| Person | Role | Owns |
|--------|------|------|
| **Yudhi** | Team Lead | Strategy Token Program, Beethoven integration, NAV oracle, CLI, Agent SKILLS |
| **Sean** | Engineer | Prediction Market Program, LS-LMSR, tx wiring |
| **Junheng** | Engineer | All screens (web + mobile), wallet integration, polish |

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
cp packages/mobile/.env.example packages/mobile/.env
```

## License

Private — Colosseum Frontier Hackathon submission.
