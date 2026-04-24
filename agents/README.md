# Bundie agents

Each agent lives in `agents/<sns_name>/` and owns:

- `policies.yaml` — DENY-by-default Zerion policy manifest (parsed by
  `packages/zerion-agent/src/bundie/policy-loader.js`). See that file for
  the exact schema and `packages/zerion-agent/src/bundie/policies.js` for
  the five predicate implementations (`chain_lock`, `spend_limit`,
  `asset_whitelist`, `expiry`, `nav_divergence`) plus the `program_allowlist`
  fast-path predicate in `program-enforcer.js`.

## The three agents

- **`alice.bundie.sol` — lst-rotation.**
  Rotates between JitoSOL, bSOL, and mSOL tracking whichever LST has the
  highest stake-weighted APY in the current epoch. Vault
  `5ZnHtnSBvy4L9fGzGYaecVZ3WonWK3rLCqb4uaEgGXcm`.

- **`bob.bundie.sol` — basis-trade-usdc.**
  Market-neutral basis trade: holds USDC in a Kamino supply and shorts the
  equivalent SOL-PERP funding on a compatible perps venue. Tighter spend
  + NAV thresholds than alice. Vault
  `EBYDXh5RjbRX7eBobenPC59tvS4TCQzCUKYgx6auU8jb`.

- **`charlie.bundie.sol` — conservative-60-40-split.**
  Always-on 60% USDC in Kamino + 40% mSOL in Marinade. Minimal rebalancing.
  Lowest risk of the three. Vault
  `8zNazDgyrTX1CTaPk4G6hZ8r47SbVajh1vcFrqNAzBFg`.

## Symmetric architecture (Option X)

Every agent has the **same** symmetric policy shape: each `policies.yaml`
allows the PM program (`Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4`) for
market-creation/trading/resolution AND the three strategy-execution
programs (Kamino Lend, Marinade, SPL Stake Pool). Pre-pivot, alice and bob
were market-creator-only; under Option X every agent can do everything at
the policy level.

### On-chain insider-trading guard

Separation between agents is **mathematical, not social**. The
`create_market_v2` handler contains a two-line guard:

```rust
let target_agent = Pubkey::new_from_array(payload[32..64].try_into().unwrap());
require!(target_agent != ctx.accounts.creator.key(),
         MarketError::InsiderMarketForbidden);
```

So even though charlie's `policies.yaml` allows `create_market_v2`,
charlie *cannot* create a kind=6 market on charlie's own vault — the
program rejects the tx with `InsiderMarketForbidden`. charlie *can*
create a kind=6 market targeting alice or bob. Symmetric. Provable by
reading the program, no policy convention to audit.

`resolve_market_v2` enforces the twin: `data_a.key() == target_agent`
(`MarketError::WrongTargetAgent`). Together the two guards mean an
agent can't game its own resolution either.

## Enforcement

Every rebalance tx is evaluated in order. Any predicate returning
`{ allow: false }` rejects the tx and the Zerion vault never signs it.
The refusal-demo script (`packages/zerion-agent/scripts/demo-refusal.mjs`)
exercises the swap path for the Zerion bounty video. Non-swap flows
(`create_market_v2`, Kamino/Marinade ops, etc.) go through the
`program_allowlist` fast-path in `program-enforcer.js`.

## Adding a new agent

1. Pick an SNS subdomain under `.bundie.sol` (or `.bundie` for mainnet).
2. Generate a vault keypair:
   `solana-keygen new --outfile packages/programs/scripts/chaos-sim/keys/<name>-vault.json`
3. Add the agent to `AGENTS` in
   `packages/programs/scripts/chaos-sim/src/register-agent-subdomains.ts`.
4. Run `npx tsx scripts/chaos-sim/src/register-agent-subdomains.ts` from
   `packages/programs` to register the `<name>.bundie` subdomain.
5. `mkdir agents/<name>.bundie.sol` and copy `charlie`'s `policies.yaml`
   as the closest symmetric template.
6. Edit `sns_identity`, `vault_address`, `strategy`, and the thresholds.
