FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/common/package.json ./packages/common/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/common/node_modules ./packages/common/node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY packages/common ./packages/common
COPY packages/web ./packages/web
COPY package.json pnpm-workspace.yaml tsconfig.json .npmrc ./

# NEXT_PUBLIC_* env vars must be present at build time so Next bakes them into
# the client bundle. Railway forwards every env var on the service as a Docker
# build arg automatically; ARG names below must match the env var names set on
# bundie-app via the Railway dashboard.
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_BUSD_MINT
ARG NEXT_PUBLIC_PREDICTION_PROGRAM_ID
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_SOLANA_RPC
ARG NEXT_PUBLIC_SOLANA_RPC_ENDPOINT
ARG NEXT_PUBLIC_SANCTUM_RPC_URL
ARG NEXT_PUBLIC_FEE_PAYER_ADDRESS
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_PRIVY_CLIENT_ID
ARG NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL \
    NEXT_PUBLIC_BUSD_MINT=$NEXT_PUBLIC_BUSD_MINT \
    NEXT_PUBLIC_PREDICTION_PROGRAM_ID=$NEXT_PUBLIC_PREDICTION_PROGRAM_ID \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_SOLANA_RPC=$NEXT_PUBLIC_SOLANA_RPC \
    NEXT_PUBLIC_SOLANA_RPC_ENDPOINT=$NEXT_PUBLIC_SOLANA_RPC_ENDPOINT \
    NEXT_PUBLIC_SANCTUM_RPC_URL=$NEXT_PUBLIC_SANCTUM_RPC_URL \
    NEXT_PUBLIC_FEE_PAYER_ADDRESS=$NEXT_PUBLIC_FEE_PAYER_ADDRESS \
    NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_PRIVY_CLIENT_ID=$NEXT_PUBLIC_PRIVY_CLIENT_ID \
    NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID=$NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID

ENV NODE_ENV=production
RUN pnpm --filter @bundie/web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/common/node_modules ./packages/common/node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY packages/common ./packages/common
COPY packages/web ./packages/web
COPY package.json pnpm-workspace.yaml .npmrc ./
COPY --from=builder /app/packages/web/.next ./packages/web/.next

EXPOSE 3000
WORKDIR /app/packages/web
CMD ["/app/node_modules/.bin/next", "start"]
