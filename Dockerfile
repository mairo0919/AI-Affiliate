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
COPY apps/research-agent/package.json ./apps/research-agent/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/package.json ./packages/config/
COPY packages/database/package.json ./packages/database/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@ai-affiliate/research-agent", "start"]
