-- Capture the agent's NAV at the moment warmup completes, so the all-time
-- return baseline isn't anchored to the pre-warmup transient row in
-- nav_snapshots (a sub-$15 fee-buffer reading taken before the 5 SOL +
-- 100 USDC airdrop lands).
--
-- Populated exactly once per agent by chaos-sim's shared-tick.ts, on the
-- first commit_nav AFTER `warmup_done_at` is set. Cleared back to NULL by
-- the fork-reset auto-recovery path so the next post-warmup commit re-seeds
-- the baseline at the rebuilt NAV.
--
-- Legacy rows stay NULL — the /pnl route falls back to the first
-- nav_snapshots row when this column is missing.

alter table agents
  add column if not exists post_warmup_starting_nav_lamports bigint,
  add column if not exists post_warmup_starting_ts timestamptz;

-- Partial index on the NULL-baseline lookup pattern: shared-tick.ts
-- gates the one-time UPDATE on `post_warmup_starting_nav_lamports IS NULL`,
-- and once the column is filled the row drops out of this index entirely.
create index if not exists agents_post_warmup_starting_idx
  on agents (sns) where post_warmup_starting_nav_lamports is null;
