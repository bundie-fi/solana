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
