-- claims — ledger of bettor redemptions on resolved prediction markets.
--
-- The on-chain `redeem` ix burns winning shares and pays out 1:1 in bUSD,
-- but emits no off-chain receipt. We mirror each successful redeem here so
-- the agent profile can render "$X paid out to bettors" as a credibility
-- signal — without paging through chain history every time the page loads.
--
-- Trust model: the writer route at POST /api/markets/:marketPda/claim-recorded
-- is unauthenticated. The frontend calls it AFTER its own wallet has signed
-- and confirmed the redeem tx; lying about a self-claim has no economic
-- benefit (the on-chain payout already happened or didn't). A later
-- iteration can verify via getTransaction() if abuse appears.
--
-- All amounts stored in 6dp base units (matches bUSD / share-mint decimals).
-- payout_lamports is named for symmetry with other lamport-style columns
-- elsewhere in the schema even though it tracks bUSD base units, not SOL.

create table if not exists claims (
  id              bigserial   primary key,
  market_pda      text        not null,
  redeemer        text        not null,         -- bettor wallet pubkey
  share_mint      text        not null,         -- yes_mint or no_mint
  shares_redeemed bigint      not null,         -- 6dp base units
  payout_lamports bigint      not null,         -- 6dp bUSD base units (1:1 with shares)
  tx_sig          text        not null unique,
  redeemed_at     timestamptz not null default now()
);

create index if not exists claims_market_pda_idx on claims (market_pda);
create index if not exists claims_redeemer_idx on claims (redeemer);
create index if not exists claims_market_redeemed_at_idx
  on claims (market_pda, redeemed_at desc);
