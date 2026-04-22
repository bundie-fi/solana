# Bundie · Launch video · Design (v5 · 30s tightened)

## Style Prompt

Dark editorial product demo tightened for Twitter autoplay. 30 seconds total, 10 frames, no dead beats, no fake metrics. Opens with a 1.5-second hook that gets the scroll-or-stay decision done, moves the "Launch. Back. Predict." triad to the middle so the second half demonstrates each verb rather than recaps them, and ends on a bunny + waitlist CTA.

Visual DNA: single-color world (deep near-black canvas, warm cream type, vibrant amber-glow italics), bold italic serif for every punchline word, glowing amber pill UI for the CLI moment, product-UI cards with real-looking inputs and data.

## Canvas

- 1920×1080, **24 fps**
- Background: `#0a0908` with a faint radial amber ambient glow
- Runtime: **30 seconds, 10 sub-compositions**

## Colors (v5 palette)

Shifted from v4 for a warmer, more vibrant feel. v4 used the Solana landing brand hex; v5 bumps amber from `#c2570c` → `#ff7a1a` for stronger on-dark contrast and switches cream from `#f6f3ee` → `#f5ebd6` (slightly warmer).

| Token            | Hex                       | Usage                                        |
| ---------------- | ------------------------- | -------------------------------------------- |
| `--bg-deep`      | `#0a0908`                 | Base canvas                                  |
| `--bg-card`      | `#14110d`                 | Product UI cards, terminal                   |
| `--bg-panel`     | `#1c1814`                 | Raised panels                                |
| `--line`         | `rgba(232,223,201,0.10)`  | Dividers                                     |
| `--line-strong`  | `rgba(232,223,201,0.20)`  | Card borders                                 |
| `--text`         | `#f5ebd6`                 | Primary type                                 |
| `--text-soft`    | `#c9bfa6`                 | Body, secondary                              |
| `--text-muted`   | `#8a8075`                 | Mono captions, micro-copy                    |
| `--amber`        | `#ff7a1a`                 | Back primitive button, accent                |
| `--amber-bright` | `#ffa860`                 | Italic display accents, hero highlight       |
| `--amber-glow`   | `rgba(255,122,26,0.4)`    | Button shadow, CLI glow                      |
| `--purple`       | `#a78bfa`                 | Agent handle, predict primitive              |
| `--purple-bright`| `#c4b5fd`                 | Triad "Predict" verb                         |
| `--green`        | `#4ade80`                 | Live/settled states, positive values         |
| `--red`          | `#f87171`                 | Predict NO option, negative values           |

## Typography

- **Instrument Serif** — display headlines, italic emphasis (amber-bright), card titles.
- **JetBrains Mono** — CLI, timestamps, tickers, badges, handles.
- **Figtree** — body, button labels.

Hero sizes at 1920×1080: 180–260px for single-word reveals, 96–120px for two-line headlines, 22–28px for mono labels.

## Structure

| # | Time | Scene | Beat |
| -- | ----- | ----- | ------- |
| F1 | 0–3s | opening hook | "Yield is *step one*." + brand/chain label |
| F2 | 3–5s | agent context | "strategy-creator.sol · autonomous agent" badge + "An agent composes a strategy." |
| F3 | 5–8s | terminal command | Glowing amber CLI types `bundie compose stable-compounder` |
| F4 | 8–11s | composed reveal | "Composed." + strategy card with USDC/Kamino/NAV metadata |
| F5 | 11–14s | hero coin | 3D $CMPD coin + "Now it's a *tradeable asset*." |
| F6 | 14–17s | triad reveal | "Launch. Back. Predict." + "three ways to earn · one market" |
| F7 | 17–20s | back flow | Back card with USDC input + $CMPD output + amber Back button |
| F8 | 20–23s | predict market | YES/NO market + "settles from on-chain NAV · no oracle" |
| F9 | 23–26s | settle proof | Day 30 settled chart + "+8.7% APY" + YES payouts auto-sent |
| F10 | 26–30s | end card | Bunny + "Bundie" wordmark + "join the waitlist" + URL chip |

## Motion Primitives

1. **Blur-to-focus text** — `filter: blur(24px)` → `blur(0)` over 0.5–0.7s. Used for every headline entrance.
2. **Glowing amber pill UI** — CLI input with `box-shadow: 0 0 24px rgba(255,122,26,0.4)`. Enters with a brief scale-in.
3. **Product-UI cards** — rounded `#14110d` cards with 1px cream-alpha borders, materialize via y+opacity.
4. **Animated chart draw** — stroke-dashoffset from full length to 0 over 1.2s.
5. **Tap ring** — radial expansion from 0 scale to 7-8x with opacity fade, over 0.55s, for button confirmation.

## Rhythm Reveal (F6)

```
Launch. Back. Predict.
```

- **Launch** (amber-bright) — what agents do
- **Back** (amber-bright) — what humans do to strategies they trust
- **Predict** (purple-bright) — what humans do on strategies they don't

Subtitle below: `three ways to earn · one market`

## Audio

Drop lands on F3 terminal command (video 0:08), not the triad reveal. The command execution IS the payoff beat — agent autonomously minted a real asset. The triad and subsequent primitive demos play over sustained peak energy.

Suno track drop is at track second 48. Offset `-ss 40` so track 48s lands on video 8s.

## Voice (copy)

- One italic word per amber moment: *step one*, *tradeable asset*, *Stable Compounder*, *$CMPD*.
- Periods only on full sentences.
- Never "Internet Capital Markets" or the old cryptic "Any · X" layout.
- No fake metrics — pre-launch product showing live numbers ("24 markets · 3,847 predictions") reads as misleading. Scale is implied by UI polish.

## What NOT to Do

- No cream canvas — this is the dark Solana surface.
- No fake live counts. No "3,847 predictions" etc. The waitlist viewer would check and see zero.
- No separate "Settled from on-chain data" text frame — fold that label into F8 and F9 card footers where it's contextual.
- No two sequential end frames (bunny then wordmark). Single end card only.
- No gradient text or multi-stop hero fills.
- No jump cuts between scenes — every transition uses blur-to-focus or opacity crossfade.
- No fade-out exits on non-final scenes — transitions handle exits.
- No `repeat: -1`. All loops finite per HyperFrames contract.
