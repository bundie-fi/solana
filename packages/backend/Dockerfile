# Bundie backend — Hono server on Railway
#
# Built from the repo root so we have access to the pnpm workspace.
# Configure the Railway service with rootDirectory=/ and dockerfilePath=packages/backend/Dockerfile.
#
# Required env vars at runtime:
#   DATABASE_URL              ${{bundie-db.DATABASE_URL}} — internal Postgres
#   BUSD_MINT                 SPL mint pubkey (devnet)
#   BUSD_MINT_AUTHORITY_SECRET JSON byte array of the bUSD mint authority
#   AGENT_FUNDING_SECRET      JSON byte array of a funded keypair (auto-funds new agents)
#   AGENT_FUND_LAMPORTS       (optional) defaults to 10_000_000 (0.01 SOL)
#   DEVNET_RPC                devnet RPC URL
#   PORT                      injected by Railway

FROM node:20-slim AS base
RUN npm install -g pnpm@10

FROM base AS deps
WORKDIR /app
# Workspace manifests (cached layer)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/common/package.json ./packages/common/
COPY packages/backend/package.json ./packages/backend/
COPY packages/zerion-agent/package.json ./packages/zerion-agent/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/common/node_modules ./packages/common/node_modules
COPY --from=deps /app/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=deps /app/packages/zerion-agent/node_modules ./packages/zerion-agent/node_modules

# Source
COPY package.json pnpm-workspace.yaml tsconfig.json .npmrc ./
COPY packages/common ./packages/common
COPY packages/backend ./packages/backend
COPY packages/zerion-agent ./packages/zerion-agent

ENV NODE_ENV=production
RUN pnpm --filter @bundie/backend build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Production deps + built backend + zerion-agent (runtime sibling needed by zerion-cli wrapper)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/common/node_modules ./packages/common/node_modules
COPY --from=deps /app/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=deps /app/packages/zerion-agent/node_modules ./packages/zerion-agent/node_modules
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/package.json ./packages/backend/package.json
COPY packages/common ./packages/common
COPY packages/zerion-agent ./packages/zerion-agent
COPY package.json pnpm-workspace.yaml ./

WORKDIR /app/packages/backend
CMD ["node", "dist/index.js"]
