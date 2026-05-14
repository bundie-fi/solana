#!/usr/bin/env bash
# deploy-events-devnet.sh — build + deploy the prediction-market program
# (with the new event-market entrypoints) to Solana devnet, then bootstrap
# the 5 demo markets.
#
# Usage:
#   chmod +x packages/programs/scripts/deploy-events-devnet.sh
#   ./packages/programs/scripts/deploy-events-devnet.sh
#
# Assumes:
#   - `anchor` is installed and on PATH
#   - ~/.config/solana/id.json exists and has devnet SOL
#   - The wallet has devnet USDC for the demo market subsidies
#     (faucet: https://spl-token-faucet.com/?token-name=USDC-Dev)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PROGRAMS_DIR="$REPO_ROOT/packages/programs"

echo "=== Bundie event-markets devnet deploy ==="
echo "Repo:     $REPO_ROOT"
echo "Programs: $PROGRAMS_DIR"
echo ""

# Step 1: build + deploy
pushd "$PROGRAMS_DIR" >/dev/null

echo "[1/3] Building..."
anchor build

echo ""
echo "[2/3] Deploying to devnet..."
anchor deploy --provider.cluster devnet

# Step 2: copy IDL to backend for client use
echo ""
echo "[2.5/3] Syncing IDL to packages/backend..."
cp target/idl/prediction_market.json "$REPO_ROOT/packages/backend/src/idl/prediction_market.json"

popd >/dev/null

# Step 3: create demo markets
echo ""
echo "[3/3] Creating demo markets..."
cd "$REPO_ROOT"
pnpm tsx packages/programs/scripts/create-demo-events.ts

echo ""
echo "=== Done. Demo markets live on devnet. ==="
echo "Verify in the explorer: https://explorer.solana.com/?cluster=devnet"
