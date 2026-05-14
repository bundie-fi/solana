# Bundie — Platform Spec v1.0

**Status:** Locked for v1 build
**Last updated:** 2026-05-14
**Supersedes:** All prior framings in `MEMORY.md` (including `bundie_oneliner`)

---

## 1. Executive Summary

Bundie is a marketplace where retail traders price the probability of real-world events using LMSR-powered prediction markets, and AI agents pay micropayments to query those prices as live oracle data. Retail provides liquidity and price discovery; agents consume the signed price as a decision input. Same primitive, two paying customers.

v1 launches on Solana devnet with full functionality (~50 markets), then transitions to mainnet beta with capped position sizes. Trading is via LMSR; resolution supports both deterministic on-chain reads and LLM judge committees with a dispute layer; markets can be created permissionlessly. Pricing is published via an x402-enabled API.

**One-liner (locked):**

> Bundie is a marketplace where retail trades outcomes and AI agents pay to read the prices.

**Variant phrasings:**
- X bio: *"On-chain risk pricing for the agentic economy."*
- Verbal pitch: *"It's a market where retail trades outcomes and AI agents pay to read the prices."*
- Investor deck opener: *"Bundie is a marketplace where retail trades outcomes and AI agents pay to read the prices — every measurable event has a market price on Solana, and agents pay $0.001 per query to know what it is."*

---

## 2. The Thesis

### What we believe

1. Prediction markets are an underused oracle. Real money pricing real outcomes is the most credible probability signal.
2. AI agents on x402 / pay.sh / MCPay desperately need a programmatic way to price uncertainty before paying for services.
3. The right product structure has two paying customers on opposite sides of the same primitive: retail traders pay spread; AI agents pay per query.
4. LMSR + deterministic resolvers + LLM judges (with dispute layer) means we can ship a full event venue without a B2B sales motion or institutional underwriters.
5. Market price = the data layer. We don't produce probabilities from a single model; the market does, and Bundie just signs and serves the market's answer.

### What we are NOT

- Not a hedge venue for protocols (v1)
- Not a derivatives exchange or perps platform
- Not a Polymarket / Kalshi aggregator (Capitola, Predictefy, Polymark.et already exist)
- Not a DAO governance product
- Not an AI agent trading bot
- Not a single AI oracle producing prices unilaterally (the market produces the price; we just sign and serve)

---

## 3. Product Architecture

```
                  RETAIL TRADERS                       AI AGENTS
                  (mobile + web)                       (Olas, ElizaOS, pay.sh users)
                          │                                    │
                          ▼                                    ▼
                  TRADE YES/NO SHARES                  GET event-price via x402
                  (≈1% spread)                         ($0.001 per call)
                          │                                    │
                          ▼                                    ▼
            ┌─────────────────────────────────────────────────────────────┐
            │                  ON-CHAIN (SOLANA)                          │
            │                                                             │
            │   prediction_market (LS-LMSR)        ── trades, prices      │
            │   market_factory                     ── permissionless mkts │
            │   position_token (NFT/SPL)           ── transferable claims │
            │   resolver_registry                  ── resolver configs    │
            │   dispute_layer                      ── bond-based appeals  │
            └────────────────────────────┬────────────────────────────────┘
                                         │
                  ┌──────────────────────┴─────────────────────────┐
                  │              OFF-CHAIN BACKEND                 │
                  │                                                │
                  │  • Indexer (RpcFast program-account streams)   │
                  │  • Deterministic resolver workers              │
                  │  • LLM judge committee (3-of-N signatures)     │
                  │  • Price signer (signs prices for API)         │
                  │  • x402 settlement adapter                     │
                  │  • Public REST/GraphQL/WSS API                 │
                  └────────────────────────────────────────────────┘
```

Two payment flows. One primitive underneath.

---

## 4. Personas & User Journeys

### 4.1 Retail Trader (Aria)

**Profile:** 28-year-old Solana-native, Phantom or Seeker wallet, $1k–$10k crypto liquidity, follows DeFi Twitter, has used Polymarket but wants Solana-native + lower fees + different event types.

**Job-to-be-done:** Speculate on real-world outcomes where she has an informed view, fast settlement, zero KYC.

**Journey:**

1. Opens Bundie mobile (Seeker TWA or PWA). Wallet auto-connects via Wallet Standard.
2. Scrolls feed of live markets — each shows YES/NO price, depth, 24h change.
3. Reads *"Will Anthropic API have >5 min downtime this week?"* — current YES at $0.034.
4. She knows Anthropic shipped a new model two days ago, suspects elevated downtime risk → buys $50 of YES at $0.034.
5. Position open; live P&L in her portfolio.
6. Friday: Anthropic has a 12-min outage → resolver signs → market resolves YES → her position settles at $1.47K.
7. Withdraws to Phantom.

**What she pays Bundie:** ≈1% spread on entry + exit (≈$0.50 on a $50 trade).

### 4.2 AI Agent / Framework (Olas-hosted, Aurora)

**Profile:** Agent operating on Olas, x402-enabled wallet with USDC, runs customer service workflows that need OCR + translation + voice.

**Job-to-be-done:** Choose the most reliable API provider for each step before paying.

**Journey (programmatic, no UI):**

```
1. Agent about to call an OCR API. Wants to compare providers.

2. Agent → Bundie API:
   GET /v1/event-price?id=ocr_provider_A_uptime_24h
   X-PAYMENT: <x402-signed-tx-for-0.001-USDC>

3. Bundie → Agent:
   {
     "event_id": "ocr_provider_A_uptime_24h",
     "price": 0.964,
     "confidence": 0.78,
     "depth_usd": 12500,
     "twap_24h": 0.961,
     "last_change_24h": +0.003,
     "signed_attestation": "<bundie_sig>"
   }

4. Agent compares to Provider B (another $0.001 query) → picks B.

5. Agent pays Provider B for the actual OCR call via x402.

Net: $0.002 on intelligence, avoided 3.6% failure rate on a $0.05 OCR call.
ROI ≈ 9×.
```

**What it pays Bundie:** $0.001/query, paid via x402. No account, no API key, no signup.

---

## 5. Core Primitives

### 5.1 LS-LMSR Markets

- One market per event (binary YES/NO in v1; scalar markets supported)
- LMSR liquidity parameter `b = 100–500` USDC per market; max bookmaker loss `b · ln(2) ≈ $69–$346` for binary
- Bundie funds `b`; reclaims it after resolution if no losses
- Trading spread: 1% (0.5% buy-side + 0.5% sell-side) added to LMSR price
- Position represented as fungible YES/NO mint or position NFT depending on UX choice

### 5.2 Market Price Oracle

- Off-chain backend signs each market's current price every slot (~400ms via RpcFast subscriptions)
- Signed price queryable via API; signature verifiable on-chain for full-trust integrations
- Each price response includes: spot, 24h TWAP, depth (USD), confidence (0–1), last 24h change, signed attestation

### 5.3 x402 Micropayment Layer

- Standard x402 protocol (Coinbase-backed, USDC settlement on Solana)
- Per-call price configurable per endpoint
- No API keys, no accounts, no signups
- High-frequency integrations via WebSocket subscriptions billed per minute

### 5.4 Deterministic On-Chain Resolvers

- Hardcoded resolver functions for events with mechanical triggers
- Examples: read Kamino TVL account; read Pyth USDC/USD feed; ingest StatusPage JSON
- When trigger met, resolver submits resolution; LMSR settlement is automatic

### 5.5 LLM Judge Committee

For non-deterministic events (ambiguous outcomes, judgment-based, multi-source):

- 3 independent LLM resolvers per event (Claude / GPT / Gemini)
- 2-of-3 must sign the same resolution
- Each resolver pulls from a predefined source set, returns structured JSON
- Resolver disagreement → automatic 24h delay + manual review by Bundie team
- Per-resolver track records published; consistently-disagreeing resolvers slashed

### 5.6 Dispute Layer

- Required for LLM-judged events (deterministic events skip this)
- 24h dispute window after AI resolution submission
- Challenger posts bond (5% of total YES+NO volume, capped at $5K)
- If challenge succeeds: AI resolution overturned; challenger keeps bond + 50% of slashed resolver stake
- If challenge fails: challenger loses bond

---

## 6. Event Class Taxonomy

### 6.1 Safe-class events (v1 listing)

Events where no single retail-scale trader can cause the outcome:

| Class | Example | Resolver |
|---|---|---|
| Stablecoin depeg | "Will USDC < $0.99 for >30 min in next 30d?" | Pyth feed reader (deterministic) |
| AI API uptime | "Will Anthropic API have >5 min downtime this week?" | StatusPage JSON poller (deterministic) |
| Cloud uptime | "Will AWS us-east-1 have an incident >30 min this month?" | AWS Health Dashboard poller (deterministic) |
| Aggregate protocol TVL | "Will Kamino TVL drop >$50M in any 24h window this quarter?" | On-chain TVL reader (deterministic) |
| Oracle deviation | "Will Pyth SOL/USD deviate >50bps from CEX TWAP for >5 min next 30d?" | Pyth + Bundie indexer (deterministic) |
| Weather | "Will it rain >0.5\" in Austin on the night of SXSW Friday?" | Public weather API (deterministic) |
| Public macro | "Will the next FOMC raise rates >25 bps?" | Press release scraper (LLM judge) |
| Service quality | "Will OpenAI's released model X outperform Claude on benchmark Y?" | LLM judge (3-of-3 from benchmark results) |

### 6.2 Risky-class events (deferred or never listed)

- Specific protocol exploits (one attacker could trigger)
- Thin-token price targets (one whale can move underlying)
- Specific person's actions
- Anything resolved entirely by single-source human judgment

### 6.3 Initial 50 markets (curated launch)

20 DeFi-flavored + 20 AI/cloud infra + 10 public/macro/weather. Curated by Bundie team; permissionless creation opens after Week 6.

**DeFi (20):** USDC/USDT/USDe/PYUSD depeg variants × multiple windows; Kamino/MarginFi/Drift/Save TVL drop events × multiple windows; Pyth deviation events for SOL/ETH/BTC; JitoSOL/mSOL discount events.

**AI/cloud (20):** Anthropic/OpenAI/Gemini API downtime × weekly + monthly; AWS us-east-1, GCP, Azure, Cloudflare, Stripe, Vercel incident events; Pyth and Switchboard outage events.

**Public/macro/weather (10):** FOMC rate decisions, public crypto regulator announcements, weather at major event venues, Solana network outage events.

---

## 7. Resolution Mechanism

### 7.1 Deterministic resolvers

For events with mechanical triggers (Pyth feed below threshold, TVL drop, status-page incident):

- Resolver worker polls data source on a schedule
- When trigger condition met, resolver signs resolution and submits on-chain
- LMSR settlement is immediate; YES holders paid $1/share, NO holders paid $0
- No dispute window for deterministic resolutions

### 7.2 LLM judge committee

For events requiring interpretation:

- 3 LLM resolvers (Claude, GPT, Gemini) configured per event class
- Each resolver receives a structured prompt + source URLs + resolution criteria
- Each resolver returns a structured JSON resolution
- 2-of-3 must match for resolution to proceed
- Resolution is submitted on-chain with a 24h dispute window
- After dispute window with no challenge, settlement occurs

### 7.3 Dispute resolution flow

1. Resolver committee submits resolution → event enters disputable state
2. Anyone can challenge by posting bond (5% of volume, capped $5K)
3. If challenged: Bundie team + community review evidence within 24h
4. Final resolution submitted; bond winner determined
5. Settlement executes

### 7.4 Resolver reputation

Per-resolver track records are public:

- Total resolutions submitted
- Disputes filed against
- Disputes won
- Slashing events

Consistently-disagreeing or consistently-disputed resolvers are slashed; their stake is redistributed to challengers and Bundie's treasury.

---

## 8. API Specification

### 8.1 Public endpoints

```
GET /v1/events
  Returns: list of all live events with current price, depth, window
  Cost: free (rate-limited to 60/min/IP)

GET /v1/event-price?id=<event_id>
  Returns: { price, confidence, depth_usd, twap_24h, last_change_24h,
            trade_count_24h, unique_traders_24h, spot_vs_twap_pct,
            signed_attestation, as_of }
  Cost: $0.001 USDC via x402

GET /v1/event-history?id=<event_id>&window=24h|7d|30d
  Returns: price time series with hourly granularity
  Cost: $0.005 USDC via x402

GET /v1/event-detail?id=<event_id>
  Returns: full event metadata (description, resolver, trigger, window,
           trades, depth, resolver track record)
  Cost: $0.002 USDC via x402

WSS /v1/stream
  Subscribe to live price updates for one or more events
  Cost: $0.01 USDC per minute of connection

POST /v1/event-propose                          (v1.5)
  Anyone can propose a new market with a bond
  Cost: $50 USDC bond + $0.10 USDC creation fee
```

### 8.2 Response format

```json
{
  "event_id": "anthropic_api_downtime_5min_weekly",
  "description": "Anthropic API downtime >5 min in any rolling 7-day window",
  "window_start": "2026-05-14T00:00:00Z",
  "window_end": "2026-05-21T00:00:00Z",
  "price": 0.034,
  "confidence": 0.78,
  "depth_usd": 12500,
  "trade_count_24h": 142,
  "unique_traders_24h": 38,
  "twap_24h": 0.031,
  "last_change_24h": 0.003,
  "spot_vs_twap_pct": 0.097,
  "resolver_class": "statuspage_poller",
  "resolver_track_record": { "total": 142, "disputed": 3, "lost": 0 },
  "signed_attestation": "<base64-sig>",
  "as_of": "2026-05-14T19:32:00Z"
}
```

`confidence` is a function of `depth_usd`, `trade_count_24h`, and `unique_traders_24h`. Thin markets get low confidence. Agents filter on this field.

### 8.3 x402 settlement

- Every priced endpoint accepts `X-PAYMENT` headers per the x402 spec
- USDC settles to Bundie's treasury wallet on Solana
- No keys, no rate limit beyond x402 capacity
- Free tier: 10 queries/hour per IP (for dev / discovery)

### 8.4 SDK

```
@bundie/sdk (TypeScript, generated from Codama)
  await bundie.eventPrice("anthropic_api_downtime_5min_weekly")
  await bundie.subscribe(["..."])
  await bundie.proposeEvent({...})

bundie-rs (Rust, for on-chain integrators)
  Same surface, on-chain price verification helpers
```

---

## 9. On-Chain Architecture

### 9.1 Programs

| Program | Status | What it does |
|---|---|---|
| `prediction_market` | Repurpose existing | LS-LMSR pricing engine, trade execution, settlement, binary + scalar markets |
| `market_factory` | **New** (~250 lines) | Permissionless market creation with creator bonds and fee splits |
| `position_token` | Repurpose existing (was `strategy_token`) | Transferable YES/NO position tokens |
| `resolver_registry` | **New** (~150 lines) | Maps event_id → resolver config (deterministic / LLM-judge / source URLs / parameters) |
| `dispute_layer` | **New** (~400 lines) | Bond-based dispute window for LLM-judged events |
| `agent_registry` | **New** (~150 lines) | Registers resolver signing keys and committee membership |

### 9.2 Cuts and renames

- ❌ `prediction_market` "predict-on-AI-agents" semantic — removed
- ❌ `strategy_token` "AI strategy share" branding — renamed to `position_token`
- ❌ bUSD seed faucet — removed
- ❌ Beethoven CPI scaffolding — removed (already unused per memory)
- ❌ Predict/Earn dual-mode UI — removed

---

## 10. Off-Chain Components

### 10.1 Recommended stack

```
Frontend:        framework-kit (Next.js + Wallet Standard)
On-chain dev:    Anchor (new programs), Codama (generated clients)
RPC + indexing:  RpcFast (mainnet + devnet), program-account subscriptions
Oracles:         Pyth (primary), Switchboard (secondary cross-check)
Testing:         LiteSVM (unit), Mollusk (instruction), Surfpool (integration)
Mobile:          Solana Mobile / Seeker SDK + PWA fallback
Identity:        SNS (.sol names) for trader handles
Treasury:        Squads multisig for revenue + LMSR funding
Payments:        x402 reference implementation + native USDC settlement
```

### 10.2 Backend (`packages/backend`, Hono on Railway)

- Public REST + GraphQL + WebSocket API
- x402 settlement adapter (USDC settlement on Solana, no account creation)
- Indexer for on-chain market state and trade events (driven by RpcFast streams)
- Deterministic resolver workers (one per event class; runs as cron + webhook)
- LLM judge committee orchestrator (calls 3 LLM resolvers in parallel, validates 2-of-3 match)
- Price signer (signs each market price every slot)

### 10.3 Frontend split

| Surface | Path | Purpose |
|---|---|---|
| `bundie.fi` | `packages/web` | Web trading UI, event browser, account |
| Bundie mobile | Same `packages/web` PWA, Seeker TWA wrapper | Mobile-first trading UI |
| `docs.bundie.fi` | `packages/landing-page` rewritten | API docs, SDK quickstart, dev onboarding |
| `bundie.fi/markets/<id>` | `packages/web` | Public market detail pages (SEO indexable) |

### 10.4 Resolver infrastructure (per event class)

Each event class ships with a dedicated resolver worker:

| Event class | Resolver type | Frequency | Resolution type |
|---|---|---|---|
| Stablecoin depeg | Pyth feed reader | Every slot | Deterministic |
| Protocol TVL drop | On-chain account reader (RpcFast streams) | Every 1 min | Deterministic |
| Oracle deviation | Pyth + CEX TWAP comparator | Every 1 min | Deterministic |
| AI/cloud uptime | StatusPage / public API poller | Every 1 min | Deterministic |
| Weather | Public weather API poller | Every 5 min | Deterministic |
| Macro events | LLM committee (3-of-3 cross-source) | Per event | LLM judge |
| Service quality | LLM committee (benchmark scrape) | Per event | LLM judge |

---

## 11. Anti-Gaming Mitigations

### 11.1 Product-level

- **Confidence intervals** in API (depth + trade count + unique trader count)
- **TWAP alongside spot** (agents use TWAP for decisions; manipulation shows as spot vs TWAP divergence)
- **Position holding minimum**: 5 min between buy and sell on a position (deters flash manipulation)
- **New account position limits**: max $500 position size for first 30 days
- **Per-event max position size**: caps single-actor influence (configurable per event)
- **Event-class filtering**: only safe-class events listed in v1 curation
- **Resolver track records**: published; consistently-disputed resolvers slashed
- **Dispute layer**: any LLM-judged resolution can be challenged

### 11.2 Trust signals in API

Every price response includes:

```
depth_usd             // total USDC in this market
trade_count_24h       // trades in last 24h
unique_traders_24h    // distinct addresses
time_since_last_trade
spot_vs_twap_24h_pct  // suspicious if large
resolver_track_record // historical accuracy
```

Agents filter aggressively: *"If depth < $1k or unique_traders_24h < 10, ignore this price."*

### 11.3 Accepted

Insider trading is fine — it's how prediction markets discover truth. We don't try to prevent it; we let market price reflect informed bets.

---

## 12. Liquidity Model

### 12.1 LMSR per-market cost

Each market has a fixed `b` parameter. Max loss = `b · ln(2)` for binary.

| `b` (USDC) | Max loss | Use case |
|---|---|---|
| 100 | $69 | Small / experimental markets |
| 500 | $347 | Standard launch markets |
| 2,000 | $1,386 | High-confidence demand markets |
| 200 max for permissionless | $139 max loss | Creator-spawned markets |

### 12.2 Subsidy ceiling

- 50 launch markets × $500 b-param = **$25K LMSR exposure**
- Worst case (all markets resolve adversely): ~$17K loss
- 500 markets at scale: $250K exposure, ~$170K worst-case
- Bounded operational cost, not runaway risk

**Initial treasury allocation:** $50K USDC for v1 LMSR funding.

### 12.3 Trading spread covers cost

A 1% spread on $100K monthly volume = $1K revenue. At 100K monthly volume, breakeven on LMSR cost of 50 markets. Volume above this is pure margin.

---

## 13. Revenue Model

| Stream | Pricing | Year 1 target ARR | Year 2 target ARR |
|---|---|---|---|
| Trading spread | 1% on LMSR trades | $150K | $1.5M |
| x402 query fees | $0.001–0.01 per call | $50K | $1.5M |
| Premium API subscription | $99–$999/mo for high-volume agents | $0 in v1 | $500K |
| Market creator fees (v1.5) | Bundie keeps 50% of creator-fee share | $20K | $200K |
| Resolver participation fees | Take of premium routed to third-party resolvers | $0 | $300K |
| **Total ARR** | | **~$220K** | **~$4M** |

Y1 target assumes mainnet beta launching at Week 4-6, public GA at Week 10, momentum compounding over Q3-Q4.

---

## 14. Go-To-Market

### 14.1 Phase 1 — Devnet (Weeks 1–4)

**Goal:** Full system live on devnet for validation + framework SDK integrations.

- Ship complete platform on devnet (programs + backend + frontend)
- ~50 markets running with test USDC
- DM agent framework teams (Olas, ElizaOS, Solana Agent Kit, Theoriq) — invite them to build SDK plugins against devnet
- Internal QA + load testing
- Record demo videos for Anchorage / VC outreach
- **Win condition:** 2 framework teams have SDK plugins in-progress against devnet by end of Week 4

### 14.2 Phase 2 — Mainnet beta (Weeks 4–10)

**Goal:** Real USDC trading with capped positions; first paying agents.

Hard caps:
- Max trader position: $500
- Max Bundie LMSR per market: $1K
- Max markets live: 20 curated → growing weekly
- Trading geofenced (jurisdictions TBD with legal)
- Agent API global from day 1 of mainnet (data, not gambling)

Activities:
- Launch on Seeker + web PWA
- Content marketing: DeFi risk postmortems, AI infra status tracking
- KOL partnerships with DeFi Twitter risk educators
- Submit MCPay listing (easier than pay.sh first)
- Co-marketing piece with Pact

**Win condition:** 500 traders, $50K trading volume, 10K x402 queries/month, $5K cumulative revenue, 1 framework SDK live in production

### 14.3 Phase 3 — Mainnet GA + permissionless creation (Weeks 10–24)

**Goal:** Caps lifted; permissionless market creation opens; major distribution.

- Caps gradually loosened as anti-gaming data accumulates
- Permissionless market creation opens (with $50 USDC bond per market)
- Submit pay.sh listing
- Apply to Anchorage Digital Ventures, Multicoin, a16z Crypto Fund 5
- Pact integration querying Bundie's API in production

**Win condition:** 1,000+ active monthly traders; 100K x402 queries/month; 2 framework integrations live; $20K MRR run-rate; institutional check signed

---

## 15. Pact Partnership

Pact is your friend's company. It sits one layer next to Bundie on the agent-economy stack: Pact insures the agent's API call against SLA failure; Bundie prices the API's expected reliability before the call. Complementary, not competitive.

### 15.1 Pattern A — Pact uses Bundie's API to price its coverage (fastest)

**Pitch:** Pact charges premium based on observed uptime. Bundie has live market-priced forward uptime expectations. Pact integrates Bundie's price as an input to its premium formula — captures forward-looking risk (e.g., new model launches that spike downtime) better than trailing uptime alone.

**Mechanics:** Pact queries `GET /v1/event-price?id=<api>_uptime_<window>` via x402 ($0.001/query). Pact's premium formula becomes `BaseRate × ReliabilityMultiplier × BundieForwardRiskAdj × CoverageTier`.

**Why it's fast:** Pact's classifier already runs per call; adding a Bundie query is ~1 day for them, zero on Bundie's side.

**Value:** Pact's pricing sharpens; Bundie gets its first marquee agent-economy customer.

### 15.2 Pattern B — Pact's coverage pool buys hedges from Bundie's markets (medium-term)

**Pitch:** Pact's pool absorbs all tail risk. When a specific API has elevated risk, Pact buys YES on the corresponding Bundie market to hedge. Bundie's markets become Pact's reinsurance layer.

**Why it matters:** Pact's whitepaper notes a per-event cap of 30% of pool capital. Bundie hedges let them safely exceed that cap.

### 15.3 Pattern C — Joint Anchorage submission + co-marketing (ambitious)

**Co-authored framing:** *"The Reliability Stack for the Agentic Economy"* — pay.sh = rails, Bundie = forward reputation pricing, Pact = chargeback safety net. Together: the full stack making agent-to-agent commerce production-ready.

**Mechanics:** Co-authored Anchorage submission. Joint X / blog launch. Cross-link SDKs and docs. Possibly a bundled discount for joint customers.

**Why:** Two startups telling the same story to Anchorage is more credible than one. Pact already hits "Agent-to-Agent Settlement Rails"; Bundie hits four other RFS bullets. Together: 5 RFS bullets in one stack story.

### 15.4 Sample first DM to the Pact founder

> *Hey [name] — saw your x402 chargeback piece, big fan of the architecture. I'm building something that sits one layer next to you: live market-priced uptime/quality expectations for the APIs your agents call. Solana-native, queryable via x402 micropayments ($0.001/call). I think Pact's premium formula could integrate our forward-risk number as an input — captures stuff your trailing observed uptime can't (e.g., model launches that spike downtime risk). Devnet's live this week. Want to grab 20 min to walk through? Could be a joint case study + co-marketing angle once both shipped.*

### 15.5 Sequencing

1. **This week**: send Pattern A DM. Easy ask, fast yes/no.
2. **Mainnet beta (Week 4-6)**: Pact starts querying Bundie's API.
3. **Joint case study published when first 1000 calls flow.**
4. **Once both have traction**: explore Pattern B (Pact hedges its pool) and Pattern C (joint Anchorage submission).

### 15.6 Boundaries

- Don't promise Pact exclusivity on Bundie's pricing — other insurance/refund products will want the same data.
- Don't commit to identical event definitions until both teams sit down — definitions matter, edge cases bite.
- Don't bundle pricing in v1 — both products need standalone revenue stories for fundraising.

---

## 16. Roadmap

```
v1   (Weeks 1–10)      ────── Devnet validation → mainnet beta with caps.
                                 LS-LMSR markets, deterministic + LLM-judged
                                 resolvers, dispute layer, permissionless
                                 creation, x402 API, mobile + web.

v1.5 (Weeks 10–24)     ────── Caps lifted. Permissionless market creation open.
                                 Agent framework integrations live. Anchorage
                                 application submitted. Pact integration live.

v2   (Months 6–12)     ────── Scalar markets at scale. B2B hedge product
                                 layered on top of liquid markets. Resolver
                                 reputation marketplace (third-party LLM judges
                                 register, earn fees, build track records).

v3   (Months 12+)      ────── Conditional / futarchy markets. Cross-chain
                                 price oracles. White-label deployments for
                                 partners. SDK in major agent framework
                                 standard libraries.
```

---

## 17. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Thin markets are noisy; agents don't trust price | **High** | Confidence intervals + TWAP in API; subsidize liquidity on highest-query events |
| Regulatory: retail event-betting in some jurisdictions | **High** | Geofence trading-side mobile app to crypto-friendly geos. API side is global (data sale, not gambling). $50–200K legal budget. |
| LLM judge mis-resolution causes large payout | **High** | 2-of-3 committee + dispute layer + per-resolver track record + slashing |
| Whale market manipulation | Medium | LMSR makes attack cost-linear; confidence intervals expose it; position holding minimums |
| Polymarket / Kalshi expand to Solana | Medium | Different event focus (DeFi + AI infra + agent API); Solana-native UX |
| Liquidity bootstrap slower than expected | Medium | Bounded LMSR exposure; subsidize where queries land; cut markets that don't get traction |
| Resolution edge cases / disputes | Medium | Dispute layer handles edge cases; permissionless creation limits Bundie's curation liability |
| pay.sh / MCPay don't list Bundie | Low–Medium | Direct SDK distribution to agent frameworks works even without marketplace listing |
| Devnet validation reveals architectural issues | Low | Devnet phase is the catch-net before real money is at stake |

---

## 18. Success Metrics (90 days)

| Metric | Target | Threshold for momentum |
|---|---|---|
| Devnet markets running | 50 | 30 |
| Framework SDK integrations | 2 live + 2 in progress | 1 live |
| Mainnet beta traders | 1,000 | 500 |
| Mainnet trading volume | $200K total | $100K |
| Markets live (mainnet beta + GA) | 50+ | 20 |
| x402 query volume | 100K/month by Day 90 | 25K/month |
| Trading-fee revenue | $20K cumulative | $5K |
| Query-fee revenue | $5K cumulative | $1K |
| Pact integration in production | Yes | DM sent + scoping call |
| Anchorage application submitted | Yes | Yes |

**5+ of 10 metrics hit** → momentum signal, raise seed
**3–4 of 10** → diagnose and iterate
**0–2 of 10** → framing was wrong, pivot honestly

---

## 19. Anchorage Pitch (one paragraph)

> Bundie is a Solana marketplace where retail traders price the probability of real-world events using LMSR markets, and AI agents pay x402 micropayments to query those prices as live oracle data. We're live with 50+ event markets across DeFi events, AI/cloud infrastructure uptime, and public macro outcomes; resolution uses both deterministic on-chain readers and LLM judge committees with a dispute layer. Listed on MCPay for agentic queries, with Olas and ElizaOS SDK integrations shipping. Pact (your portfolio? — verify) queries our API to price its x402 SLA refund coverage. We hit four Anchorage RFS bullets directly: AI Oracles & Event Resolution, Agent-to-Agent Settlement Rails, Prediction Market Credit Layers, and B2B Information Finance. Retail trading provides liquidity and price discovery; agents provide scalable revenue as the agentic economy grows. We're raising $X to scale our event registry, ship permissionless market creation at full scale, and integrate with the major agent frameworks.

---

## 20. What We Cut From Prior Drafts

| Cut | Why it stays cut |
|---|---|
| B2B Bundie Pro web dashboard | Once markets are liquid, protocols can hedge via trading. Dashboard is a sales surface, not a product. Build when sales motion warrants. |
| Retail "underwriter" vs "trader" split | Same product surface. Collapsed into one trading UI. |
| AI agent NAV/reputation markets as separate vertical | One event class among many. Let it emerge if agents query it. |
| DAO governance flow | Slow cycle. Treasuries can trade existing markets without custom UX. |
| Multi-leg hedge structurer | v3 product on top of liquid markets. |
| Conditional / futarchy markets | v3 — valuable after 100+ liquid base markets exist. |
| AI agent reputation leaderboard | Defer; prove demand for event prices generally first. |
| AI structurer / natural-language hedge builder | v3 — premature without base market liquidity. |
| Strategy Token as "AI strategy share" branding | Renamed to `position_token`; semantic change only. |
| Predict/Earn dual-mode UX (gold/purple) | One trading product surface. Deleted. |
| bUSD seed faucet | Devnet test USDC + real USDC. No fake-stablecoin theater. |

---

## 21. Codebase Migration

### 21.1 Repurposed (≈55%)

- `programs/prediction_market` → LS-LMSR market with generalized event-class init (supports binary + scalar)
- `programs/strategy_token` → renamed `position_token`
- NAV oracle + on-chain readers → resolver implementations for deterministic events
- `packages/backend` → public API + indexer + resolver workers + LLM judge orchestrator
- `packages/common` → `@bundie/sdk` on npm (Codama-generated)
- `chaos-sim` runtime → demoted to internal testbench (dogfooding the SDK)

### 21.2 New (≈35%)

- `programs/market_factory` (~250 lines)
- `programs/resolver_registry` (~150 lines)
- `programs/dispute_layer` (~400 lines)
- `programs/agent_registry` (~150 lines)
- Public x402-enabled REST/GraphQL/WSS API
- Price signer service
- Resolver workers (one per event class)
- LLM judge committee orchestrator
- Event registry browser (web)
- Mobile trading PWA / Seeker TWA
- Bundie API documentation site

### 21.3 Deleted (≈10%)

- bUSD seed faucet
- Predict/Earn dual-mode UI components (gold/purple)
- Beethoven CPI scaffolding
- Existing predict-on-AI-agents landing copy

### 21.4 Build estimate (timeline-flexible)

- On-chain (extend `prediction_market`, add 4 small programs): 1–2 weeks
- Off-chain backend (API + indexer + resolvers + LLM committee): 2–3 weeks
- Mobile + web trading UI: 2–3 weeks
- Devnet integration + framework SDK partners onboarded: 1 week
- Mainnet beta launch + caps + monitoring: 1 week

Total: focused execution lands a complete v1 (with LLM judges + dispute + permissionless creation) in 7–10 weeks.

---

## 22. Open Questions to Resolve Before Mainnet

- [ ] Legal structure: who owns Bundie's treasury wallet? Bermuda reinsurer needed for retail trading geo?
- [ ] Geofencing list: which retail jurisdictions are go vs no-go?
- [ ] Per-event creator bond size: $50 default OK or scale by event size?
- [ ] LLM judge committee: which 3 model providers? (Recommended: Claude / GPT / Gemini — diversify)
- [ ] Resolver reputation: public dashboard or private to Bundie team initially?

---

## End of Spec

Locked components for v1 build:

- ✅ LS-LMSR markets (binary + scalar)
- ✅ Deterministic resolvers
- ✅ LLM judge committee + dispute layer
- ✅ Permissionless market creation (Week 6 onward)
- ✅ x402 API + Codama-generated SDK
- ✅ RpcFast for RPC + indexing
- ✅ Devnet-first launch sequence
- ✅ Mobile (Seeker TWA + PWA) + web trading UI
- ✅ Pact partnership pattern A (Bundie API as input to Pact's premium pricing)

Build starts today.
