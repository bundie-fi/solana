# Bundie

> The oracle agents read to price the future.

**Live app:** [app.solana.bundie.fi](https://app.solana.bundie.fi) · **Landing:** [solana.bundie.fi](https://solana.bundie.fi) · **Agent MCP:** `npx -y @bundie/sol-mcp` ([repo](https://github.com/bundie-fi/mcp))

**Colosseum Frontier Hackathon** — DeFi (primary) + Consumer Apps (secondary)

---

## What it does

Bundie is a market that prices **on-chain DeFi outcomes** and settles by **reading Solana state** — no oracle, no committee, no off-chain attestation.

Existing oracles price the *present*: what a token is worth right now. Bundie prices what's about to *happen* — will this pool's utilization spike, will this LST lose its peg, will this stablecoin slip this week — and resolves it from the same chain the outcome lives on.

One primitive, two paying customers:

- **Retail traders** buy YES or NO on a DeFi-outcome market (~1% spread). That price *is* the market's implied probability.
- **External AI agents** pay $0.001 over **x402** to read the signed price before they act. Same market, two sides: traders provide the signal, agents consume it.

Market supply is live on-chain DeFi state — TVL, utilization, LST par, funding, depeg. There are no agents to create and nothing for users to launch; the supply is infinite and chain-readable.

> **Note:** AI-agent strategy performance is just *one example* market category. A live house strategy's NAV is another on-chain metric to price — relatable, and what Colosseum flagged. It runs on 1–2 house agents and is not a user-facing feature.

---

## Why on-chain settlement is the moat

A market like *"will Kamino USDC utilization cross 90% this week?"* settles by reading Kamino's account directly on Solana at the resolution slot. No Pyth, no Switchboard, no committee.

That closes the loop every other prediction market leaves open: the price that prices a DeFi outcome settles from the exact same chain the outcome lives on. It only works on Solana — that's the whole moat.

`InsiderMarketForbidden` is enforced at the program level (`target_agent != creator`) — a constraint, not a convention.

---

## Architecture

```
                 ┌─────────────────────────────────────┐
                 │  Discover · Markets · Portfolio     │
                 │  Web app + Seeker TWA               │
                 └──────────┬──────────────┬───────────┘
                 YES/NO bets │              │ x402 price read
                 in bUSD     │              │ ($0.001 / query)
              (retail trader)│              │  (external AI agent)
                 ┌───────────▼──────────────▼───────────┐
                 │  LS-LMSR prediction market program   │
                 │  Anchor · devnet · oracle-free       │
                 │  signed price = implied probability  │
                 └────────────────┬─────────────────────┘
                                  │ resolves by reading chain state
                 ┌────────────────▼─────────────────────┐
                 │  Live Solana DeFi state               │
                 │  Kamino · Marinade · Solend · Jito ·  │
                 │  Jupiter — TVL, utilization, LST par, │
                 │  funding, depeg (direct SDK reads)    │
                 └───────────────────────────────────────┘
```

**On-chain resolution.** Every `create_event`, `buy_shares`, and `resolve_event` is on-chain and persistent on devnet. At the resolution slot, the program reads protocol state directly and settles — no external resolver in the loop.

**The x402 read.** Agents query `/v1/event-price?id=<market>` with an `X-PAYMENT` header and receive signed JSON `{price, depth, attestation}`. This is the literal "oracle agents read" moment — a machine-readable forward price priced by the live market.

**Demo speed.** From wallet connect to placed bet in under 30 seconds.

---

## Monorepo

```
packages/
├── web/            Next.js 14 PWA  (app.solana.bundie.fi)
├── backend/        Hono API + faucet + x402 price-read endpoint on Railway
├── programs/       Anchor program + market-seeding scripts
│   └── programs/prediction-market/   LS-LMSR + oracle-free on-chain resolution
├── common/         Shared TypeScript types, IDLs, constants
└── landing-page/   Marketing site  (solana.bundie.fi)
```

> The agent-facing **MCP server** lives in a separate repo: [github.com/bundie-fi/mcp](https://github.com/bundie-fi/mcp) (`@bundie/sol-mcp`).

---

## Programs

| Program | Address | Purpose |
|---|---|---|
| Prediction Market | `Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4` | LS-LMSR markets + oracle-free on-chain resolution (devnet) |

**Market subjects** are live on-chain DeFi metrics — protocol TVL, pool utilization, LST par, perp funding, stablecoin depeg. *(Strategy-NAV markets on house agents — `commit_nav` / `resolve_market_v2` — exist as one example category.)*

> Lead with **on-chain-resolvable** subjects (TVL / utilization / depeg / LST par). Off-chain-resolved markets (e.g. status-page pollers) contradict "oracle-free" and stay out of the headline.

---

## Read API (x402)

```bash
# An external agent pays $0.001 to read the signed forward price
curl https://backend.solana.bundie.fi/v1/event-price?id=kamino_util_90 \
  -H "X-PAYMENT: <x402-payment>"

# → { "price": 0.41, "depth": 12500, "attestation": "..." }
```

Priced dynamically by market depth. WSS billed per minute. The query side scales with the agent economy.

---

## For agents: read the oracle over MCP

The oracle is consumable by any AI agent over the **Model Context Protocol** — this is the agent-facing product. Drop it into Claude Code, Cursor, or any MCP client:

```bash
npx -y @bundie/sol-mcp        # Smithery-listed; defaults to backend.solana.bundie.fi
```

Tools: `list_events`, **`read_price`** (x402-gated signed price), **`verify_attestation`** (ed25519, on-chain-verifiable), `get_event_detail`, `resolver_track_record`. The MCP is a stateless passthrough — the Solana backend runs the x402 dance.

A typical agent flow: query the probability of a DeFi outcome → receive a signed price → verify the attestation → gate its decision on the result. Source: [github.com/bundie-fi/mcp](https://github.com/bundie-fi/mcp).

---

## Wired DeFi protocols

Market subjects are sourced from real on-chain state via direct SDK reads (no third-party CPI middleware):

| Category | Protocols |
|---|---|
| Lending | Kamino, Solend |
| LST staking | Marinade, Jito (SPL stake pool) |
| Perps | Jupiter Perps |
| Swap | Jupiter v6 router |

State is read directly from chain for both market resolution and the house-agent NAV example.

---

## Quick Start

```bash
pnpm install

# Web app (port 3000)
pnpm --filter @bundie/web dev

# Backend (port 3001) — API + faucet + x402 read endpoint
pnpm --filter @bundie/backend dev

# Build + test Solana programs
cd packages/programs && anchor build && anchor test
```

The agent-facing MCP server is in its own repo — see [github.com/bundie-fi/mcp](https://github.com/bundie-fi/mcp) or just `npx -y @bundie/sol-mcp`.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 PWA, Solana Wallet Adapter, Seeker TWA wrapper |
| Backend | Hono on Railway, Postgres, bUSD faucet, x402 price-read API |
| On-chain | Anchor (prediction-market), pinocchio (utility programs) |
| Resolution | Oracle-free — reads Solana DeFi state at the resolution slot |
| Agent interface | MCP (`@bundie/sol-mcp`) — stateless passthrough to the x402 read API |
| Identity | SNS — `bundie.sol` (mainnet) + `.bundie` SNS root (devnet) |
| Deployment | Railway: web · backend · resolver · Postgres |

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
AGENT_FUNDING_SECRET=               # JSON byte array (wallet SNS provisioning)
```

---

## Team

| Person | Owns |
|---|---|
| **Yudhishthra** | Anchor programs, on-chain resolution, Solana protocol SDK integrations |
| **Yee Chian** | Positioning, partnerships, x402 / agent-consumer outreach |
| **Junheng** | Frontend, Seeker TWA, demo experience |

---

## License

[MIT](./LICENSE) — © 2026 Bundie. Open-source as part of the Colosseum Frontier Hackathon submission.
