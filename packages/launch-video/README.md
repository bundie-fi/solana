# Bundie · Launch Video

HyperFrames composition of the 57-second launch video described in `/bundie_launch_video_v3.html` (treatment) and `/bundie_launch_video_beatmap_v2.html` (beatmap). Rendered to `renders/`.

## Structure

- `index.html` — root composition, 1920x1080, 57s, 11 frames stitched with alternating-track crossfades.
- `compositions/f1.html` … `compositions/f11.html` — per-scene sub-compositions.
- `DESIGN.md` — canonical palette, typography, motion rules.

## Scene Timing (matches beatmap v2)

| # | Frame                                         | Time         | Beatmap cue       |
| -- | -------------------------------------------- | ------------ | ----------------- |
| F1 | EVM protocol stack — "We built Bundie on EVM" | 0:00–0:03    | Piano fades in    |
| F2 | Amber "1" — "Yield, bundled in one click"     | 0:03–0:06    | E4 piano joins    |
| F3 | LIVE · MAINNET — "It's already shipping"     | 0:06–0:09    | Pad brightens     |
| F4 | Isometric wallet — "every strategy lives in one wallet" | 0:09–0:15 | Tension build    |
| F5 | 3D terminal mint — "So we went to Solana"    | 0:15–0:21    | **DROP**          |
| F6 | $CMPD coin — "every strategy is a capital market" | 0:21–0:27 | Chord stab     |
| F7 | Phone L tilt — "Back what you believe in"     | 0:27–0:33    | Arp + mobile tap  |
| F8 | Phone R tilt — "Predict on what you don't"   | 0:33–0:39    | Second build      |
| F9 | $CMPD day 30 panel — "Settled by the strategy itself" | 0:39–0:45 | **IMPACT**   |
| F10 | ICM thesis — "Internet Capital Markets for DeFi strategies" | 0:45–0:51 | Breakdown    |
| F11 | Waitlist CTA — "solana.bundie.fi" + wordmark | 0:51–0:57    | Outro rebuild     |

## Commands

```bash
cd packages/launch-video

npx hyperframes lint                                       # 0 errors, 0 warnings
npx hyperframes preview                                    # live preview
npx hyperframes render --quality draft                    # fast iteration
npx hyperframes render --quality high --output renders/final.mp4
```

## Music

Suno-generated track lives at `assets/music.mp3`. The `<audio>` clip is already wired in `index.html`.

### Rendering with audio

HyperFrames' screenshot capture mode (auto-selected here because GSAP uses `requestAnimationFrame` internally) drops the audio track from the muxed output — even though the compile step reports `audioCount: 1`. Workaround: mux audio manually with ffmpeg after the HyperFrames render:

```bash
# 1. Render video
npx hyperframes render --quality high --output renders/bundie-launch-v3.mp4

# 2. Mux music (current Suno take: main drop is at track 48s, so offset 33s
#    lands the drop on video 0:15 to match F5's terminal mint).
#    Audio fades mirror the F1 opening fade and F11 closing fade to cream.
ffmpeg -y -i renders/bundie-launch-v3.mp4 -ss 33 -i assets/music.mp3 -t 57 \
  -filter_complex "[1:a]afade=t=in:st=0:d=0.4,afade=t=out:st=56:d=1.0[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest \
  renders/bundie-launch-v3-final.mp4
```

If a future Suno take has its drop at a different track position, find it with:

```bash
ffmpeg -hide_banner -loglevel error -i assets/music.mp3 \
  -af "asetnsamples=n=48000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" \
  -f null - | awk '/pts_time:/ { t=$NF; getline; sub(/.*=/,"",$0); sub(/pts_time:/,"",t); printf "%3ds: %7.2f dB\n", t, $0 }'
```

The big RMS jump (≈+10 dB across 1s) is the drop. Offset = `drop_second - 15`.

### Sound-design hits (separate layer)

If adding them later: keystroke cluster F5, confirmation chime 0:18.5, coin reveal stab 0:21, mobile tap 0:30.2, SETTLED impact 0:39.5, resolution bloom 0:51 — see the beatmap v2 FX table for details.

## Why this is HyperFrames and not Remotion

`packages/video/` already contains a Remotion implementation of an earlier launch video with a different narrative (Hook → Problem → Pain → Visceral → Leaderboard → Prediction → etc.). This package implements the newer v3 story-mode treatment (EVM → turn → Solana → primitives → settled → thesis → CTA) as HyperFrames per user request.
