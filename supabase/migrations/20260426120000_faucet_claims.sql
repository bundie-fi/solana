create table if not exists faucet_claims (
  id          bigserial primary key,
  wallet      text         not null,
  amount      bigint       not null,
  tx_sig      text         not null,
  created_at  timestamptz  not null default now()
);

create index faucet_claims_wallet_created_at_idx
  on faucet_claims (wallet, created_at desc);
