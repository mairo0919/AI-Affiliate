# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
ARG PNPM_VERSION=11.17.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/content-operator/package.json ./apps/content-operator/
COPY apps/admin-api/package.json ./apps/admin-api/
COPY apps/admin-web/package.json ./apps/admin-web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/package.json ./packages/config/
COPY packages/database/package.json ./packages/database/
COPY packages/admin-contracts/package.json ./packages/admin-contracts/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
# Role selected via APP_ROLE: content-operator | admin-api | admin-web
ENV APP_ROLE=content-operator
# Migrate before long-running roles; failures are fatal so bad schema cannot silently run.
CMD ["sh", "-c", "pnpm db:migrate && case \"$APP_ROLE\" in admin-api) pnpm --filter @ai-affiliate/admin-api start ;; admin-web) pnpm --filter @ai-affiliate/admin-web start ;; scheduler) pnpm --filter @ai-affiliate/content-operator start:scheduler ;; *) pnpm --filter @ai-affiliate/content-operator start ;; esac"]
