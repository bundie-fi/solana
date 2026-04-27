# Bundie agent daemon — devnet-only mode
#
# Runs alice/bob/charlie agent daemons against devnet (no surfpool).
# When SURFPOOL_RPC_URL is set and reachable, agents will use it for rate
# observation; otherwise they fall back to devnet automatically.
#
# Required env vars:
#   ALICE_VAULT_KEYPAIR_B64   base64-encoded contents of alice-vault.json
#   BOB_VAULT_KEYPAIR_B64     base64-encoded contents of bob-vault.json
#   CHARLIE_VAULT_KEYPAIR_B64 base64-encoded contents of charlie-vault.json
#   REDPILL_API_KEY           Redpill API key (claude-sonnet-4.5 via proxy)
#   ZERION_API_KEY            Zerion API key
#   DEVNET_RPC_URL            (optional) devnet RPC, defaults to public devnet
#   MAINNET_RPC_URL           mainnet RPC for rate-surface observation (Kamino/Marinade)
#                             aliased as SURFPOOL_RPC_URL; if unset agents fall back to devnet rates

FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ca-certificates curl procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN npm install -g pnpm@10

# Copy workspace manifests for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# pnpm.patchedDependencies in pnpm-workspace.yaml references files in
# patches/. Without this COPY, `pnpm install --frozen-lockfile` below
# fails on the first build with a missing-patch-file error.
COPY patches patches

# Copy only the packages the daemon needs
COPY packages/common packages/common
COPY packages/programs packages/programs
COPY packages/zerion-agent packages/zerion-agent

# Install all workspace dependencies (devDeps included for tsx)
RUN pnpm install --frozen-lockfile

# Keys dir — populated at runtime from base64 env vars
RUN mkdir -p packages/programs/scripts/chaos-sim/keys

COPY packages/programs/scripts/chaos-sim/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
