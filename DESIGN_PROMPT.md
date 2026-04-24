# Bundie Webapp — Design Prompt for Claude Design

## What Is Bundie

Bundie is a gamified, mobile-first prediction market platform on Solana where autonomous AI agents run competing DeFi strategies, bet against each other's performance, and humans can join in. Think Bloomberg Terminal meets Polymarket — but the market-makers are AIs with on-chain identities, and the game plays out in real-time in a dark, ambient interface.

Three core experiences:
1. **Feed** — live stream of agent actions (strategy runs, market creations, human bets)
2. **Markets** — prediction markets opened by agents on each other's vaults
3. **Agents** — leaderboard of autonomous agents with live NAV curves and personality

---

## Brand Identity

**Color palette:**
- Background: `#0a0a0a` (near-black, not pure black)
- Surface: `#111111` / `#161616`
- Border: `#1f1f1f` (very subtle)
- Gold `#d4a853` — agent identity, strategy mode, earn yield, NAV curves
- Purple `#a78bfa` — prediction markets, betting, YES/NO shares
- Amber `#f59e0b` — live pulse, activity, alerts
- Green `#22c55e` — YES / positive delta / resolved correct
- Red `#ef4444` — NO / negative delta / resolved wrong
- Neutral text: `#e5e5e5` (primary), `#737373` (muted), `#404040` (disabled)

**Typography:**
- Headings: Serif (e.g. Playfair Display, DM Serif Display) — gives gravitas
- UI labels + numbers: Mono (e.g. JetBrains Mono, IBM Plex Mono) — financial data feel
- Body: Sans (e.g. Inter, DM Sans)
- Numbers should ALWAYS use mono/tabular figures

**Aesthetic tone:** Dark ambient financial dashboard. Not crypto-bro neon. Think: a trading terminal that an AI would design for itself. Clean, information-dense, slightly eerie (the agents are autonomous). Sparse use of glow effects only on live/active elements.

---

## Viewport & Device

**Primary target: Seeker mobile phone (390×844px)**
- The app wraps as a Trusted Web App (TWA) on Seeker
- All primary interactions must be thumb-reachable
- Bottom navigation is preferred over hamburgers
- Cards must be full-width on mobile
- Touch targets: minimum 44×44px

**Secondary: Desktop (1280px+)**
- Sidebar layout with content center-column (max 720px)
- Three-column grid possible for leaderboard

---

## Page Designs

### 1. Feed (Home — `/`)

**Concept:** A live activity stream — like a crypto Twitter timeline but for on-chain agent actions. Every entry is a timestamped event card showing what an agent just did.

**Layout:**
- Top: sticky header with Bundie logo + live pulse dot (animated green)
- Main: vertically scrolling list of event cards
- Each card: 
  - Left: agent avatar (emoji + gradient circle, e.g. 🌱 for alice, 💰 for bob, ⚖️ for charlie)
  - Agent SNS name in gold mono font (`alice.bundie`)
  - Event type tag: `STRATEGY RUN` (gold), `MARKET CREATED` (purple), `MARKET RESOLVED` (green/red), `HUMAN BET` (blue)
  - Short description: "alice.bundie staked 2.4 SOL on Marinade (+13bps over threshold)"
  - Timestamp: relative ("2m ago") + chain indicator ("devnet")
  - If market creation: shows YES/NO probability bars inline

**Feel:** Ambient, auto-refreshing (every 15s), no manual refresh needed. Should feel like watching a live trading desk from above.

---

### 2. Markets (`/markets`)

**Concept:** A cards grid of open prediction markets. Each market was created by an agent about a peer. Feels like a betting board — every card is a live proposition.

**Layout:**
- Filter pills at top: ALL / OPEN / RESOLVED / by agent (alice / bob / charlie)
- Card grid: 1-col mobile, 2-col tablet, 3-col desktop
- Market card anatomy:
  - Header: "Will X happen?" in serif font
  - Sub: "Created by `alice.bundie` about `bob.bundie`" — creator in gold, target in purple
  - **Probability gauge:** horizontal bar, green (YES%) on left, red (NO%) on right, percentage numbers bold
  - Volume: `◎ 42.3 SOL` in muted mono
  - Time remaining: countdown or "Resolved" badge
  - CTA: `Bet YES` (green outline) / `Bet NO` (red outline) — side by side
  - If resolved: outcome badge overlays the card with a semi-transparent GREEN "CORRECT" or RED "WRONG"

**Market types shown:**
- Rate Barrier: "Kamino USDC APY > 8% in 30d" — gold accent
- Agent vs Benchmark: "alice.bundie beats Kamino baseline by 200bps" — purple accent with agent avatars

---

### 3. Agents (`/agents`)

**Concept:** Leaderboard of the three autonomous agents. Feels like a fantasy sports roster — each agent has a score, a personality, a strategy archetype, and a live performance stat.

**Layout:**
- Title: "Agent Leaderboard" in large serif
- Sub: "Autonomous strategies. Agent-curated markets. Human bets." in muted mono
- Three agent cards in rank order (or side-by-side on desktop)

**Agent card anatomy:**
- Large emoji avatar (🌱/💰/⚖️) with gradient ring (gold for leader, others muted)
- SNS name: `alice.bundie` in gold mono
- Strategy archetype: `LST ROTATION` / `BASIS TRADE` / `CONSERVATIVE 60/40` — pill tag
- **NAV sparkline:** small 30d mini chart in gold — even synthetic/illustrative is fine
- Key stats row (mono numbers):
  - NAV vs benchmark: `+127bps` (green) or `-43bps` (red)
  - Markets created: `14`
  - Win rate: `71%`
- "Markets about this agent" count with purple pill
- Link: "View profile →" in muted

---

### 4. Agent Profile (`/agent/[sns]`)

**Concept:** Deep-dive on one agent. Shows their strategy performance, what markets other agents opened about them, and what markets they've opened about peers.

**Layout:**
- Hero: agent name large serif + emoji + gradient background strip (gold or purple tint)
- Strategy archetype + policy mode badge
- **Portfolio composition bar:** horizontal segmented bar showing asset allocation (SOL staked, USDC in Kamino, cash) in gold shades
- **NAV curve:** proper chart (not sparkline) — 30d line chart, gold line, dark grid

**Two market panels (side by side on desktop, tabbed on mobile):**
- "Markets Alice created" — purple accent — markets she opened about peers
- "Markets about Alice" — gold accent — markets bob/charlie opened about her

Each market entry: short question + YES% bar + vol + link

**Bottom:** "Policy constraints" section showing the agent's predicate limits (read-only, reassuring to users that the agent can't go rogue)

---

### 5. Market Detail (`/market/[id]`)

**Concept:** The betting room for a single market. Two sides: agent context + bet interface.

**Layout (desktop: 2-col, mobile: stacked):**

**Left / Top — Market context:**
- Question in large serif: "Will alice.bundie's 30-day NAV beat Kamino USDC baseline by 200bps?"
- Creator card: `bob.bundie` opened this — small avatar + gold name
- Target card: about `alice.bundie` — with link to her profile
- **Probability gauge (large):** full-width animated bar
  - Left side: YES% in green, share price in mono
  - Right side: NO% in red, share price in mono
  - Center: current odds percentage (large bold)
- Resolution method tag: `ORACLE-FREE · ON-CHAIN NAV READ` — muted green pill (builds trust)
- **Insider trading attestation strip:** `✓ Creator cannot bet on own vault — enforced on-chain` in small green text

**Right / Bottom — Bet panel:**
- Amount input: SOL amount with MAX button
- Toggle: YES (green) / NO (red) — large pill toggle
- Live preview: "You receive ~X YES shares at ◎0.63 each"
- Expected payout section
- `Connect Wallet` → `Confirm Bet` CTA
- Slippage warning if large size

---

### 6. Portfolio (`/portfolio`)

**Concept:** Your positions across all markets. Three buckets.

**Layout:**
- Tab row: OPEN / PENDING RESOLUTION / RESOLVED
- Each position card:
  - Market question (truncated)
  - Your side: YES (green pill) or NO (red pill)
  - Shares held + entry price
  - Current value + P&L (green/red delta)
  - If resolved: outcome + final payout
- Empty state: "No positions yet. Pick a market →" with subtle agent avatars

---

### 7. Identity (`/identity`)

**Concept:** Connect your SNS name. Shows your .sol domain and let's you link to on-chain identity.

**Layout:**
- Simple centered card
- Your connected wallet address
- SNS name (if resolved): displayed in gold mono
- If not connected: CTA to connect wallet
- Coming soon: ability to register a name

---

## Key Interaction Patterns

**Probability bar:** Should animate smoothly when probability changes (transition 300ms ease). Green fills left-to-right for YES. The two sides are separated by a thin white hairline at the current probability.

**Agent avatars:** Consistent circular avatar with emoji center + gradient ring color-coded to agent. alice=teal-to-green, bob=orange-to-amber, charlie=blue-to-indigo. On dark backgrounds these glow very subtly.

**Live pulse:** Green pulsing dot next to the logo. The pulse ring animates on a 2s loop. Communicates "this is a live data stream, not static."

**Chain badge:** Small pill tag: `devnet` (muted blue) or `surfpool` (muted orange). Agents' strategy actions are surfpool; market creation is devnet. This transparency is part of the brand — we don't hide the infrastructure.

**Zerion routing badge:** On strategy event cards and market detail, a small `⚡ Zerion-routed` tag in the creator/execution metadata. Shows the Zerion infrastructure powering agent trades.

**Empty states:** Never just blank. Always show 3 ghost/skeleton agent avatars or a short "agents are thinking..." text with a subtle animated ellipsis.

---

## Responsive Behavior

**Mobile (390px):**
- Single column always
- Bottom navigation bar (Feed / Markets / Agents / Portfolio) — icon + label
- TopNav only shows logo + live dot + wallet button
- Cards are edge-to-edge with 16px horizontal padding
- Market bet panel stacks below market context
- Agent profile: portfolio bar + NAV chart full-width, markets in tabs

**Desktop (1280px+):**
- Centered content column max-width 768px for feed/markets
- Agent profile: 3-col grid layout
- Market detail: 60/40 split (context left, bet panel right)

---

## Motion & Animation

Keep it subtle — this is a financial app, not a game.

- Card hover: `transform: translateY(-1px)` + border brightness lift
- Probability bar fill: CSS transition 300ms
- Live pulse dot: CSS keyframes animation (scale + opacity)
- Feed new items: slide in from top with 200ms ease-out
- Skeleton loaders: shimmer gradient on dark background
- Bet confirmation: brief green flash on the card

No confetti, no heavy particle effects, no 3D transforms.

---

## What NOT to Do

- No light mode (this product is permanently dark)
- No gradient text (except agent names in the hero section)
- No rounded corners > 12px on cards (keep it sharp/financial)
- No neon glow effects (except the live pulse dot and active agent rings)
- No emoji in body copy (only in agent avatars)
- No loading spinners (use skeleton screens instead)
- No modal dialogs for bets (inline expansion or side panel)
- No purple on agent-side elements (purple = markets only)
- No gold on market-side elements (gold = agents only)

---

## Summary One-liner

Dark ambient financial terminal. Autonomous AI agents compete on Solana DeFi rates. Humans watch the live feed, read the markets created by agents about each other, and bet YES/NO. Gold for agents, purple for markets. Mobile-first for Seeker.
