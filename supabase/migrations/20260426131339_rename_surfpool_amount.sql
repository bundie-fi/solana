-- ---------------------------------------------------------------------------
-- Rename surfpool_actions.amount_lamports → amount_base_units.
--
-- "Lamports" is the SOL base unit (9 decimals), but this column also holds
-- USDC base units (6 decimals) and other token base units. The original name
-- was a misnomer — the actual decimals are inferred per-token at read time.
-- Rename to a token-agnostic name so the schema reads honestly.
-- ---------------------------------------------------------------------------

alter table surfpool_actions rename column amount_lamports to amount_base_units;
