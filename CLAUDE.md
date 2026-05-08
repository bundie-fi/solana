# Bundie (Solana)

## What Is This
Bundie is a Solana protocol that lets anyone launch an investment strategy as a tradeable asset, so others can earn by investing in it, and everyone can profit from predicting which strategies will outperform.

Two core primitives:
1. **Strategy Token Program** — Mint tradeable shares tracking live portfolio value from on-chain protocol positions
2. **Prediction Market Program** — LS-LMSR markets that self-resolve using on-chain NAV data

## Monorepo Structure
- `packages/web` — Next.js 14 PWA (wrapped as Seeker TWA)
- `packages/backend` — Hono API server (Railway deployment)
- `packages/programs` — Anchor + pinocchio workspace (Strategy Token + Prediction Market)
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
- Direct protocol integrations from the chaos-sim agent runtime — Marinade,
  Kamino, MarginFi, Solend, Zeta. (Earlier plans routed through a Beethoven
  CPI layer; that path was dropped in the 2026-04-24 pivot.)
- Gold (#d4a853) = Earn mode, Purple (#a78bfa) = Predict mode
- SNS .sol name resolution for identity

## Commands
- `pnpm dev` — Start backend (3001), web (3000), landing (3002) together with prefixed logs; web waits on backend `/health` before starting
- `pnpm dev:web` — Backend + web only (skips landing)
- `pnpm dev:backend` — Backend only
- `pnpm dev:landing` — Landing only
- `pnpm --filter @bundie/web dev` — Start web app only (no orchestration)
- `pnpm --filter @bundie/backend dev` — Start backend only (no orchestration)
- `pnpm --filter @bundie/sol-cli build` — Build the agent CLI
- `cd packages/programs && anchor build` — Build Solana programs
- `cd packages/programs && anchor test` — Run program tests

## Performance Reference

Before optimising, **measure**. Profile with Lighthouse, the Chrome
DevTools Performance trace, and `web-vitals` in the field. Target Core
Web Vitals: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1.

The catalog below is the menu of techniques to consider when an
optimisation pass is justified. Use it as a reference, not a checklist.

### Bundle & cold load
- Custom build profile tailored to what's actually rendered. Lazy-split
  per-route. Use `<link rel="modulepreload">` for the next-most-likely
  route. Inline critical CSS (`<style>` in `<head>`).
- Edge `middleware.ts` checks cookies for routing decisions before SSR
  runs (e.g. wallet-connected vs anonymous).

### Prefetch
- Login-intent prefetch: when a wallet connect starts, preload the
  routes + APIs the user lands on post-connect.
- Preconnect to `NEXT_PUBLIC_BACKEND_URL` and the Solana RPC at the
  app shell layer (`<link rel="preconnect">` in `layout.tsx`).
- Hover-prefetch agent / market detail routes via Next `Link` and
  warm the data fetcher on the same hover.

### Caching
- SWR-style tiers via Next 15 `fetch` `next: { revalidate, tags }`:
  30s for index views, 5m for agent detail, 1d for SNS metadata.
- `localStorage` → React Query / SWR hydration: agent lists and
  markets survive a page reload without a network round-trip.
- Server-side KV (or in-memory LRU on Railway) for derived data the
  backend computes. Invalidate via tag on write.
- Avoid `cache: "no-store"` blanket calls — they kill all of the
  above. Default to revalidate; only opt out where genuinely live.

### Streaming & parallelism
- Page-level fan-out should `Promise.all` independent fetches; never
  sequential await chains.
- React Suspense + Next 15 streaming: render the editorial header
  immediately, stream the leaderboard / markets grid as data arrives.
- Server actions over a single batched RPC endpoint when the client
  needs to issue multiple mutations atomically.
- Anti-buffering headers (`X-Accel-Buffering: no`,
  `Content-Encoding: identity`) on streaming endpoints.

### Rendering
- Charts (`DeSparkline`, `NavChartLarge`) lazy-loaded with reserved
  height so they don't cause CLS when they hydrate.
- Tab-level lazy loading: market detail tabs (Trades / Discussion /
  Rules) load on click, not on first paint.
- Memoise leaderboard rows + market cards (`React.memo`) so a parent
  re-render doesn't rebuild every row.
- Instant paint on cache hits: render the SWR cache while
  revalidation runs in the background.
- Keep the DOM light — every extra wrapper costs LCP.

### WebSocket
- Single shared WS connection across the app, multiplexed by topic.
  Reconnect with exponential backoff, pause subscriptions on
  `document.hidden`.
- On connect, prefetch the topics the current route subscribes to.

### Service Worker
- App shell precached: HTML skeleton + critical CSS + brand fonts.
- NetworkFirst nav strategy with a 3s timeout falling back to the
  precached shell.
- Fonts cached 30d. Register the SW idle (after first paint).

### Where the discover page sits today
- `export const dynamic = "force-dynamic"; revalidate = 0` — every
  request blocks on five backend / RPC calls + per-agent PnL fan-out.
  Switching to `revalidate = 30` is the highest-leverage one-line change.
- `lib/pnl.ts` and the page itself pass `cache: "no-store"` — kills
  Next's fetch cache. Use `next: { revalidate, tags: [...] }` instead.
- `next.config.js` sets `images: { unoptimized: true }`. Real
  `next/image` with width/height + lazy-loading would land LCP and CLS
  wins on the agent / protocol icon grid.
- No `middleware.ts`, no service worker, no `<link rel="preconnect">`
  for `NEXT_PUBLIC_BACKEND_URL`.
