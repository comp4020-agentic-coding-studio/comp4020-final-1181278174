# syntax = docker/dockerfile:1

# The image Fly deploys and CI starts: install, build, then keep only the
# built server and its production dependencies. It serves HTTP on
# 0.0.0.0:$PORT (fly.toml sets 8080) and keeps its one SQLite file on the
# /data volume, the only storage that survives a restart or a redeploy.

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim AS base

WORKDIR /app
ENV NODE_ENV=production

ARG PNPM_VERSION=11.9.0
RUN npm install -g pnpm@$PNPM_VERSION

# --- build stage: install everything, build, then prune to prod deps -------
FROM base AS build

# toolchain for better-sqlite3, in case no prebuilt binary matches the image
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential pkg-config python-is-python3

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm run build
RUN pnpm prune --prod

# --- runtime stage: the built server and its production deps ---------------
FROM base

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
# the committed migrations, applied at boot (src/lib/db.ts)
COPY --from=build /app/drizzle /app/drizzle

ENV HOST=0.0.0.0
ENV PORT=8080
ENV DATABASE_PATH=/data/hands-up.db
EXPOSE 8080
CMD ["node", "./dist/server/entry.mjs"]
