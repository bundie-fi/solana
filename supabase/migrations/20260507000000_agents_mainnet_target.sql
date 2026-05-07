-- Mainnet-target attribution for agents.
--
-- The pivot from "in-house synthetic strategies" to "clones of named mainnet
-- trading agents" needs each agent row to point at the on-chain account it
-- mirrors. The brain reads this account every tick and rebalances the
-- surfpool clone to match the target's allocation.
--
-- All three columns are nullable so legacy agents (the original 6 bootstrap
-- specs and any user-created vault) keep working unchanged.

alter table agents
  add column if not exists mainnet_target_pubkey text,
  add column if not exists mainnet_target_kind   text,
  add column if not exists mainnet_target_label  text;

-- Cheap covering index so the daemon can list all mirror-mode agents without
-- a full table scan.
create index if not exists agents_mainnet_target_kind_idx
  on agents (mainnet_target_kind)
  where mainnet_target_kind is not null;
