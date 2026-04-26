-- Auto-refresh agents.updated_at on every row update.
--
-- Previously the route handlers wrote `updated_at: new Date().toISOString()`
-- on every UPDATE — easy to forget in a new code path. A trigger keeps the
-- column honest no matter who issues the UPDATE.

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agents_set_updated_at on agents;
create trigger agents_set_updated_at
  before update on agents
  for each row execute function set_updated_at();
