# Bundie agent daemon — Option X
#
# Contains both surfpool (Rust/mainnet-fork RPC) and the Node.js agent daemon.
# Surfpool starts as a background sidecar so the daemon can reach it on
# localhost:8899 without cross-service networking.
#
# Build time is long on first run (~40-60 min) due to Solana SDK compilation.
# Railway caches layers so subsequent deploys rebuild in under 2 min.
#
# Required env vars:
#   ALICE_VAULT_KEYPAIR_B64   base64-encoded contents of alice-vault.json
#   BOB_VAULT_KEYPAIR_B64     base64-encoded contents of bob-vault.json
#   CHARLIE_VAULT_KEYPAIR_B64 base64-encoded contents of charlie-vault.json
#   REDPILL_API_KEY           Redpill API key (claude-sonnet-4.5 via proxy)
#   ZERION_API_KEY            Zerion API key
#   DEVNET_RPC_URL            (optional) override, defaults to devnet

# ── Stage 1: build surfpool ────────────────────────────────────────────────
FROM rust:1.80-slim AS surfpool-builder

RUN apt-get update && apt-get install -y \
    pkg-config libssl-dev git libclang-dev cmake protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

ENV CARGO_NET_GIT_FETCH_WITH_CLI=true
ENV CARGO_INCREMENTAL=0

RUN cargo install --git https://github.com/txtx/surfpool --locked

# ── Stage 2: runtime image ────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    libssl3 ca-certificates curl procps \
    && rm -rf /var/lib/apt/lists/*

COPY --from=surfpool-builder /usr/local/cargo/bin/surfpool /usr/local/bin/surfpool

WORKDIR /app

RUN npm install -g pnpm@10

# Copy workspace manifests for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy only the packages the daemon needs
COPY packages/common packages/common
COPY packages/programs packages/programs
COPY packages/zerion-agent packages/zerion-agent
COPY agents agents

# Install all workspace dependencies (devDeps included for tsx)
RUN pnpm install --frozen-lockfile

# Keys dir — populated at runtime from base64 env vars
RUN mkdir -p packages/programs/scripts/chaos-sim/keys

COPY packages/programs/scripts/chaos-sim/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
