-- ---------------------------------------------------------------------------
-- surfpool_actions — append-only feed of agent strategy txs that landed on
-- the local Surfpool fork.
--
-- Surfpool is a local Solana mainnet fork where chaos-sim agents execute
-- against real protocol IDs (Kamino / Marinade / Jito / Drift / Orca /
-- MarginFi). The txs are real but invisible to web visitors because Surfpool
-- has no public explorer. This table captures each landed tx so the agent
-- profile page can render a "Live strategy execution on Solana mainnet fork"
-- panel.
--
-- Writes: chaos-sim's recordSurfpoolAction() helper (service-role key).
-- Reads:  backend GET /api/agent/:sns/surfpool-activity (service key).
-- ---------------------------------------------------------------------------

create table if not exists surfpool_actions (
  id              bigserial   primary key,
  agent_sns       text        not null,
  slot            bigint      not null,
  tx_sig          text        not null,
  protocol        text        not null,
  action_type     text        not null,
  amount_lamports bigint      null,
  token_mint      text        null,
  notes           text        null,
  created_at      timestamptz not null default now()
);

create index if not exists surfpool_actions_agent_sns_created_at_idx
  on surfpool_actions (agent_sns, created_at desc);

create index if not exists surfpool_actions_tx_sig_idx
  on surfpool_actions (tx_sig);
