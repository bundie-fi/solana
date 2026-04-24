#!/bin/bash
# Bundie agent daemon entrypoint.
# 1. Decodes keypairs from base64 env vars → writes to keys dir
# 2. Starts surfpool in background (mainnet fork on localhost:8899)
# 3. Waits for surfpool to accept connections (up to 30s)
# 4. Starts the LLM-brained agent daemon
set -e

KEYS_DIR=/app/packages/programs/scripts/chaos-sim/keys

echo "=== Bundie Agent Daemon — Option X ==="
echo "Decoding agent keypairs..."

for agent in alice bob charlie; do
  varname="${agent^^}_VAULT_KEYPAIR_B64"
  val="${!varname}"
  if [ -n "$val" ]; then
    echo "$val" | base64 -d > "$KEYS_DIR/${agent}-vault.json"
    echo "  ✓ ${agent}-vault.json written"
  else
    echo "  WARN: $varname not set — ${agent} will be skipped"
  fi
done

# ── surfpool sidecar ──────────────────────────────────────────────────────
if command -v surfpool >/dev/null 2>&1; then
  echo ""
  echo "=== Starting surfpool (mainnet fork) ==="
  surfpool start \
    --airdrop-keypair-path "$KEYS_DIR/alice-vault.json" \
    --airdrop-keypair-path "$KEYS_DIR/bob-vault.json" \
    --airdrop-keypair-path "$KEYS_DIR/charlie-vault.json" \
    &

  SURFPOOL_PID=$!
  echo "Surfpool PID: $SURFPOOL_PID"

  # Wait up to 30s for surfpool RPC to accept connections
  echo "Waiting for surfpool RPC at localhost:8899..."
  for i in $(seq 1 15); do
    if curl -sf -X POST http://127.0.0.1:8899 \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
      > /dev/null 2>&1; then
      echo "  ✓ Surfpool ready (${i}x2s)"
      export SURFPOOL_RPC_URL=http://127.0.0.1:8899
      break
    fi
    sleep 2
  done

  if [ -z "$SURFPOOL_RPC_URL" ]; then
    echo "  WARN: Surfpool did not become ready in 30s — running in devnet-only mode"
  fi
else
  echo "WARN: surfpool binary not found — running in devnet-only mode"
fi

echo ""
echo "=== Starting agent daemon ==="
exec pnpm --filter @bundie/programs chaos:agent-daemon
