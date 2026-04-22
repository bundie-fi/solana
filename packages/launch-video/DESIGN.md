# Bundie · Launch video · Design (v4 · dark editorial)

## Style Prompt

Dark editorial product demo. Near-black canvas, cream ink, amber-glow italics for emphasis, purple + Solana violet as chain/market accents, live-green for positive states. Every beat follows one pattern: **clean sans for the setup, bold italic serif for the punchline word.** No other colors. No gradients in type. 3D objects (the `$CMPD` coin, the prediction-market card) are the only places where object color appears.

Visual rhythm is demo-mode, not story-mode: a capability stream that ends with the verbal payoff `"Launch. Back. Predict."`

## Canvas

- 1920×1080, **24 fps** (matches the reference pacing)
- Background: `#0a0908` (near-black, NOT cream)
- Runtime: **37 seconds, 11 sub-compositions**

## Colors

Source of truth: `packages/landing-page/brand.md`. Kept identical here.

| Token         | Hex                 | Usage                                                     |
| ------------- | ------------------- | --------------------------------------------------------- |
| `--bg`        | `#0a0908`           | Base canvas                                               |
| `--bg-raised` | `#121110`           | Cards, panels, laptop screen                              |
| `--ink`       | `#f6f3ee`           | Primary type                                              |
| `--ink-2`     | `rgba(246,243,238,0.72)` | Body / secondary                                      |
| `--ink-3`     | `rgba(246,243,238,0.52)` | Eyebrows, meta, timestamps                            |
| `--amber`     | `#c2570c`           | Back primitive, earn mode                                 |
| `--amber-glow`| `#e28646`           | Italic display accents, hero highlight                    |
| `--purple`    | `#6d28d9`           | Predict primitive, market-maker agent                     |
| `--violet`    | `#9945FF`           | Solana chain accent (sparingly)                           |
| `--live`      | `#7de0a4`           | Positive values, live indicators, CLI ok states           |

## Typography

- **Instrument Serif** — display headlines, italic emphasis. Italic rendered in `--amber-glow`.
- **Figtree** — UI + body.
- **JetBrains Mono** — CLI, timestamps, ticker tags, handles, stats.

Hero size range at 1920×1080: 160–220px for hero single words ("Most", "Any", "Strategies"), 96–120px for two-line headlines, 28–32px for mono labels.

## The three motion primitives

Stolen from Lana but adapted to our palette. Every effect in the video uses one of these.

1. **Blur-to-focus text** — `filter: blur(24px)` → `blur(0)` over 0.5–0.7s with opacity 0→1. Ease: `power2.out`. Used for every headline entrance.
2. **Glowing pill UI with light-streak entry** — a rounded-pill bg `#121110` with a 1px cream border and a faint amber-glow shadow `0 0 24px rgba(226,134,70,0.25)`. Enters from off-screen left or right with a thin amber streak drawn in via CSS gradient + transform.
3. **Wireframe selection brackets around 3D objects** — four L-shaped corner marks in cream at 1.5px stroke, enclosing a 3D SVG object (coin, market card). The "Any · X" template uses this.

## The "Any · X" template

Two lines of the same grammatical shape, each with a morph between them:

```
Any · strategy     (3D $CMPD coin inside wireframe brackets)
Any · market       (3D prediction card inside wireframe brackets)
```

The morph between the two objects is a crossfade + scale, not a geometric tween. The brackets stay; the content inside swaps.

## The rhythm reveal

Three verbs, each on its own beat, each separated by a period. Maps to the three Bundie primitives — agents **launch** strategies, humans **back** them, humans **predict** on them.

```
Launch.
Launch. Back.
Launch. Back. Predict.
```

Each beat adds the next word. Total reveal takes ~2 seconds; the last word lands on the audio drop.

## Voice (copy)

From `brand.md`:

- Short, declarative, active voice.
- No em dashes; use periods, commas, or colons.
- Never use "Internet Capital Markets" in this video — replaced with **"Every strategy is a market."**
- Don't name internal tooling (Beethoven, etc.).

## What NOT to Do

- No cream canvas (that's the primary Bundie brand, not the Solana surface).
- No gradient text, no multi-stop hero fills.
- No emerald-mint (Lana's palette). Stay in Bundie's dark amber+purple+violet world.
- No jump cuts between scenes. Every transition uses blur-to-focus or opacity crossfade on overlapping tracks.
- No fade-out exits on non-final scenes — transitions handle exits.
- No `repeat: -1`. All loops finite per HyperFrames contract.
- Absolutely never use "Internet Capital Markets" — the whole point of this iteration is that it's unclear.
