-- ---------------------------------------------------------------------------
-- markets — postgres mirror of on-chain prediction markets.
--
-- Markets live entirely on-chain (devnet, prediction-market program
-- Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4). Reading them via
-- getProgramAccounts on every backend request is too slow for the home-page
-- stats strip and the markets feed, so the chaos-sim daemon snapshots every
-- visible market into this table once per supervisor cycle.
--
-- This table is BEST-EFFORT. The on-chain Market account remains the source
-- of truth for share counts, vault balances, and resolution outcome — this
-- mirror is only for discovery / aggregation queries that don't need
-- byte-perfect freshness. `last_synced_at` lets operators age out stale rows
-- if a market disappears from chain (close_market).
--
-- Volumes are stored in 6dp bUSD base units (matches `nav_lamports` /
-- `nav_snapshots`) so totals can be summed without unit conversion.
--
-- Writes: chaos-sim's markets-indexer.ts after fetching all markets.
-- Reads:  backend GET /api/markets, GET /api/stats/platform.
-- ---------------------------------------------------------------------------

create table if not exists markets (
  market_pda           text         primary key,
  created_by           text         not null,    -- agent vault pubkey
  kind                 smallint     not null,    -- 1, 2, 3, 5, 6
  question             text,
  resolution_slot      bigint       not null,
  status               text         not null default 'open',
                          -- 'open' | 'resolved' | 'expired'
  outcome              smallint,                  -- 0=NO, 1=YES, null while open
  yes_volume           bigint       not null default 0,  -- 6dp bUSD base units
  no_volume            bigint       not null default 0,
  total_volume         bigint generated always as (yes_volume + no_volume) stored,
  created_at           timestamptz  not null default now(),
  resolved_at          timestamptz,
  last_synced_at       timestamptz  not null default now()
);

create index if not exists markets_status_resolution
  on markets (status, resolution_slot);
create index if not exists markets_created_by
  on markets (created_by, created_at desc);
