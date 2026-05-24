# Bundie — Pitch Deck (oracle-focused, 2-min)

> **One-liner:** Bundie is an oracle that prices the future using prediction markets — live
> markets on on-chain DeFi outcomes, settled by reading Solana state (no oracle, no committee),
> read by AI agents over x402.
>
> **Category claim:** *Oracles price the present. Bundie prices the future.*
>
> **Spine:**
> - **Supply** — live on-chain DeFi metrics (TVL, utilization, LST par, funding, depeg). No agents to create; infinite, chain-readable supply.
> - **Product** — one LMSR market per metric → signed price = implied probability.
> - **Resolution** — read Solana state at the slot. No Pyth-the-product, no committee.
> - **Demand** — external AI agents pay $0.001 over x402 to read the price before they act.
> - **Moat** — the price settles from the same chain the outcome lives on. Only works on Solana.
>
> **Cut from prior versions:** user-facing agent creation (off-message — split "agent"
> between subject and reader). Agent-performance is now ONE example market category, run on
> 1–2 house agents, not a feature users invoke.
>
> **Format:** Pitch is **2 min max, no demo video.** Slides carry static screenshots in the
> video's place — **3 required (A, B, C) + 1 optional (D)**. They are marked
> `[[ SCREENSHOT X — PLACEHOLDER ]]` in the slides; drop the images in later (see Appendix B).
> Spoken script below is timed to ~2:00 at pitch pace.

---

## The 2-minute spoken script (rehearse to this)

> ~290 words. Flip slides on the cues. This is the deliverable that has to fit — the slides serve it.

**[S1 Cover · 0:00]** Bundie is an oracle that prices the future using prediction markets. Existing oracles price the *present* — what a token is worth right now. Bundie prices what's about to *happen*, and settles it on-chain.

**[S2 Problem · 0:12]** DeFi has a spot price for everything and a forward price for nothing. Will this pool's utilization spike? Will this LST lose its peg? Will this stablecoin slip this week? There's no tradeable probability — and the AI agents now moving real money on Solana have no way to price that risk before they act.

**[S3 How it works · 0:32]** Bundie opens a market on any on-chain DeFi metric. Retail trades YES or NO — that price *is* the market's implied probability. Agents pay a tenth of a cent over x402 to read it. Same primitive, two paying customers: traders provide the signal, agents consume it.

**[S4 Moat · 0:55]** Here's what nobody else does. This market — *will Kamino USDC utilization cross 90% this week* — settles by reading Kamino's account directly on Solana. No Pyth, no committee, no off-chain attestation. And here's an agent about to enter that pool: it queries Bundie, pays a tenth of a cent, reads the probability, routes around the risk. The oracle, being read, live.

**[S5–S6 Why now + edge · 1:25]** Jupiter just put Polymarket on Solana. The agent economy is here. But every market still trusts an external oracle to resolve. We read the chain instead — that's the whole moat, and it only works on Solana.

**[S8 Traction · 1:42]** Live on devnet: LMSR engine, on-chain settlement, x402 read API. One of 44 standouts from 2,857 Colosseum submissions. Backed by Superteam Malaysia.

**[S11 Close · 1:55]** Bundie. The oracle agents read to price the future.

> At 2:00 you've spoken S1, S2, S3, S4, S5/6, S8, S11. S7 (market) / S9 (model) / S10 (team) are **flip-past / leave-behind** slides — judges read them, you don't narrate them. Don't try to speak all 11.

---

## Slide 1 — Cover

**Bundie.** *(rabbit logo)*

**An oracle that prices the future.**

*Prediction markets on on-chain DeFi outcomes — settled by reading Solana, read by AI agents over x402.*

> *Oracles price the present. Bundie prices the future.*

- **1 of 44 standouts from 2,857 Colosseum submissions**
- Backed by Superteam Malaysia · Watched by Solana Foundation · 100+ builders on Telegram

`Colosseum Frontier · May 2026 · DeFi track`

---

## Slide 2 — The Problem

**DeFi has a spot price for everything and a forward price for nothing.**

- You can read the *present* on-chain — every balance, rate, and TVL is live.
- You cannot trade the *future* — there's no price for "will this pool's utilization spike," "will this LST depeg," "will this rate flip."
- And AI agents are now moving real money on Solana with **no way to price uncertainty before they transact.**

> *"Spot price for everything. Forward price for nothing."*
>
> **Oracles price the present. Bundie prices the future.**

---

## Slide 3 — How It Works

**One primitive, two paying customers.**

```
  Live on-chain DeFi metric        →   LMSR market   →   signed price (implied probability)
  (TVL · utilization · LST par                              │
   · funding · depeg)                            ┌──────────┴──────────┐
                                                 ▼                     ▼
                                        RETAIL trades YES/NO    AGENTS read via x402
                                        (~1% spread)            ($0.001 / query)
                                        provides the signal     consumes the signal
```

> *"Traders provide price discovery. Agents pay to consume it. Same market, two customers."*

---

## Slide 4 — The Moat  ⟨HERO — SCREENSHOTS⟩

**It settles itself.**

> **[[ SCREENSHOT A — PLACEHOLDER ]]** — a DeFi-outcome market card from `/markets/[id]`:
> an on-chain-resolved market (e.g. *"Will Kamino USDC utilization cross 90% this week?"*) with
> the green **"Settles on-chain"** badge, YES/NO price, and depth. *You'll drop this image in.*

> **[[ SCREENSHOT B — PLACEHOLDER ]]** — the agent read (the oracle moment): a terminal
> `curl /v1/event-price?id=...` with the `X-PAYMENT` header → signed JSON `{price, depth, signed_attestation}`.
> **The single most important frame.** *You'll drop this image in.*

- Resolves by **reading Kamino's account directly on Solana** at the resolution slot. No Pyth, no Switchboard, no committee, no off-chain attestation.
- `InsiderMarketForbidden` enforced at the program level (`target_agent != creator`) — a constraint, not a convention.

> Example category: **AI-agent strategy performance.** A live strategy's NAV is just another on-chain metric to price — relatable, and what Colosseum flagged. One of many subjects, not the whole product.

---

## Slide 5 — Why Now

**The resolution layer is the missing piece.**

- Jupiter integrated Polymarket on Solana (Feb 2026) — prediction markets are arriving here.
- The agent economy + x402 is live — agents need machine-readable price signals (77% of x402 volume is on Solana, Dec 2025).
- But every existing market still **trusts an external oracle or a human committee** to resolve.

> *"Bundie closes the loop: the market that prices a DeFi outcome settles from the same chain the outcome lives on."*

---

## Slide 6 — Competitive Landscape

**Everyone else trusts an oracle. We read the chain.**

| | On-chain DeFi outcomes | Self-resolving (reads chain) | x402 price-read API | Solana-native |
|---|:---:|:---:|:---:|:---:|
| **Bundie** | ✓ | ✓ | ✓ | ✓ |
| Polymarket | — | — (UMA optimistic oracle) | — | — |
| Kalshi | — | — (manual / regulated) | — | — |
| Solana PM entrants | partial | — (external oracle) | — | ✓ |

> *"For DeFi outcomes, reading the chain isn't a feature — it's the only honest way to resolve."*

---

## Slide 7 — Market  *(leave-behind, not narrated)*

**Three markets converging — no primitive at the intersection.**

- $17B+ combined Polymarket + Kalshi volume (Jan 2026)
- $240B Bernstein-projected prediction-market volume for 2026
- **$9B+ Solana DeFi TVL** — the universe of on-chain outcomes Bundie can price

> Bernstein projects prediction markets at $1T annually by 2030. Bundie owns the DeFi-native, self-resolving corner.

---

## Slide 8 — Traction  ⟨SCREENSHOTS⟩

**Built. Backed. Noticed.**

> **[[ SCREENSHOT C — PLACEHOLDER ]]** — home consensus strip / live-markets grid (app home), on-chain markets first with badges. *You'll drop this image in.*

**Built (live on devnet):**
- LMSR market engine + **oracle-free on-chain settlement** (Anchor: `create_event` / `resolve_event` read-from-chain; `commit_nav` / `resolve_market_v2` for strategy-NAV markets)
- x402 price-read API live (`/v1/event-price`, priced dynamically by market depth)
- Market subjects sourced from real on-chain DeFi state across Kamino, Marinade, Solend, Jito, Jupiter — **direct SDK reads, no CPI middleware**

**Backed:** $10K Superteam Malaysia grant (active) · Solana Foundation application in flight

**Noticed:** 1 of 44 standouts from 2,857 Colosseum submissions · pitched at Solana Day · 100+ builders in Telegram

---

## Slide 9 — Business Model  *(leave-behind, not narrated)*

**Two revenue lines on one primitive.**

| Line | Source | Unit economics |
|---|---|---|
| Trading spread | Retail YES/NO trades | ~1% per round-trip |
| **x402 query revenue** | Agents reading prices | $0.001 / call · WSS billed per minute |

TAM $2.4B (1% of $240B 2026 prediction volume) · SAM $24B · SOM Y3 $4.5–7.5M ARR.

> *"The query side scales with the agent economy, not with our headcount."*

---

## Slide 10 — Team  *(leave-behind, not narrated)*

**Returning Cypherpunk team — shipped on EVM, back on Solana with the right primitive.**

- **Yudhishthra** — Founder. Production eng at Etherscan & Nethermind; shipped Bundie EVM (5 integrations); co-built Yields.so.
- **Yee Chian** — Product & Growth. ex-CoinGecko.
- **Jun Heng** — Full-Stack. 1st place ETHGlobal Taipei 2025; president of APUBCC.

---

## Slide 11 — Close / CTA

**Read the future of DeFi with us.**

- **Trade** a DeFi outcome — `app.solana.bundie.fi`
- **Read** prices over x402 — docs at `solana.bundie.fi`
- **Build** — MIT-licensed at `github.com/bundie-fi/solana`

> *"Bundie. An oracle that prices the future."*

---

## Appendix A — what changed and why

- **Agent creation: removed.** It manufactured market subjects the chain already publishes for free, and split "agent" between *subject* and *reader* — diluting the oracle pitch. The agents that matter are **readers** (x402, demand side).
- **Agent-performance: demoted** from headline to one example subject (Slide 4 note), run on 1–2 house agents. Keeps the Colosseum hook without the supply crutch.
- **Headline: the oracle + its x402 readers.** Supply = on-chain DeFi metrics.
- **Factual fixes retained:** direct SDK (not CPI); `InsiderMarketForbidden`; $9B TVL on one slide only.

## Appendix B — screenshots to capture (after app changes)

No demo video — these static frames carry the live-product weight. Capture at high res, light theme, no wallet PII:

1. **SCREENSHOT A (Slide 4):** a single DeFi-outcome market detail — an on-chain-resolvable subject (Kamino utilization / mSOL par / protocol TVL), showing YES/NO price + depth + resolver = "on-chain read." *Avoid an off-chain-resolved market (AWS/StatusPage) — it contradicts "oracle-free."*
2. **SCREENSHOT B (Slide 4):** the x402 read — a terminal `curl` of `/v1/event-price` with the `X-PAYMENT` header and the signed JSON response. This is the single most important image; it shows the oracle being read.
3. **SCREENSHOT C (Slide 8):** the app home consensus strip / live-markets grid.
4. *(optional)* the on-chain settlement moment — explorer tx of `resolve_event` / `resolve_market_v2` reading state.

> App-change prerequisites for these shots (from the demo-gap analysis):
> (a) at least one **on-chain-resolvable** market live in `/markets`; (b) the x402 read returning a signed price; (c) keep off-chain-resolved markets out of frame.

## Appendix C — open items

- `/launch` IA: currently "suggest an event market." Either repoint to on-chain-metric markets or keep internal — do **not** restore agent-launch.
- `README.md` + `demo-script.txt` were realigned to this frame this session.
- **Screenshots: 3 required (A, B, C) + 1 optional (D)** — marked `[[ SCREENSHOT X — PLACEHOLDER ]]` in the slides; see Appendix B for what each must show.
