# NAV-reader offset regression probes

These TypeScript probes guard the hard-coded byte offsets that
`packages/programs/programs/strategy-token/src/nav_readers/{drift,marginfi,marinade,kamino}.rs`
use to value live protocol state. They exist because we have been bitten twice:

- Drift `cumulative_deposit_interest` was read at offset **432** (wrong - returned
  `total_spot_fee` junk) and was corrected to **480** on 2026-04-23.
- marginfi `asset_share_value` was read at offset **88** (wrong - returned
  ~1.84e19 garbage that would massively overvalue positions) and was
  corrected to **80** on 2026-04-23.

Without a regression net, the next time an upstream SDK shuffles a struct
the bad layout silently corrupts NAV, which silently corrupts
prediction-market settlement.

## What each probe does

Each probe fetches one known live PDA from a public RPC, reads the same bytes
the corresponding NAV reader reads, prints them, and asserts they fall in
plausible ranges (mint is non-zero, decimals 0..=9, msol_price near 1.0,
cumulative_deposit_interest near Q1e10 1.0, etc.). On layout drift the
probe exits non-zero with an "expected X, got Y" message and CI blocks the PR.

## Run locally

```sh
pnpm --filter @bundie/programs probe:nav             # all probes
pnpm --filter @bundie/programs probe:drift           # one at a time
pnpm --filter @bundie/programs probe:marginfi
pnpm --filter @bundie/programs probe:marinade
pnpm --filter @bundie/programs probe:kamino
```

Override RPCs per-probe (`DRIFT_RPC_URL`, `MARGINFI_RPC_URL`,
`MARINADE_RPC_URL`, `KAMINO_RPC_URL`) or globally with `RPC_URL`.

## Adding a new probe

1. Pick a long-lived PDA on devnet for the protocol (or mainnet if devnet
   doesn't host one - marginfi is the precedent).
2. Mirror the byte offsets from the NAV reader as `const`s at the top of the
   probe; comment which file's offsets they shadow.
3. Print every field you read and one or two anchor fields (mint, decimals)
   so a maintainer can eyeball the output.
4. Assert each field is in a plausible range. Prefer ranges that catch the
   *kind* of garbage you would see if you read 8/16 bytes earlier or later -
   i.e. "must be > 0", "must be < 2^N", "must be in [a, b]".
5. Add the probe to `run-all.ts` and a `probe:<name>` script in
   `packages/programs/package.json`.
6. The CI job `nav-offset-probes` in `.github/workflows/ci.yml` already
   shells out to `probe:nav` - no workflow change needed.

The lesson: hard-coded byte offsets are a load-bearing form of trust in
upstream struct layouts. Treat the probes as the unit tests for that trust.
