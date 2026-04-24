#!/bin/bash
# Bundie agent daemon entrypoint.
# 1. Decode keypairs from base64 env vars
# 2. Start surfpool (mainnet fork, localhost:8899)
# 3. Run all three agent daemons in parallel, staggered by 30s each
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
echo "=== Starting surfpool (mainnet fork) ==="
surfpool start --network mainnet --no-tui &
SURFPOOL_PID=$!

echo "Waiting for surfpool..."
for i in $(seq 1 30); do
  if curl -sf -X POST http://127.0.0.1:8899 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' > /dev/null 2>&1; then
    echo "  ok (${i}x2s)"
    export SURFPOOL_RPC_URL=http://127.0.0.1:8899
    break
  fi
  sleep 2
done
[ -z "$SURFPOOL_RPC_URL" ] && echo "  WARN: surfpool not ready -- running devnet-only"

echo ""
echo "=== Launching agent daemons ==="
# Alice: 5 min interval, Bob: 8 min, Charlie: 10 min
# Staggered 30s so RPC calls don't overlap at startup
pnpm --filter @bundie/programs chaos:agent-daemon --agent alice.bundie   --interval 300000 &
sleep 30
pnpm --filter @bundie/programs chaos:agent-daemon --agent bob.bundie     --interval 480000 &
sleep 30
pnpm --filter @bundie/programs chaos:agent-daemon --agent charlie.bundie --interval 600000 &

# Keep container alive; restart if surfpool dies
wait $SURFPOOL_PID || true
echo "surfpool exited -- restarting"
sleep 5
exec "$0"
