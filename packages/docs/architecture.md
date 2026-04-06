# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────┐
│                    Solana Devnet                      │
│                                                       │
│  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ Strategy Token    │  │ Prediction Market         │  │
│  │ Program           │  │ Program                   │  │
│  │                   │  │                           │  │
│  │ • create_strategy │  │ • create_market           │  │
│  │ • buy_shares      │  │ • buy_shares (LS-LMSR)   │  │
│  │ • redeem_shares   │  │ • sell_shares             │  │
│  │ • rebalance       │  │ • resolve (oracle-free)   │  │
│  │ • update_nav      │  │ • redeem                  │  │
│  └────────┬─────────┘  └──────────┬───────────────┘  │
│           │                        │                   │
│           │    Beethoven CPI       │  reads NavOracle  │
│           ▼                        │                   │
│  ┌──────────────────┐             │                   │
│  │ Kamino (Lending)  │◄───────────┘                   │
│  └──────────────────┘                                 │
└─────────────────────────────────────────────────────┘
          ▲                    ▲
          │ RPC                │ RPC
          │                    │
┌─────────┴────────────────────┴──────────┐
│            Hono Backend (Railway)         │
│                                           │
│  /api/strategies  — fetch + create        │
│  /api/markets     — prediction markets    │
│  /api/portfolio   — wallet positions      │
│  /api/tx          — build, simulate, send │
│                                           │
│  Supabase (Railway) — caching, metadata   │
└──────────┬──────────────────┬────────────┘
           │                  │
           ▼                  ▼
┌──────────────────┐ ┌──────────────────┐
│   Next.js Web    │ │   Expo Mobile    │
│   (Railway)      │ │   (Seeker/Play)  │
│                  │ │                  │
│ • Discover       │ │ • Discover       │
│ • Strategy Detail│ │ • Markets        │
│ • Markets        │ │ • Portfolio      │
│ • Portfolio      │ │ • Strategy Detail│
└──────────────────┘ └──────────────────┘
```

## Data Flow

### Strategy Creation
1. User/agent calls `create_strategy` on-chain
2. Program creates Strategy PDA, mints SPL token, initializes NavOracle
3. Initial deposit routed via Beethoven CPI to Kamino
4. Strategy appears on Discover leaderboard

### Buying Strategy Shares
1. User deposits capital via `buy_shares`
2. Program calculates shares: `amount * total_shares / current_nav`
3. Capital routed to protocol via Beethoven
4. Strategy shares minted to buyer

### Prediction Market Flow
1. Anyone creates market: "Will strategy X exceed Y% APY by slot Z?"
2. Buyers purchase YES/NO shares at LS-LMSR prices
3. At resolution slot, anyone calls `resolve` (permissionless)
4. Program reads NavOracle TWAP, compares to threshold
5. Winners redeem shares for payout

### NAV Oracle (Oracle-Free Resolution)
- `update_nav` snapshots portfolio value into TWAP accumulator
- TWAP prevents manipulation via single-block spikes
- Prediction markets read TWAP at resolution for settlement
- No Pyth, no Switchboard, no external dependency

## Account Structure

### Strategy Token Program
- **Strategy** — PDA seeded by `[b"strategy", creator, name]`
- **NavOracle** — PDA seeded by `[b"nav", strategy]`
- **Wallet** — PDA seeded by `[b"wallet", strategy]` (holds funds)
- **Mint** — Standard SPL token mint (authority = Strategy PDA)

### Prediction Market Program
- **Market** — PDA seeded by `[b"market", strategy, question]`
- **Vault** — Token account holding market collateral

## LS-LMSR Pricing

Cost function: `C(q) = b(q) * ln(Σ e^(q_i / b(q)))`

Where:
- `q_i` = shares outstanding for outcome i
- `b(q) = α * Σq_i` (liquidity scales with volume)
- `α` = tuning constant

Binary market simplification:
- `price_yes = 1 / (1 + e^((q_no - q_yes) / b))`
- This is a sigmoid — prices always between 0 and 1

Critical constraint: Must fit within Solana's 1.4M CU budget.
