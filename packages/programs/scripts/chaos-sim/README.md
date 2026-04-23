# Chaos Sim — multi-agent strategy/market stress test

A driver that exercises the live devnet strategy-token + prediction-market
programs through `@bundie/sol-cli` from multiple wallets concurrently.

Goal: surface failure modes that single-wallet manual testing misses —
race conditions, NAV inflation under traffic, settlement mismatches,
panics from unexpected protocol combos.

## Three roles

- **Creators** open strategies with random protocol combos
- **Market-makers** open YES/NO markets on the strategies that exist
- **Traders** buy YES or NO with random small amounts

Each role runs in its own wallet (so signature failures and rate-limits
don't mask each other). The harness records every tx hash, the NAV
before/after, and any anomalies (panics, negative NAV, settlement
mismatches) into `logs/run-<timestamp>.jsonl`.

## Setup

```bash
# 1. Generate a fresh wallet pool (writes to keys/wallet-{0..N}.json)
pnpm --filter @bundie/programs chaos:setup

# 2. Fund them from your default solana keypair (sends SOL + USDC)
pnpm --filter @bundie/programs chaos:fund

# 3. Run the simulation
pnpm --filter @bundie/programs chaos:run
```

## Wallet pool

5 wallets × 0.05 SOL × 2.5 devnet USDC each = 0.25 SOL + 12.5 USDC drawn
from your default keypair (`solana address`). Fits the deployer's current
14.99 USDC budget with reserve.

## Anomaly detection

The recorder flags:
- any tx that fails confirmation
- NAV reads that drop > 50% slot-over-slot (no rebalance burned that)
- prediction-market settlement that doesn't match the recorded NAV at
  resolution slot
- USDC balance going negative on any tracked wallet
- panic strings in tx logs

Output: `logs/run-<ts>/anomalies.jsonl` + a final stdout summary.

## Caveats

- USDC mint is multisig — can't faucet more, scope trades to small amounts
- Devnet RPC is rate-limited — runner has a 200ms inter-tx jitter and
  retries on 429
- This is NOT a property-based fuzzer — it's a stochastic stress test
- Programs are NOT mocked; every tx hits live devnet
