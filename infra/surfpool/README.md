# bundie-surfpool

Long-lived Solana mainnet fork on Railway, used by the chaos-sim agent daemon for read + execute against forked mainnet protocols (Kamino, Marinade, Jito, etc.) without touching real money.

## What runs

`surfpool start --no-tui --no-explorer --rpc-port 8899 --network mainnet --rpc-url $MAINNET_RPC_URL`

Surfpool is from txtx (https://github.com/txtx/surfpool) — a forked-mainnet Solana validator that pulls live state on demand from the upstream RPC.

## Required env vars

- `MAINNET_RPC_URL` — upstream Solana mainnet RPC (rpcfast / Helius / QuickNode). Needs decent rate limits; the fork pulls account state on demand.

## Railway service config

- Builder: `DOCKERFILE`
- rootDirectory: `/`
- dockerfilePath: `infra/surfpool/Dockerfile`
- Internal hostname: `bundie-surfpool.railway.internal:8899`
- Public domain: not needed (only bundie-agents talks to it, internal-only)
- Healthcheck: TCP on 8899 (RPC liveness via getSlot)
- Memory: 4–8 GB recommended (Surfpool keeps fetched mainnet account state in RAM)

## Wiring bundie-agents to use it

After this service is up, set on bundie-agents:

```
SURFPOOL_RPC_URL=http://bundie-surfpool.railway.internal:8899
```

The chaos-sim entrypoint (`packages/programs/scripts/chaos-sim/docker-entrypoint.sh`) bridges `MAINNET_RPC_URL → SURFPOOL_RPC_URL` only when `SURFPOOL_RPC_URL` is unset. Setting it explicitly overrides the bridge and points agents at the real fork.

## Verify it's working

From any other Railway service in the same project:

```sh
curl -s -X POST http://bundie-surfpool.railway.internal:8899 \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[]}'
```

Expected: a JSON response with a current Solana mainnet slot.

In bundie-agents logs, look for ticks reporting `mainnetRpc=up` instead of `mainnetRpc=down`.

## Failure modes

- **Upstream RPC rate-limits the fork** — Surfpool needs to fetch mainnet state for every account it doesn't already have cached. If the upstream RPC throttles, Surfpool requests stall. Solution: use a paid RPC tier (Helius, QuickNode) with higher rate limits.
- **Surfpool crashes on memory pressure** — accounts pile up in RAM over time. If memory exceeds the Railway service limit, the container OOM-kills. Solution: bump memory plan or restart on a schedule.
- **`cargo install surfpool` fails at build time** — surfpool may not be on crates.io. The Dockerfile falls back to building from git HEAD. If that also fails, check the txtx/surfpool repo for a binary release URL and switch the Dockerfile to download instead of build.

## Cost

On Railway pro: ~$10–20/month for an 8 GB instance running continuously. Throttle to 4 GB if cost matters more than fork breadth.
