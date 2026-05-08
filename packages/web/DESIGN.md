# Bundie Web · Design Philosophy

> **Direction: Precision Editorial** — A Bloomberg Terminal had a baby with a literary magazine. Numbers feel precise and trustworthy. Headlines feel authored, not generated. The texture is confident and tight, not cozy, not aggressive.

This document is the source of truth for the Bundie web app's visual language. The redesign that landed in 2026-05 collapsed the type system to two faces, retired the warm-paper surface, and committed to the dark-editorial palette across the discover surface. New work should follow this guide; old surfaces are migrating incrementally.

---

## 1. Type System

The web app uses **two faces** and only two:

| Face | Role | Token | Where |
|------|------|-------|-------|
| **Instrument Serif** | Display, italic accents | `var(--font-display)` | Headlines 36px+, the single italic phrase per section |
| **Figtree** | Everything structural | `var(--font-sans)` | Body, labels, numbers, CTAs, navigation |

`var(--font-mono)` is **aliased** to `var(--font-sans)`. JetBrains Mono was retired. Components that ask for monospace render in Figtree, paired with `font-variant-numeric: tabular-nums` so figures still feel anchored.

### How the serif behaves

Instrument Serif earns its place at **36px and above**. Below 28px it loses personality. Its italic is the real asset; treat it as a **colour accent**, not a default.

- One italic phrase per section. Two starts to feel like a quirk.
- Section headlines pair sans 700 with a single italic serif accent: "Top strategies *by 30-day return*".
- The Featured agent name is the rare case where the entire headline is italic serif — it's allowed because the agent's name *is* the editorial content.
- Never use serif for body, labels, captions, or anything under 22px.

### How the sans behaves

Figtree does the structural work. It swings hard between two weights:

- **400** — body, lede paragraphs (15–17px, line-height 1.55–1.6)
- **700** — labels, section titles, CTAs, all numbers

The middle weights (500, 600) are reserved. They blur the contrast that makes the system legible. If a moment doesn't earn 700, it should drop to 400.

For numbers, always pair Figtree 700 with `font-variant-numeric: tabular-nums` and `font-feature-settings: 'tnum'`. Numbers belong to the sans, never the serif. Putting a return percentage in Playfair was the single biggest typographic mistake of the previous design — it made figures look like *quotes*, not data.

### Hierarchy reference

```
Eyebrow / label    Figtree 700, 10.5–11px, all-caps, 0.16–0.20em tracking
Section title      Figtree 700, 28px, −0.025em tracking
Section accent     Instrument Serif italic, 28px, inline beside the title
Page headline      Instrument Serif, 40–64px (clamp), one italic phrase
Body               Figtree 400, 15–17px, 1.55–1.6 line-height
Lede               Figtree 400, 15px, slightly muted ink
Numbers (data)     Figtree 700, tabular-nums, −0.02em tracking
Caption            Figtree 400, 12–13px, 0.54α ink
```

### What to guard against

- **Three weights in close proximity.** If you find 400/500/600 together, pick a lane. Either reading (400) or label (700).
- **Italic serif everywhere.** It's an accent, not a default. Use it once per section.
- **Serif at small sizes.** Below 22px Instrument Serif starts to look ornamental.
- **Numbers in display.** Figures belong to Figtree 700. The serif is for words.

---

## 2. Colour

Single dark surface. Single accent.

```
Surfaces
  --de-bg          #0B0F1C     page (warmer than pure navy by design)
  --de-bg-raised   #11162A     cards, panels
  --de-bg-2        #161C36     hover, secondary surface
  --de-bg-3        #1D2440     inset wells, inputs
  --de-bg-sunken   #070A17     scrim base, recessed regions

Borders (cream-tinted hairlines)
  --de-line        rgba(242,237,224,0.07)
  --de-line-2      rgba(242,237,224,0.13)
  --de-line-3      rgba(242,237,224,0.20)

Ink (cream off-white, layered alphas)
  --de-ink         #F4EFE0
  --de-ink-2       0.74α     body
  --de-ink-3       0.54α     captions
  --de-ink-4       0.36α     labels
  --de-ink-5       0.20α     dividers, hairline accents

Accent (interactive / brand)
  --de-lavender    #A899F5

Outcomes (only ever signal binary state)
  --de-mint        #A8E6CF     YES, beat, above target
  --de-rose        #E8A5A5     NO, miss, below target

Reserved
  --de-amber                   Earn mode, lights up when share-buying ships
  --de-blue                    aux signals, never default decoration
```

### Why this palette suits Instrument Serif + Figtree

The serif has a literary undertone that benefits from a touch of warmth. A pure off-white (`#FFFFFF`) on pure navy (`#0A0E20`) reads as cold and corporate; the page tokens here shift the ink toward cream (`#F4EFE0`) and the ground toward an ink-blue with a slight green undertone (`#0B0F1C`). The result feels *printed*, not screen-glowing.

Lavender is the only colour that signals "interactive". Mint and rose are reserved for binary outcomes (YES/NO, Beat/Miss). Amber is reserved for Earn mode. Everything else is ink at varying alphas — the contrast comes from typography, not from a rainbow palette.

### Single-accent rule

**One brand colour does the work.** If you find yourself reaching for blue + green + purple + amber on the same screen, you have lost the single-accent rule. Mint and rose are not "secondary brand colours" — they are state signals. Every interactive element on the page should resolve to lavender.

---

## 3. Iconography

The web app uses **`lucide-react`** for all iconography. The Feather-style geometric stroke icons pair cleanly with Figtree and avoid the AI-generated emoji aesthetic.

### Conventions

- Default size: `16px`
- Default stroke: `2.25` for inline icons, `2.5` for CTAs
- Inline icons sit beside Figtree 700 labels with a `gap: 6–8px`
- Icons inherit `currentColor` — let typography drive the colour

### Icon vocabulary

| Use | Lucide |
|-----|--------|
| Navigate to detail | `ArrowUpRight` |
| Primary CTA | `ArrowRight` |
| Trend up | `TrendingUp` |
| Trend down | `TrendingDown` |
| Verified badge | `BadgeCheck` |
| Live indicator | filled circle (CSS) or `Circle` |
| Activity / status | `Activity` |
| Sparkle / new | `Sparkles` |

### What is banned

- **Emoji.** Anywhere. Even in copy. They flatten the editorial tone instantly.
- **Em dashes (—).** Replaced with a colon, period, or middle dot (·). The em dash signals a pause; we prefer to commit to a stop or a connector.
- **Font Awesome / Material Icons / Heroicons.** Pick one library, stick to it; the differences in stroke weight between libraries make a UI feel patchworked.

### Replacing em dashes

| Old | New |
|-----|-----|
| `Live — devnet` | `Live · Devnet` |
| `30D Return — +12.4%` | `30D Return: +12.4%` |
| `—` (missing data) | `··` (two dots) |

The `··` glyph is just two middle dots. It reads as "absent" without the typographic weight of an em dash, and it composes cleanly with tabular-nums layouts.

---

## 4. Layout & Spacing

### Grid

- Container: `max-width: 1280px`, `padding: 0 24px`
- Section gap: `80–96px` between major bands, `32–40px` between sub-sections
- Inside a card: `24–36px` padding scales with importance
- Featured hero: `36px` padding, `min-height: 480px`

### Borders

- Card border-radius: `12px` (default), `14px` (hero), `8px` (CTAs)
- Hairlines: prefer 1px borders in `--de-line` (subtle) or `--de-line-2` (visible)
- Inset wells: 1px `--de-line-2` on `--de-bg-3`

### Density

The discover page uses **comfortable** density. Stat strip rows breathe at 22–24px vertical padding. Leaderboard rows at 18px. Tighter than that starts to feel like a financial terminal; looser starts to feel like a marketing site.

---

## 5. Discover Page Architecture

The discover page is composed of five bands, in order:

```
1. Editorial header band
   ├── Eyebrow:  "The Bundie Index · Devnet"
   ├── Headline: serif, 40–64px, one italic phrase
   ├── Lede:     sans 400, 15px, ~620px max
   └── Stat strip: four cells with hairlines, sans 700 numbers

2. Featured strategy
   ├── Hero card (1.65fr): magazine layout, large NAV chart, 4 stats
   └── Aside (1fr): featured market card + editorial promo card

3. The Index
   ├── SectionHeader: "Top strategies by 30-day return", live count
   └── Leaderboard: 10 rows, hairline-separated

4. Markets
   ├── SectionHeader
   ├── TrendingFilters (filter pills)
   └── DeMarketCard grid (1 → 2 → 3 columns)

5. Strategist invite band
   └── Serif headline + lavender CTA button
```

### Why this order

The user lands and sees, in sequence: **what this is** (editorial header) → **the best example of it** (featured strategy) → **the full index** (leaderboard) → **places to play** (markets) → **a way to participate** (strategist invite).

The old layout led with stat tiles before establishing context, so the page felt like a dashboard before the visitor knew what they were looking at. The new editorial header band tells you *what the index is* before it shows you *the numbers*.

---

## 6. Voice

### Headlines

- Active. Present tense. Strategies *do*, not *are*.
- Short. Headlines should fit in two rows, even at the largest breakpoint.
- The italic phrase carries the emotional punch. The non-italic part carries the noun.

Good: "Strategies, ranked by *what they do on-chain*."  
Bad: "Discover the best strategies on the Bundie platform."

### Body

- Sentences over paragraphs. A four-sentence section is plenty.
- Avoid "we" / "our" / "you" unless absolutely necessary.
- Specific numbers > vague claims. "256 bUSD volume" beats "high volume."

### What is banned

- **Emoji.** Even in error messages.
- **Em dashes.** Use periods, colons, or `·`.
- **Hype language.** "Revolutionary", "next-gen", "game-changing".
- **Marketing fluff.** "Powerful", "robust", "seamless".

---

## 7. Motion

- **Hover transitions:** 160ms ease for colour, background, border
- **Lift on hover:** `transform: translateY(-1px)` for cards
- **Page-level entry:** never. The page is a document, not a slideshow.
- **Auto-advance carousels:** cross-fade, 280–320ms ease-out, never slide
- **State changes:** entry takes longer than exit (e.g. enter 240ms, exit 160ms)

The dark editorial direction calls for **restraint**. A motion-heavy interface starts to feel like a SaaS landing page. We want a magazine that happens to live on a screen.

---

## 8. Components Migrated to This System

| Component | Status | Notes |
|-----------|--------|-------|
| `app/page.tsx` (discover) | ✅ migrated | Reference implementation |
| `app/layout.tsx` | ✅ migrated | Two-font system, dark editorial body |
| `components/de/*` | ✅ partial | Already using `--de-*` tokens |
| `app/agent/[sns]/page.tsx` | ✅ migrated | Dark editorial agent detail |
| `app/market/[id]/page.tsx` | ✅ migrated | Trading panel + market shell |
| `app/portfolio/*` | ⏳ legacy paper | Wrapped in `.legacy-cream-page` |
| `app/wallet/*` | ⏳ legacy paper | Wrapped in `.legacy-cream-page` |
| `app/feed/*` | ⏳ legacy paper | Wrapped in `.legacy-cream-page` |
| `app/strategists/*` | ⏳ legacy paper | Wrapped in `.legacy-cream-page` |

Legacy surfaces are kept readable by `.legacy-cream-page` which restores the warm-paper background. They migrate as we revisit them.

---

## 9. Quick Checklist for New Work

Before merging a UI change, run through this list:

- [ ] Two fonts only — Instrument Serif + Figtree
- [ ] Numbers in Figtree 700, tabular-nums, never in serif
- [ ] One italic serif phrase per section, max
- [ ] Single accent colour — lavender for interactive, mint/rose only for outcomes
- [ ] No emoji, anywhere
- [ ] No em dashes — use `·`, `:`, or `.`
- [ ] Icons from `lucide-react`, 16px, stroke 2.25
- [ ] Hover transitions on interactive elements (160ms)
- [ ] Hairline borders prefer `--de-line` or `--de-line-2`
- [ ] Card border-radius 12–14px, CTAs 8px

If any item fails, fix it before merging.
