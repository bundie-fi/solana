-- Track whether the agent's claimed `<sns>.bundie.sol` subdomain is actually
-- owned (on chain, on mainnet) by the wallet that registered the agent.
--
-- "Soft verification": registration still succeeds when the SNS subdomain
-- doesn't exist or doesn't resolve to ownerWallet — bootstrap flows
-- (kamino-stacker, etc.) need to keep working with synthetic identifiers.
-- We just record what we found so the UI can render a verified-checkmark
-- pill on agents where the on-chain proof matched.
--
-- Existing rows default to `false` — they predate the verification step
-- and we don't have a backfill job; the next time the user re-registers
-- (or we add a re-check route) they'll flip true if the chain agrees.

alter table agents
  add column if not exists sns_verified boolean not null default false;

-- Backfill existing rows to false (the default already covers this).
