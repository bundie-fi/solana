# Bundie · Launch video · Design

## Style Prompt

Editorial-trader aesthetic. Warm cream canvas, deep ink type, Instrument Serif headlines paired with JetBrains Mono detail work. Motion is confident and kinetic — not cinematic, not corporate. Reads as a serious crypto product ships-fast, not as an EDM drop reel. Every scene builds on the last; the narrative turns on the terminal mint at 0:15 (drop) and the settled proof at 0:39.5 (impact).

## Canvas

- 1920x1080, 30 fps
- Background: cream `#faf5ed` (NOT dark)
- Runtime: 57 seconds, 11 frames

## Colors

| Role            | Hex       | Usage                                                                   |
| --------------- | --------- | ----------------------------------------------------------------------- |
| `--cream`       | `#faf5ed` | Stage background, type on dark                                          |
| `--cream-deep` | `#f4ecda` | Secondary surfaces, URL chip                                            |
| `--cream-line` | `#e8dfc9` | Borders, dividers                                                       |
| `--ink`         | `#1a1814` | Hero type                                                               |
| `--ink-soft`   | `#4a433a` | Secondary type                                                          |
| `--ink-muted`  | `#8a8075` | Mono captions, micro-copy                                               |
| `--amber`       | `#c2570c` | Earn mode · Back primitive · DROP signal                                |
| `--amber-light`| `#fbbf24` | Coin highlights, arp accents                                            |
| `--purple`      | `#6d28d9` | Predict mode · ICM thesis · IMPACT signal                               |
| `--purple-light`| `#a78bfa` | Purple accents                                                          |
| `--green`       | `#15803d` | Live/settled/OK states                                                  |
| `--solana`      | `#9945FF` | Solana chain callouts                                                   |
| `--solana-2`   | `#14F195` | Solana gradient tail                                                    |

Gold/amber = Earn. Purple = Predict. Never swap.

## Typography

- **Instrument Serif** — hero headlines, scene copy, wordmark. Italics carry emphasis.
- **JetBrains Mono** — timestamps, captions, terminal, stats, tags. Letter-spacing ~0.08–0.14em, uppercase for micro-labels.
- **Figtree** — body UI, button labels.

Hero sizes at 1920x1080: 128–180px serif for single-line heroes, 96–120px for two-line, 28–32px mono captions.

## Motion Rules

- Entrances: `gsap.from()` lifting 40–80px with `power3.out` or `expo.out`, 0.5–0.8s. Offset first tween by 0.15–0.25s.
- Scene transitions: beat-locked crossfade at frame boundaries. No jump cuts. The DROP at 0:15 and IMPACT at 0:39.5 land on scene-entry frames.
- Vary easing across entrances within a scene — at least 3 eases per scene.
- Coin/hero elements idle-bob 3.2s ease-in-out sine; terminal cursor blinks 1s square.
- No `repeat: -1`. All loops use calculated finite repeats.

## Voice (copy)

Short. Declarative. Trader-coded, not hype-coded. "Yield, bundled in one click." not "The future of DeFi starts here." Italics carry the emotional word ("shipping", "one wallet", "believe in").

## What NOT to Do

- No trailer cinematic epic (Hans-Zimmer risers, slow reveals)
- No EDM mainstage cheese or dubstep wobble visuals
- No corporate uplifting pastels — stay in the cream/ink/amber/purple lane
- No dark glossy backgrounds with neon gradients — this video lives on cream
- No full-screen linear gradients on the cream canvas (banding); use radial or solid+localised glow
- No generic tech-explainer loops or stock-footage feel
- No emoji in copy, no gradient wash text
- Never jump-cut between scenes — always animate
- Never animate an exit before a transition fires (transition IS the exit, except final scene)
