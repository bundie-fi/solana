# Yields.so v2

## What Is This
Yields.so is a Solana protocol that lets anyone launch an investment strategy as a tradeable asset, so others can earn by investing in it, and everyone can profit from predicting which strategies will outperform.

Two core primitives:
1. **Strategy Token Program** — Mint tradeable shares tracking live portfolio value via Beethoven/Kamino
2. **Prediction Market Program** — LS-LMSR markets that self-resolve using on-chain NAV data

## Monorepo Structure
- `packages/web` — Next.js 14 PWA (wrapped as Seeker TWA)
- `packages/backend` — Hono API server (Railway deployment)
- `packages/programs` — Anchor + pinocchio workspace (Strategy Token + Prediction Market)
- `packages/beethoven` — Local fork of blueshift-gg/beethoven with our resolvers
- `packages/common` — Shared TypeScript types, IDLs, constants
- `packages/landing-page` — Marketing site

CLI lives in a separate repo at `../bundie-fi/cli/solana/` (`@bundie/sol-cli`,
prepare-only). MCP and Skills repos follow the same evm/solana split.

## Development
- Package manager: pnpm
- Node: >=20
- Solana: devnet
- Database: Supabase (deployed on Railway)

## Key Technical Decisions
- LS-LMSR for prediction market AMM (not constant-product)
- Oracle-free resolution using on-chain NAV data
- Beethoven CPI for protocol routing (Kamino first)
- Gold (#d4a853) = Earn mode, Purple (#a78bfa) = Predict mode
- SNS .sol name resolution for identity

## Commands
- `pnpm dev` — Start all packages in dev mode
- `pnpm --filter web dev` — Start web app only
- `pnpm --filter backend dev` — Start backend only
- `pnpm --filter @bundie/sol-cli build` — Build the agent CLI
- `cd packages/programs && anchor build` — Build Solana programs
- `cd packages/programs && anchor test` — Run program tests
