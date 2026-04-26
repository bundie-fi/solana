-- Bundie agent marketplace registry.
--
-- The on-chain BundieVault PDA is the source of truth for ownership, treasury
-- balance, and committed NAV. This off-chain registry holds the human-facing
-- metadata (display name, brain prompt, policies) plus a status enum so the
-- web wizard can paginate / filter agents without a full RPC scan.
--
-- Lifecycle:
--   pending_init  → row inserted, agent keypair provisioned in OWS vault, but
--                   the wizard hasn't broadcast init_vault + deposit_to_vault yet.
--   active        → vault initialized + seeded on-chain. Daemon may pick it up.
--   paused        → owner toggled the kill switch (future).
--   retired       → close_vault broadcast; vault PDA closed.

create table if not exists agents (
  id              bigserial primary key,
  sns             text         not null unique,
  display_name    text         not null,
  tagline         text         null,
  emoji           text         null,
  owner_wallet    text         not null,
  vault_pda       text         not null unique,
  agent_pubkey    text         not null unique,
  brain_md        text         not null,
  policies_yaml   text         not null,
  preset          text         not null,
  status          text         not null default 'pending_init',  -- 'pending_init' | 'active' | 'paused' | 'retired'
  seed_amount_busd bigint      not null,
  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now()
);

create index agents_status_updated_at_idx on agents (status, updated_at desc);
create index agents_owner_wallet_idx on agents (owner_wallet);

-- Per-tick action log written by the daemon. Owned by the agent SNS so we
-- can render an activity feed on the agent's profile page without joining.
create table if not exists agent_action_log (
  id          bigserial primary key,
  agent_sns   text         not null references agents(sns) on delete cascade,
  tick_at     timestamptz  not null default now(),
  action_type text         not null,
  reasoning   text         null,
  result_json jsonb        null
);

create index agent_action_log_sns_tick_idx on agent_action_log (agent_sns, tick_at desc);
