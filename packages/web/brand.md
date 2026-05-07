# Brand · Bundie (web app)

This document defines the **dark editorial palette** that replaces the old
warm-paper / cream Bundie web aesthetic with a darker, editorial product
surface — closer in spirit to Linear, The Browser Company, and Stripe Press,
but pulled further into night. The tone matches the `packages/landing-page`
direction (see `packages/landing-page/brand.md`), but uses a deep navy base
with a lavender accent rather than the landing page's near-black + amber.

The new tokens live alongside the legacy `--bg-0` / `--fg-0` / `--gold` set
in `src/app/globals.css` — both palettes coexist while components migrate.
New work should reference `--de-*` tokens; legacy tokens will be pruned in a
later pass.

## Palette

Design tokens live in `src/app/globals.css` under the
`/* === Dark editorial palette ===` block.

| Token              | Hex / RGBA                           | Role                                          |
|--------------------|--------------------------------------|-----------------------------------------------|
| `--de-bg`          | `#0A0E1F`                            | Base background, deep blue-black              |
| `--de-bg-raised`   | `#11162B`                            | Cards, panels, raised surfaces                |
| `--de-bg-2`        | `#161C36`                            | Hover, secondary surface                      |
| `--de-bg-3`        | `#1D2440`                            | Inset wells, inputs, code blocks              |
| `--de-bg-sunken`   | `#070A17`                            | Recessed regions, modal scrim base            |
| `--de-line`        | `rgba(242,237,224,0.08)`             | Hairline dividers                             |
| `--de-line-2`      | `rgba(242,237,224,0.14)`             | Card borders                                  |
| `--de-line-3`      | `rgba(242,237,224,0.22)`             | Stronger separators, focus rings              |
| `--de-ink`         | `#F2EDE0`                            | Primary text, cream off-white                 |
| `--de-ink-2`       | `rgba(242,237,224,0.74)`             | Body / secondary copy                         |
| `--de-ink-3`       | `rgba(242,237,224,0.54)`             | Eyebrows, meta, captions                      |
| `--de-ink-4`       | `rgba(242,237,224,0.36)`             | Disabled, hints, placeholder                  |
| `--de-ink-5`       | `rgba(242,237,224,0.20)`             | Faint scaffolding, axis ticks                 |
| `--de-lavender`    | `#A899F5`                            | Primary accent (links, active nav, CTA)       |
| `--de-lavender-2`  | `#BDB1F8`                            | Hover / lighter lavender                      |
| `--de-lavender-3`  | `#8675E8`                            | Pressed / deeper lavender                     |
| `--de-lavender-tint` | `rgba(168,153,245,0.14)`           | Pill / chip / soft-fill backgrounds           |
| `--de-lavender-glow` | `rgba(168,153,245,0.28)`           | Glows, shadow accents, focus halos            |
| `--de-mint`        | `#A8E6CF`                            | Outcome A — YES / Beat / above target          |
| `--de-mint-2`      | `#C2EFDB`                            | Mint highlight                                |
| `--de-mint-tint`   | `rgba(168,230,207,0.14)`             | YES pill / chip background                    |
| `--de-mint-glow`   | `rgba(168,230,207,0.26)`             | Positive value glow                           |
| `--de-rose`        | `#E8A5A5`                            | Outcome B — NO / Miss / below target           |
| `--de-rose-2`      | `#F1BFBF`                            | Rose highlight                                |
| `--de-rose-tint`   | `rgba(232,165,165,0.14)`             | NO pill / chip background                     |
| `--de-rose-glow`   | `rgba(232,165,165,0.26)`             | Negative value glow                           |
| `--de-amber`       | `#E8C58A`                            | Warnings, neutral-but-notable signals         |
| `--de-amber-tint`  | `rgba(232,197,138,0.14)`             | Caution chip background                       |
| `--de-blue`        | `#8AB6F0`                            | Informational accent, secondary link          |
| `--de-blue-tint`   | `rgba(138,182,240,0.14)`             | Info chip background                          |

The existing radial gradient ambient lighting on hero surfaces is preserved
— compose it from `--de-lavender-glow` and `--de-bg` for the dark editorial
canvas (e.g. `radial-gradient(60% 40% at 50% 0%, var(--de-lavender-glow), transparent)`).

## Typography

Loaded via `next/font` in `src/app/layout.tsx` — the existing fonts stay,
the new palette only changes color. The setup remains:

- **Display:** Playfair Display (400, italic) — `var(--font-display)`. h1 / h2 / section titles, card titles, brand wordmark. Italic for semantic emphasis.
- **UI / body:** Inter (variable) — `var(--font-sans)`. Default body, buttons, inputs, dense data labels.
- **Mono / labels:** JetBrains Mono (variable) — `var(--font-mono)`. Eyebrows, stats, tabular figures, addresses, status pills, terminal lines.

Headline italics use `--de-lavender` for emphasis (replaces the old
`--gold` italic accent). Body copy is `--de-ink-2`; eyebrows and meta
use `--de-ink-3` rendered in mono with letter-spacing `0.18em`–`0.20em`
and `text-transform: uppercase`.

Numbers always render with `font-variant-numeric: tabular-nums` and the
`tnum` feature flag — the existing `.mono` / `.num` / `.nums` utilities
already do this.

## Voice

- Short, declarative sentences. Active voice. Present tense.
- Editorial, not enterprise. Read like a magazine column, not a dashboard.
- No em dashes; use periods, commas, or colons.
- Numbers carry the page. Surround them with quiet labels, not adjectives.
- Eyebrows are ALL CAPS mono, two to four words: `LIVE NAV`, `MARKET STATE`, `RECENT DECISIONS`. Never punctuate them.
- "YES" and "NO" outcomes stay one word, mint and rose respectively.
  Never use traffic-light green / red — that's the legacy palette's job.
- Don't lean on internal tooling names (chaos-sim, beethoven, etc.) in
  in-product copy. Agents are agents.
- Two-line subcopy ceiling on hero blocks: the value, then the call to action.

## Migration notes

Tokens are added under `:root` so they apply regardless of the (currently
unused) shadcn light/dark theme switching. As components migrate, they
should swap inline `var(--bg-0)` → `var(--de-bg)`, `var(--fg-0)` → `var(--de-ink)`,
`var(--gold)` → `var(--de-lavender)`, `var(--green)` (when used as a YES
signal) → `var(--de-mint)`, `var(--red)` (when used as a NO signal) →
`var(--de-rose)`. The legacy `--gold` / `--purple` aliases stay intact
during the transition.
