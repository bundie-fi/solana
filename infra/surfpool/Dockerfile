# Bundie Surfpool — Solana mainnet fork on Railway
#
# Runs `surfpool start` as a long-lived service exposing the Solana RPC at
# port 8899. bundie-agents connects via internal hostname
# bundie-surfpool.railway.internal:8899 to execute strategy actions against
# a forked mainnet without touching real money.
#
# Required env vars at runtime:
#   MAINNET_RPC_URL  upstream mainnet RPC the fork pulls state from
#                    (Helius, QuickNode, or rpcfast — needs decent rate limit)

FROM rust:1.83-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential pkg-config libssl-dev libudev-dev clang \
        protobuf-compiler git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Try crates.io first; if surfpool isn't published, fall back to git HEAD.
RUN cargo install surfpool --locked \
    || cargo install --git https://github.com/txtx/surfpool surfpool --locked

FROM debian:bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/cargo/bin/surfpool /usr/local/bin/surfpool
COPY infra/surfpool/healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/healthcheck.sh

EXPOSE 8899

# --no-tui: run headless (no terminal UI)
# --no-explorer: skip the built-in web explorer (we don't need it on Railway)
# --rpc-port 8899: standard Solana RPC port; bundie-agents expects this
# --network mainnet --rpc-url $MAINNET_RPC_URL: fork from upstream mainnet
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD /usr/local/bin/healthcheck.sh

CMD ["sh", "-c", "exec surfpool start --no-tui --no-explorer --rpc-port 8899 --network mainnet --rpc-url \"$MAINNET_RPC_URL\""]
