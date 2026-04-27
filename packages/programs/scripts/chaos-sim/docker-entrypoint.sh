#!/bin/bash
# Bundie agent daemon entrypoint.
#
# 1. Decode each agent's vault keypair from base64 env vars into the keys/ dir
#    where run-agent-daemon's resolveSupabaseAgent looks for `<short>-vault.json`.
# 2. Bridge MAINNET_RPC_URL → SURFPOOL_RPC_URL if no surfpool fork is wired up.
# 3. Run a single supervisor-mode daemon that polls the Postgres `agents` table
#    every CHAOS_SIM_POLL_INTERVAL_MS and ticks every active agent in parallel.
#
# Brain prompts and policies live in the DB — there is no on-disk agents/
# folder. To add or edit agents, write to the agents table (the create-agent
# wizard does this automatically).
set -e

KEYS_DIR=/app/packages/programs/scripts/chaos-sim/keys
mkdir -p "$KEYS_DIR"

echo "=== Bundie Agent Daemon ==="
for agent in alice bob charlie; do
  varname="${agent^^}_VAULT_KEYPAIR_B64"
  val="${!varname}"
  if [ -n "$val" ]; then
    echo "$val" | base64 -d > "$KEYS_DIR/${agent}-vault.json"
    echo "  ok: ${agent}-vault.json"
  else
    echo "  WARN: $varname not set -- ${agent} will be skipped by the supervisor"
  fi
done

# Bridge MAINNET_RPC_URL → SURFPOOL_RPC_URL so the daemon's rate-surface
# readers (Kamino, Marinade, MarginFi, SPL stake pool) always see live mainnet
# data even when a local surfpool fork is not running.
if [ -n "$MAINNET_RPC_URL" ] && [ -z "$SURFPOOL_RPC_URL" ]; then
  export SURFPOOL_RPC_URL="$MAINNET_RPC_URL"
  echo "  bridged: SURFPOOL_RPC_URL=$SURFPOOL_RPC_URL"
else
  echo "  SURFPOOL_RPC_URL=${SURFPOOL_RPC_URL:-<not set, will use localhost>}"
fi

echo ""
echo "=== Launching supervisor (Postgres-poll mode) ==="
exec pnpm --filter @bundie/programs chaos:agent-daemon
