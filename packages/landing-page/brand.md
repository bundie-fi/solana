# Brand · Bundie (Solana landing)

_Applied from the Claude Design handoff `saN7-Ex32t5bBlmwl_5blw` (Solana Landing)._

This landing page deliberately departs from the primary Bundie "paper/ink/spruce"
system: it is the Solana-specific surface and reads as a dark editorial product
page.

## Palette

Design tokens live in `src/app/globals.css`.

| Token        | Hex / RGBA                           | Role                           |
|--------------|--------------------------------------|--------------------------------|
| `--bg`       | `#0a0908`                            | Base background                |
| `--bg-raised`| `#121110`                            | Cards, panels                  |
| `--ink`      | `#f6f3ee`                            | Primary text                   |
| `--ink-2`    | `rgba(246,243,238,0.72)`             | Body / secondary               |
| `--ink-3`    | `rgba(246,243,238,0.52)`             | Eyebrows, meta                 |
| `--ink-4`    | `rgba(246,243,238,0.36)`             | Disabled / hints               |
| `--amber`    | `#c2570c`                            | Primary action (Back)          |
| `--amber-3`  | `#e28646`                            | Italic accents, hero highlight |
| `--purple`   | `#6d28d9`                            | Predict / market-maker agent   |
| `--violet`   | `#9945FF`                            | Solana accent, used sparingly  |

Green `#7de0a4` is reserved for positive values and live indicators.

## Typography

Loaded via `next/font` in `src/app/layout.tsx`:

- **Display:** Instrument Serif (400, italic) — all h1/h2/h3 and card titles
- **UI / body:** Figtree (300–700) — the default sans
- **Mono / labels:** JetBrains Mono (400–600) — eyebrows, stats, handles, terminal

Display type uses italic for semantic emphasis (`<em>` in headlines), always
rendered in `--amber-3`.

## Voice

- Short, declarative sentences. Active voice.
- No em dashes; use periods, commas, or colons.
- Do not lean on internal tooling names (Beethoven, etc.) in marketing copy.
  One oblique reference in an in-product CLI demo is the ceiling.
- Hero subcopy stays at two lines: the value, then the call to action.

## Assets

- `public/assets/bundie-mark-white.png` — primary mark
- `public/assets/favicon-32.png` — favicon

## Section roster (in order on `/`)

1. Sticky nav with status pill (waitlist open · Solana devnet)
2. Hero: "Internet Capital Markets for DeFi strategies." + waitlist pill
3. Three Roles (Agent Compose, Human Back, Human Predict)
4. How It Works (4 steps)
5. Agents at Work (live demo: 2 terminals + phone screen sequence + flow bar)
6. What Makes It Different (2x2 grid, Internet Capital Markets card accented)
7. Early Preview (browser chrome with 3 live strategies)
8. Final CTA (waitlist pill)
9. Footer
