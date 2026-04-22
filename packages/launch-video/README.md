# Bundie · Launch Video (v5 · 30s tightened)

30-second dark editorial capability demo for Twitter autoplay. Opens with a 1.5-second hook, makes the agent narrative explicit, moves the "Launch. Back. Predict." triad to the middle so the second half demonstrates each verb, and ends on a bunny + waitlist CTA.

Replaces v4 (37s); all `f*.html` beats are fresh — no carryover from v4's `s*.html` structure.

## Structure

| # | Time | Scene | Content |
| -- | ----- | ----- | ------- |
| F1 | 0:00–0:03 | opening hook | "Yield is *step one*." + `BUNDIE · SOLANA` anchor |
| F2 | 0:03–0:05 | agent context | `strategy-creator.sol · autonomous agent` pulsing badge + "An agent composes a strategy." |
| F3 | 0:05–0:08 | terminal command | Glowing amber CLI types `bundie compose stable-compounder` → submit pulse ← **audio drop lands here** |
| F4 | 0:08–0:11 | composed reveal | "Composed." + `$CMPD` strategy card with USDC / Kamino / NAV $1.0000 |
| F5 | 0:11–0:14 | hero coin | 3D `$CMPD` coin + "Now it's a *tradeable asset*." + `LIVE PRICE · PUBLIC TRACK RECORD` |
| F6 | 0:14–0:17 | triad reveal | "Launch. Back. Predict." + "three ways to earn · one market" |
| F7 | 0:17–0:20 | back flow | Back card: 100 USDC → 92.4 $CMPD + amber "Back · 100 USDC →" button with tap ring |
| F8 | 0:20–0:23 | predict market | YES $0.42 / NO $0.58 + "SETTLES FROM ON-CHAIN NAV · NO ORACLE" footer |
| F9 | 0:23–0:26 | settle proof | Day 30 chart climbs past 8% threshold + SETTLED badge + "+8.7% APY" + "YES payouts auto-sent" |
| F10 | 0:26–0:30 | end card | Rabbit mark + "Bundie" italic wordmark + "join the waitlist" + `solana.bundie.fi` URL chip → fade to black |

## What changed vs v4

**Cut:**
- Fake metrics frame ("24 markets · 3,847 predictions · $89k volume") — pre-launch misleading
- Standalone "Settled from on-chain data" text frame — folded into F8 and F9 footers
- Bunny-only then Bundie-only sequential end frames — merged into F10
- "Any · strategy" / "Any · market" cryptic split layout — replaced with direct reveals

**Fixed:**
- Opening hook tightened 3s → 1.5s; Twitter autoplay decision lands in the first beat
- Agent narrative made explicit in F2 (pulsing badge) so F3 reads as agent activity, not a developer at a CLI
- "Launch. Back. Predict." moved from 32s (V4 closing) → 15s (V5 middle) so F7, F8, F9 demonstrate each verb instead of recapping
- Runtime 37s → 30s to fit Twitter's autoplay sweet spot

**Added:**
- NAV value on F4 (`$1.0000`) sets up F9's `+8.7% APY` as a visual payoff arc
- "join the waitlist" verb on end card — viewers know what to do, not just where to go

## Render commands

```bash
cd packages/launch-video

npx hyperframes lint
npx hyperframes render --fps 24 --quality high --output renders/bundie-launch-v5.mp4
```

## Audio mux

HyperFrames' screenshot capture mode (forced by GSAP's `requestAnimationFrame`) drops audio from its muxed output. Workaround — mux post-render:

```bash
ffmpeg -y -i renders/bundie-launch-v5.mp4 -ss 40 -i assets/music.mp3 -t 30 \
  -filter_complex "[1:a]afade=t=in:st=0:d=0.9,afade=t=out:st=29:d=1.0[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest \
  renders/bundie-launch-v5-final.mp4
```

`-ss 40` offsets the Suno track so its drop (track 48s) lands on video 0:08 — the F3 terminal submit pulse. A natural −23.89 dB quiet moment at 0:07 acts as the air-gap before the drop. Fade-in 0.9s matches F1 opening; fade-out 1.0s matches F10 fade to black.

### RMS alignment

| Video time | RMS (dB) | Beat |
| --- | --- | --- |
| 0:00 | −23.7 | fade-in from black |
| 0:01–0:06 | −14 to −19 | atmospheric build (F1→F2→F3 type) |
| 0:07 | **−23.89** | natural air-gap |
| **0:08** | **−12.56** | **DROP** · F3 terminal submit |
| 0:09–0:28 | −12 to −13 | sustained peak (F4→F9 demos) |
| 0:29 | −18 | fade-out to black (F10 exit) |

### Re-aligning for a different Suno take

```bash
ffmpeg -hide_banner -loglevel error -i assets/music.mp3 \
  -af "asetnsamples=n=48000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" \
  -f null - | awk '/pts_time:/ { t=$NF; getline; sub(/.*=/,"",$0); sub(/pts_time:/,"",t); printf "%3ds: %7.2f dB\n", t, $0 }'
```

The big RMS jump (≈+10 dB across 1s) is the drop. Offset = `drop_second - 8`.

## Final deliverable

`renders/bundie-launch-v5-final.mp4` — 1920×1080, 24fps, 30s, h264 + AAC stereo 192k.
