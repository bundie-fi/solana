-- ---------------------------------------------------------------------------
-- nav_snapshots — append-only time-series of agent NAV commits.
--
-- The chaos-sim daemon computes each agent's NAV every tick from surfpool
-- balances, commits it to devnet via `commit_nav`, then mirrors the result
-- here so the UI can chart equity curves without re-reading every BundieVault
-- account on the RPC. Each row corresponds to a successful on-chain commit.
--
-- Component fields (`*_usd_micros`) carry the per-protocol breakdown that
-- was discarded by the original `computeNavFromSurfpoolBalances`. They're
-- expressed in micro-USD (1e6) to match the bUSD lamport scale and stay
-- inside bigint without losing sub-cent precision.
--
-- `base_usd_micros` lumps native SOL + non-cToken SPL balances (USDC, mSOL,
-- jitoSOL, etc.). Kamino / Solend each get their own line. `perps_usd_micros`
-- is Jupiter Perps equity (the column was historically called zetaUsd before
-- the Zeta retire).
--
-- Writes: chaos-sim's shared-tick.ts after a successful `commit_nav`.
-- Reads:  backend GET /api/agents/:sns/pnl.
-- ---------------------------------------------------------------------------

create table if not exists nav_snapshots (
  agent_sns           text        not null,
  ts                  timestamptz not null default now(),
  nav_epoch           bigint      not null,
  nav_lamports        bigint      not null,
  nav_slot            bigint      null,
  base_usd_micros     bigint      null,  -- SOL + non-cToken SPL (USDC, mSOL, jitoSOL) priced
  kamino_usd_micros   bigint      null,
  solend_usd_micros   bigint      null,
  perps_usd_micros    bigint      null,  -- Jupiter Perps equity
  primary key (agent_sns, nav_epoch)
);

create index if not exists nav_snapshots_agent_ts
  on nav_snapshots (agent_sns, ts desc);
