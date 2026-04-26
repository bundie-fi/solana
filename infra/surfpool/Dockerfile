# Bundie Surfpool — Solana mainnet fork on Railway
#
# Uses the official surfpool Docker image instead of building from Rust source.
# Runs surfpool as a long-lived service exposing the Solana RPC at :8899.
# bundie-agents connects via internal hostname
# bundie-surfpool.railway.internal:8899 to execute strategy actions against
# a forked mainnet without touching real money.
#
# Required env vars at runtime:
#   MAINNET_RPC_URL  upstream Solana mainnet RPC the fork pulls state from
#                    (Helius, QuickNode, or rpcfast — needs decent rate limit)

FROM surfpool/surfpool:latest

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    || true

COPY infra/surfpool/healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/healthcheck.sh

EXPOSE 8899

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD /usr/local/bin/healthcheck.sh

# Override the upstream image's ENTRYPOINT so we can use shell-form CMD
# (needed so $MAINNET_RPC_URL expands at container start).
ENTRYPOINT []

CMD ["sh", "-c", "exec surfpool start --no-tui --no-explorer --rpc-port 8899 --network mainnet --rpc-url \"$MAINNET_RPC_URL\""]
