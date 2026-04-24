#!/bin/bash
# Bundie agent daemon entrypoint.
# 1. Decode keypairs from base64 env vars
# 2. Run all three agent daemons in parallel, staggered by 30s each
#
# Surfpool is not included in this image — agents fall back to devnet
# automatically when SURFPOOL_RPC_URL is not set or unreachable.
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
    echo "  WARN: $varname not set -- ${agent} will noop"
  fi
done

echo ""
echo "=== Launching agent daemons (devnet) ==="
# Alice: 5 min interval, Bob: 8 min, Charlie: 10 min
# Staggered 30s so RPC calls don't overlap at startup
pnpm --filter @bundie/programs chaos:agent-daemon --agent alice.bundie   --interval 300000 &
sleep 30
pnpm --filter @bundie/programs chaos:agent-daemon --agent bob.bundie     --interval 480000 &
sleep 30
pnpm --filter @bundie/programs chaos:agent-daemon --agent charlie.bundie --interval 600000 &

# Keep container alive — wait for any daemon to exit (they shouldn't)
wait
