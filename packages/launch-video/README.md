# Bundie · Launch Video (v4 · dark editorial)

37-second capability demo in the dark Bundie-Solana brand. Replaces the earlier 57s cream story-mode video. Structure inspired by lana.ai's visual DNA (Lana-style blur-to-focus text, glowing pill UI, wireframe selection brackets) but adapted to Bundie's own palette and primitives.

## Structure

| # | Time | Scene | Content |
| -- | ----- | ----- | ------- |
| S1 | 0–4s | intro | "Most products give you *yield*." |
| S2 | 4–10s | prompt → answer | Glowing CLI types `bundie compose stable-compounder` → laptop reveals → "Bundie gives you *markets*" headline + strategy card with NAV chart |
| S3 | 10–12s | composition graph | `$CMPD` branches to Kamino 42% · marginfi 35% · Drift 23% (left) and 12.4k TVL · 8% APY market · 30d NAV (right) |
| S4 | 12–16s | Any · X morph | "Any · *strategy*" (3D $CMPD coin) → "Any · *market*" (prediction card) inside wireframe brackets |
| S5 | 16–18s | italics montage | "*Strategies*" → "*Markets*" giant italic serif, floating dashboard cards behind |
| S6 | 18–22s | back anything | "Back *anything*" + CLI types "Back Stable Compounder · $100 USDC" + trending strategies list |
| S7 | 22–25s | open markets | "Open *markets*" stats (24 markets · 3,847 predictions · $89k volume) + top strategies leaderboard + "And *spot* the winners" |
| S8 | 25–27s | plain language | "Settled from *on-chain* data." breath frame |
| S9 | 27–29s | execution | Back UI panel with cursor + tap ring on the amber Back button |
| S10 | 29–32s | **rhythm reveal** | "Launch. Back. Predict." tricolon + "Every strategy is a *market*." |
| S11 | 32–37s | logo lockup | Rabbit mark + "Bundie" italic wordmark + `solana.bundie.fi`, fades to black |

**Audio drop lands at S10 completion (video 0:31)** — the "Launch. Back. Predict." verbal payoff.

## Render commands

```bash
cd packages/launch-video

npx hyperframes lint
npx hyperframes render --fps 24 --quality high --output renders/bundie-launch-v4.mp4
```

## Audio mux

HyperFrames' screenshot capture mode (auto-selected because GSAP uses `requestAnimationFrame`) drops the audio track from the muxed output. Workaround — mux post-render with ffmpeg:

```bash
ffmpeg -y -i renders/bundie-launch-v4.mp4 -ss 17 -i assets/music.mp3 -t 37 \
  -filter_complex "[1:a]afade=t=in:st=0:d=0.9,afade=t=out:st=36:d=1.0[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest \
  renders/bundie-launch-v4-final.mp4
```

`-ss 17` offsets the Suno track so its main drop (at track 48s) lands on video 0:31 — where "Launch. Back. Predict." completes. A natural −23.87 dB quiet moment at 0:30 acts as the 50ms-air-gap before the drop.

Fade-in (0.9s) matches S1's opening fade from black; fade-out (1.0s) matches S11's fade to black.

### Re-aligning for a different Suno take

RMS-detect the drop:

```bash
ffmpeg -hide_banner -loglevel error -i assets/music.mp3 \
  -af "asetnsamples=n=48000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" \
  -f null - | awk '/pts_time:/ { t=$NF; getline; sub(/.*=/,"",$0); sub(/pts_time:/,"",t); printf "%3ds: %7.2f dB\n", t, $0 }'
```

The big RMS jump (≈+10 dB across 1s) is the drop. Offset = `drop_second - 31`.

## Design reference

See `DESIGN.md`. Palette derives from `packages/landing-page/brand.md` (Bundie's own Solana surface — not Lana's). Three motion primitives: blur-to-focus text, glowing pill UI with amber halo, wireframe selection brackets around 3D objects.

## Final deliverable

`renders/bundie-launch-v4-final.mp4` — 1920×1080, 24fps, 37s, h264 + AAC stereo 192k.
