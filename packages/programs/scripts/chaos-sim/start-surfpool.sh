#!/usr/bin/env bash
# Start surfpool for agent strategy simulation.
#
# Usage:
#   bash packages/programs/scripts/chaos-sim/start-surfpool.sh
#
# Surfpool binds to http://127.0.0.1:8899 by default. Keep this running in a
# separate terminal while the agent daemon runs.
#
# Intent: mainnet fork with JIT-fetched state + airdrop SOL to the three
# agent vault keypairs so they have balances for simulated tx. If the
# surfpool CLI args drift, adjust below — the canonical reference is
# `surfpool --help`.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
KEYS_DIR="${SCRIPT_DIR}/keys"

if ! command -v surfpool >/dev/null 2>&1; then
  echo "error: surfpool CLI not found on PATH."
  echo "install: cargo install --git https://github.com/txtx/surfpool --locked"
  echo "docs:    https://docs.surfpool.run/"
  exit 1
fi

ALICE_KP="${KEYS_DIR}/alice-vault.json"
BOB_KP="${KEYS_DIR}/bob-vault.json"
CHARLIE_KP="${KEYS_DIR}/charlie-vault.json"

for f in "${ALICE_KP}" "${BOB_KP}" "${CHARLIE_KP}"; do
  if [ ! -f "${f}" ]; then
    echo "error: missing keypair ${f}"
    echo "run   pnpm --filter @bundie/programs chaos:setup first"
    exit 1
  fi
done

echo "=== Starting surfpool — mainnet fork ==="
echo "    Kamino, Marinade, and SPL stake-pool state will JIT-fetch from mainnet."
echo "    Airdrop target keypairs: alice, bob, charlie"
echo ""

# surfpool start --help on a recent build supports --airdrop-keypair-path.
# Older builds use positional args after `start`. Try the documented flag
# first; the daemon treats surfpool unreachable as non-fatal, so a CLI
# mismatch doesn't break the demo.
exec surfpool start \
  --airdrop-keypair-path "${ALICE_KP}" \
  --airdrop-keypair-path "${BOB_KP}" \
  --airdrop-keypair-path "${CHARLIE_KP}"
