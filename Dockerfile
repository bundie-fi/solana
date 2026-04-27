FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/common/package.json ./packages/common/
COPY packages/web/package.json ./packages/web/
# pnpm-workspace.yaml's patchedDependencies references patches/. Without
# this COPY, `pnpm install --frozen-lockfile` fails with ENOENT before
# any deps resolve.
COPY patches patches
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
# Hardcoded defaults so the build always has them, even if Railway doesn't
# forward env vars as build args. Override via --build-arg if running locally
# against a different backend. These are all public values (URLs, mint pubkey,
# program ID) so safe to commit.
ARG NEXT_PUBLIC_BACKEND_URL=https://backend.solana.bundie.fi
ARG NEXT_PUBLIC_BUSD_MINT=42LaRiwvuxfQv5rfHMmk9wU3K2nRxMGzgukNJztydpiB
ARG NEXT_PUBLIC_PREDICTION_PROGRAM_ID=Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4
ARG NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
ARG NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
ARG NEXT_PUBLIC_SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
ARG NEXT_PUBLIC_SANCTUM_RPC_URL=https://api.mainnet-beta.solana.com
ARG NEXT_PUBLIC_FEE_PAYER_ADDRESS=
ARG NEXT_PUBLIC_PRIVY_APP_ID=
ARG NEXT_PUBLIC_PRIVY_CLIENT_ID=
ARG NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID=
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

# Belt-and-suspenders: also write the env vars into .env.production so Next
# reads them even if the ENV directive above didn't propagate. Single RUN,
# no heredoc, fail-loud if the file isn't readable afterward.
RUN set -e; \
    mkdir -p /app/packages/web; \
    { \
      echo "NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL"; \
      echo "NEXT_PUBLIC_BUSD_MINT=$NEXT_PUBLIC_BUSD_MINT"; \
      echo "NEXT_PUBLIC_PREDICTION_PROGRAM_ID=$NEXT_PUBLIC_PREDICTION_PROGRAM_ID"; \
      echo "NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL"; \
      echo "NEXT_PUBLIC_SOLANA_RPC=$NEXT_PUBLIC_SOLANA_RPC"; \
      echo "NEXT_PUBLIC_SOLANA_RPC_ENDPOINT=$NEXT_PUBLIC_SOLANA_RPC_ENDPOINT"; \
      echo "NEXT_PUBLIC_SANCTUM_RPC_URL=$NEXT_PUBLIC_SANCTUM_RPC_URL"; \
      echo "NEXT_PUBLIC_FEE_PAYER_ADDRESS=$NEXT_PUBLIC_FEE_PAYER_ADDRESS"; \
      echo "NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID"; \
      echo "NEXT_PUBLIC_PRIVY_CLIENT_ID=$NEXT_PUBLIC_PRIVY_CLIENT_ID"; \
      echo "NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID=$NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID"; \
    } > /app/packages/web/.env.production; \
    cat /app/packages/web/.env.production

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
