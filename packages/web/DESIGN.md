# Bundie / Yields.so — Design System

> A mobile-first design system for a DeFi strategy-backing + prediction-market app.
> Audience: human end-users on mobile (Seeker TWA), tablet, desktop. Not power users.
> Tone target: as approachable as Robinhood / Cash App, as polished as Linear / Cal / Framer.

---

## 0. References we are borrowing from

(The `awesome-design-md` source files point to external URLs, so this section cites the
well-known patterns each product is known for, which this spec is built on.)

| Source | What we take |
|---|---|
| **Linear** | Dense top navigation, tight type rhythm, mono numerics for IDs/addresses, keyboard-first hints, minimal chrome. Shell layout (sticky top bar → main canvas → right drawer for detail). |
| **Cal.com** | Generous whitespace in forms and onboarding, calm colour palette on neutral grounds, no emoji — plain-English microcopy. Friendly-but-adult tone. |
| **Coinbase / Kraken** | Tabular-lining mono for prices/percents, big hero numbers on detail pages, green-up / red-down semantics, subtle sparkline under the primary stat, signed +/− prefixes. |
| **Framer** | Spring motion for object-scale transitions (drawer, sheet, cards lifting), short easing for micro-interactions, `will-change` transforms, never animate `top/left`. |
| **Intercom** | Stacked message bubbles with subtle bounce-in for prediction-market chatter, read/unread dot indicator, persistent bottom composer on mobile. |

Explicitly **not** referenced: Ferrari, Lamborghini, BMW — wrong tone for a utility app.

---

## 1. Typography

### Font stack
- **Primary sans** — **Inter** (variable). Covers body, UI, headings.
- **Mono** — **JetBrains Mono** (variable). Used only for addresses, tx hashes, numeric tables, code.

Both loaded via `next/font/google` and exposed as CSS variables so Tailwind can read them:

```ts
// layout.tsx
import { Inter, JetBrains_Mono } from 'next/font/google'
const inter = Inter({ subsets:['latin'], variable:'--font-sans', display:'swap' })
const mono  = JetBrains_Mono({ subsets:['latin'], variable:'--font-mono', display:'swap' })
// <html className={`${inter.variable} ${mono.variable} dark`}>
```

```ts
// tailwind.config.ts
fontFamily: {
  sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
}
```

### Type scale (mobile → desktop via `clamp`)

| Token | Size | Weight | Line | Use |
|---|---|---|---|---|
| `text-display` | clamp(2rem, 6vw, 3.25rem) | 600 | 1.05 | Hero numbers, page titles on detail pages |
| `text-h1` | clamp(1.75rem, 5vw, 2.25rem) | 600 | 1.15 | Page title (Discover, Markets) |
| `text-h2` | 1.5rem / 24px | 600 | 1.2 | Section header |
| `text-h3` | 1.125rem / 18px | 600 | 1.3 | Card title |
| `text-body` | 0.9375rem / 15px | 400 | 1.5 | Paragraphs |
| `text-sm` | 0.8125rem / 13px | 400 | 1.45 | Secondary, meta |
| `text-xs` | 0.75rem / 12px | 500 | 1.4 | Labels, badges |
| `text-stat` | clamp(1.5rem, 4.5vw, 2rem) | 700 | 1 | Stat value, mono, tabular-nums |

### Numeric rule
All money / percent / APY / price values use **mono + `tabular-nums` + `font-feature-settings: 'tnum'`** so columns align and digits don't jitter on update (Coinbase/Kraken pattern).

---

## 2. Colour system

### Brand primaries (unchanged from CLAUDE.md)
- **Earn Gold** `#d4a853` — everything tied to backing strategies.
- **Predict Purple** `#a78bfa` — everything tied to prediction markets.

Each primary has an 11-step scale (50 → 950) so we can use it on backgrounds,
borders, hover states, and focus rings without bespoke hex in components.

| Step | Gold | Purple |
|---|---|---|
| 50  | #fdf9ed | #f3efff |
| 100 | #faf0cc | #e7ddff |
| 200 | #f4dd98 | #d0beff |
| 300 | #ecc66a | #b69aff |
| 400 | #e0b25c | #a78bfa |  ← brand |
| 500 | **#d4a853** | #8a6dee |  ← brand / hover |
| 600 | #b8893e | #7554d1 |
| 700 | #926a2f | #5e40a8 |
| 800 | #6c4d23 | #452f7c |
| 900 | #4a341a | #2e2054 |
| 950 | #2a1d10 | #1a1233 |

### Neutral ramp (10 steps, dark-mode canonical)

| Step | Hex | Use |
|---|---|---|
| `neutral-0`   | #0a0a0f | Page background (dark) |
| `neutral-50`  | #101018 | Hover row |
| `neutral-100` | #141420 | Surface (cards) |
| `neutral-200` | #1a1a28 | Surface-raised (drawer, sheet) |
| `neutral-300` | #1e1e2e | Border default |
| `neutral-400` | #2a2a3d | Border hover |
| `neutral-500` | #51516b | Disabled text / divider on light surfaces |
| `neutral-600` | #8888a3 | Tertiary text |
| `neutral-700` | #b0b0c4 | Secondary text |
| `neutral-800` | #e6e6f0 | Primary text |
| `neutral-900` | #ffffff | Max emphasis text |

Light-mode ramp (TODO — spec only, not implemented this pass): invert 0↔900, shift
surfaces to warm-white (#fafaf7) with warm-black text (#0b0b0f) — Cal aesthetic.

### Semantic

| Token | Hex | Meaning |
|---|---|---|
| `success-400` | #34d399 | Price up, YES side, confirm |
| `success-500` | #10b981 | Up hover |
| `danger-400`  | #f87171 | Price down, NO side, destructive |
| `danger-500`  | #ef4444 | Destructive hover |
| `warning-400` | #fbbf24 | Paused strategy, pending tx |
| `info-400`    | #60a5fa | Informational |

Legacy aliases (`earn-gold`, `predict-purple`, `background`, `surface`, `border`) are
**preserved** in `tailwind.config.ts` because `/markets`, `/portfolio`, `/strategy/[address]`
already use them. Don't migrate those in this pass.

---

## 3. Space, radius, shadow

### Spacing scale
Tailwind default (4px base). House rule: section vertical rhythm is `py-6` (24px) on
mobile, `py-10` (40px) on ≥ md. Card internal padding `p-5` (20px). Stack cards with `gap-3`.

### Radius tiers
- `rounded-md` 6px — inputs, chips
- `rounded-lg` 10px — buttons
- `rounded-xl` 14px — cards, stat tiles
- `rounded-2xl` 20px — sheets, modals, hero surfaces
- `rounded-full` — avatars, dot indicators, pill badges

### Shadow tiers (dark-mode-tuned)
- `shadow-none` — default
- `shadow-soft` `0 1px 2px rgba(0,0,0,.35)` — cards at rest
- `shadow-pop`  `0 8px 24px -8px rgba(0,0,0,.55)` — hover state for cards
- `shadow-sheet` `0 -16px 48px -8px rgba(0,0,0,.6)` — bottom sheet on mobile

Shadows are subtle because the background is already near-black; prefer
**border-colour shift + slight translate-y** for lift cues.

---

## 4. Motion

- **Durations** — `90ms` micro (colour, border), `180ms` default (hover), `260ms` content
  (drawer open/close, tab slide), `420ms` page transition max.
- **Easings**:
  - `ease-out-quick` `cubic-bezier(.2,.8,.2,1)` — default for exits and reveals.
  - `spring` via `cubic-bezier(.34,1.56,.64,1)` — used for drawer/sheet entrance,
    card press-down → release (Framer-style overshoot, light).
- **Rules**
  - Transform + opacity only. Never animate `width/height/top/left`.
  - `prefers-reduced-motion: reduce` → collapse to opacity-only 120ms.
  - Page transitions = none (Next.js default). Do not animate route changes.
  - Number updates: no count-up animation. Swap in place. Financial users distrust roulette digits.

---

## 5. Component hierarchy

### Implemented this pass (Discover)
- **`Card`** — `rounded-xl border border-neutral-300 bg-neutral-100 p-5`. Hover = border → `earn-gold/40` + `translate-y-[-1px]` + `shadow-pop`. 180ms.
- **`Button`** — variants:
  - `primary` → solid Earn Gold (`bg-earn-gold text-neutral-0`)
  - `predict` → solid Predict Purple (`bg-predict-purple text-white`)
  - `ghost`   → transparent, border `neutral-300`, text `neutral-700`
  - `destructive` → solid `danger-500`, white text
  - Shared: `rounded-lg px-4 h-10 text-sm font-semibold` on desktop, `h-11` on mobile (Apple HIG 44px tap target).
- **`Stat`** — vertical tile: label (text-xs, `neutral-600`, uppercase, tracking-wider) over value (text-stat, mono, tabular-nums). Optional trailing delta in success/danger.
- **`Sparkline`** — 60×20 SVG path, 1.5px stroke, currentColor, no axes. Source data: synthesized from `performance.{day,week,month,all}` until snapshot history lands — noted below.
- **`Sheet`** — bottom drawer on mobile (`< md`), right drawer on `≥ md` desktop. Backdrop `bg-black/60 backdrop-blur-sm`. Spring entrance. Escape to close, tap backdrop to close. Hand-rolled, no Radix.

### Specified, to be built later
- **`Table`** — zebra off; row hover = `neutral-50`; mono numerics right-aligned; header `text-xs uppercase tracking-wider` in `neutral-600`.
- **`Tabs`** — underline-style (Linear), 180ms sliding indicator using `translateX`.
- **`Toast`** — stacked bottom-right on desktop, top on mobile, auto-dismiss 5s, one-line body + optional action, Intercom bounce-in.

### Known data gap (called out so we don't mislead)
`StrategyDisplay.performance` only exposes `{day, week, month, all}` scalars — no time
series. The sparkline for this pass **synthesizes** a 12-point series from those deltas.
Once `PositionSnapshots` PDA data flows into `lib/chain.ts`, swap the input.

---

## 6. Responsive

Mobile-first. Every component is designed at 360×800 first, then scales up.

| Breakpoint | Width | Layout change |
|---|---|---|
| base     | 0–639  | Single column. Drawer = bottom sheet. Header collapses to compact row + hamburger. |
| `sm`     | 640+   | Still single column for cards on Discover; tighter gutters. |
| `md`     | 768+   | Two-column card grid. Drawer = right-side sheet (440px wide). |
| `lg`     | 1024+  | Three-column card grid. Filters become a left rail. |
| `xl`     | 1280+  | Max content width 1200px, centered. Right rail for detail sheet sticks. |
| `2xl`    | 1536+  | No further layout change — just more breathing room. |

Seeker TWA runs at phone viewport. Phone is the reference; desktop is the scale-up.

---

## 7. Empty states + skeletons

**Philosophy**: A blank screen is a bug. A skeleton is a promise. A written empty state is a conversation.

- **Loading** — shimmer skeletons matching the real card shape. Cap shimmer cycle to 1.2s,
  opacity 0.35 ↔ 0.55. Don't pulse colours.
- **Empty**   — short sentence in `neutral-700`, one primary CTA. Plain English.
  *Example*: "No strategies yet. Be the first to launch one." + button "Launch strategy".
- **Error**   — `danger-400` icon + body, plus "Try again" (ghost) and "Report" (ghost).
  Never show a raw stack trace to a user.

---

## 8. Voice & tone

- Plain English. No jargon unless it names a concrete thing ("NAV", "APY", "YES share").
- No emoji in product UI — ever. (Emoji fine in marketing copy on the landing page.)
- Numbers are facts; verbs are invitations. "Back this strategy" over "Execute trade".
- Money is always preceded by its currency ("$45,200" not "45200") and percentages are
  always signed if representing change (`+2.3%`, `−1.1%`).
- Addresses are always truncated as `abcd1234…WXYZ` in mono, never shown full inline.
- Microcopy skeleton: **Verb. Object. Consequence.**
  Good: "Buy YES — you'll earn if the strategy beats the threshold."
  Bad: "Purchase position in prediction market outcome."

---

## 9. Accessibility bar

- WCAG AA contrast on every text/background pairing in the dark theme.
  Gold-on-neutral-0 is brand-critical — we bold it and reserve it for primary accents.
- 44×44 CSS px minimum tap target on mobile.
- Every interactive element gets a visible focus ring: `ring-2 ring-earn-gold/60 ring-offset-2 ring-offset-neutral-0` (or purple on predict surfaces).
- `prefers-reduced-motion` respected (see Motion section).
- Semantic HTML first — `<button>` for actions, `<a>` for navigation, never a `<div onClick>`.
