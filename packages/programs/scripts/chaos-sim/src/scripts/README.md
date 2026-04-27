# chaos-sim scripts

One-off operator scripts that run alongside the chaos-sim daemon. None of
these are wired into CI — they're invoked by hand during deploy / migration
checklists.

## init-vaults

Initialises the on-chain `BundieVault` PDA for each agent. See the file
header in `init-vaults.ts` for details. Run once per fresh deploy target
before agents can `commit_nav`.
