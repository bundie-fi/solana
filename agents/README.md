# Bundie agents

Each agent lives in `agents/<sns_name>/` and owns:

- `policies.yaml` — DENY-by-default Zerion policy manifest (parsed by
  `packages/zerion-agent/src/bundie/policy-loader.js`). See that file for
  the exact schema and `packages/zerion-agent/src/bundie/policies.js` for
  the five predicate implementations (`chain_lock`, `spend_limit`,
  `asset_whitelist`, `expiry`, `nav_divergence`).

Agents are created today:
- `alice.bundie.sol` — basis-trade-usdc strategy
- `bob.bundie.sol`   — conservative-split-usdc-msol strategy

Vault addresses are placeholders until Phase 6 runs the devnet deploy
(`chaos:setup` creates the OWS vault and assigns a real pubkey).

## Enforcement

Every rebalance tx is evaluated in order. Any predicate returning
`{ allow: false }` rejects the tx and the Zerion vault never signs it.
The refusal-demo script (`packages/zerion-agent/scripts/demo-refusal.mjs`)
exercises this path for the Zerion bounty video.

## Adding a new agent

1. Pick an SNS subdomain under `.bundie.sol` (or `.bundie` for mainnet).
2. `mkdir agents/<sns_name>` and copy the closest existing `policies.yaml`.
3. Edit `sns_identity`, strategy, and thresholds to match.
4. Leave `vault_address` as the `REPLACE_WITH_*_VAULT_PUBKEY` placeholder —
   `chaos:setup` fills it in on next run.
