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
# socat is required because surfpool v1.2.x silently ignores `--host 0.0.0.0`
# and always binds the RPC server to 127.0.0.1:8899. Without it Railway's
# proxy + sibling services can never reach the RPC. See entrypoint below
# for the forwarder.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl socat \
    && rm -rf /var/lib/apt/lists/* \
    || true

COPY infra/surfpool/healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/healthcheck.sh

# 8899 is surfpool's loopback-only RPC. We expose 18899 (the socat-forwarded
# public port) instead so Railway's HTTP proxy picks it up automatically.
EXPOSE 18899

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD /usr/local/bin/healthcheck.sh
ENV PORT=18899

# Override the upstream image's ENTRYPOINT so we can use shell-form CMD
# (needed so $MAINNET_RPC_URL expands at container start).
ENTRYPOINT []

# Surfpool flags (verified from `surfpool start --help` runtime output):
#   --no-tui           run headless (no terminal UI)
#   --no-studio        skip the built-in web Studio (we don't need it on Railway)
#   -p, --port 8899    Simnet RPC port (default 8899)
#   -u, --rpc-url ...  upstream datasource RPC (also takes SURFPOOL_DATASOURCE_RPC_URL env)
#                      mutually exclusive with --network
#
# Why socat: as of surfpool v1.2.x the `-o, --host 0.0.0.0` flag is parsed but
# silently ignored — the RPC server always binds 127.0.0.1:8899 (verified via
# /proc/net/tcp showing 0100007F:22C3). That makes the RPC unreachable from
# both Railway's HTTP proxy and sibling Railway services. We work around it by
# starting surfpool first (loopback-only, port 8899) and a socat sidecar that
# listens on 0.0.0.0:18899 and forwards to 127.0.0.1:8899. The public-facing
# port is 18899; sibling services connect to bundie-surfpool.railway.internal:18899.
# socat is launched in the background AFTER a wait-loop confirms surfpool's
# RPC is accepting connections on loopback (avoids opening a listener that
# would RST callers during the 10-30s upstream-fetch warmup).
CMD ["sh", "-c", "set -e; \
    ( while ! curl -s -m 1 http://127.0.0.1:8899 -X POST -H content-type:application/json -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getSlot\"}' >/dev/null 2>&1; do sleep 1; done; \
      echo '[entrypoint] surfpool RPC up on 127.0.0.1:8899 — starting socat dual-stack on :18899 → 127.0.0.1:8899'; \
      exec socat TCP6-LISTEN:18899,reuseaddr,fork TCP:127.0.0.1:8899 ) & \
    exec surfpool start --no-tui --no-studio --port 8899 --rpc-url \"$MAINNET_RPC_URL\""]
