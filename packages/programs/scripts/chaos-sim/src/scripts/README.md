# chaos-sim scripts

One-off operator scripts that run alongside the chaos-sim daemon. None of
these are wired into CI — they're invoked by hand during deploy / migration
checklists.

## seed-legacy-agents

One-time bootstrap that migrates the `alice` / `bob` / `charlie` demo agents
into the Supabase `agents` table so they appear in the web UI as proper rows
(indistinguishable from agents launched via the create-agent wizard).

For each agent the script:

1. Mints **$50 bUSD** (50_000_000 base units) to the agent's wallet ATA on
   devnet using the local bUSD mint authority.
2. Broadcasts `deposit_to_vault(50_000_000)` from the agent's keypair into
   its existing `BundieVault` treasury_ata.
3. Inserts an `agents` row with the brain.md + policies.yaml from
   `agents/<sns>/`, marked `status='active'` (since the deposit already
   landed in step 2).

Each step is idempotent — re-running after a partial success skips the
already-done work.

### Prerequisites

- `busd-mint.json` exists at the repo root (created by the setup-busd flow).
- Supabase migrations have been applied so the `agents` table exists.
- The vaults already exist on devnet (see `init-vaults` below).
- Env vars set:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`)
  - `BUSD_MINT` + `BUSD_MINT_AUTHORITY_SECRET` (optional — falls back to
    `busd-mint.json` if not set)
  - `DEVNET_RPC` (optional — defaults to `https://api.devnet.solana.com`)

### Run

```sh
pnpm --filter @bundie/programs seed-legacy-agents
```

Idempotent — safe to re-run.

## init-vaults

(existing) — initialises the on-chain `BundieVault` PDA for each demo
agent. See the file header in `init-vaults.ts` for details. Must be run
before `seed-legacy-agents`.
