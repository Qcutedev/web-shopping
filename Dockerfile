# syntax=docker/dockerfile:1
#
# Marketplace image (T-071, docs/DEPLOYMENT.md "Container image"). Targets:
#
#   runtime  (default) serves requests. Production dependencies only, no `prisma` CLI.
#   migrate  runs `prisma migrate deploy` and ops scripts. Full dependencies, schema engine
#            fetched at build time so a release needs no download (CR-16). Never serves requests.
#
# No secret is read or written at build time: the build needs no application variable
# (D-033 point 1). Secrets arrive as environment variables when a container starts.

ARG NODE_IMAGE=node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

# ---- base: Node and pnpm at the pinned versions (D-020) ----
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm CI=true
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
# Corepack takes the pnpm version from `packageManager` in package.json.
COPY package.json ./
RUN corepack enable && corepack prepare --activate

# ---- deps: full install. `postinstall` runs `prisma generate`, so the schema and the Prisma
# config must be present. A production-only install is not used here (CR-16). ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma7.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# `headers()` in next.config.ts runs at build time and is stored in the build output, so the
# CSP `upgrade-insecure-requests` directive depends on APP_URL as it is HERE (T-072, D-046).
# Pass the public https origin of the target environment: --build-arg APP_URL=https://...
# It is a public URL, not a secret. The running container must use the same value.
ARG APP_URL
ENV APP_URL=${APP_URL}
COPY . .
RUN pnpm build

# ---- migrate: full dependencies plus the schema engine, fetched now ----
FROM build AS migrate
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Fetches the schema engine for the pinned Prisma version into the image (needs network here,
# not at release time). `migrate status` is not run: it would need a database.
RUN pnpm exec prisma --version
USER node
# Calls the CLI directly: `pnpm run` would first try to install and to download pnpm itself.
# Same command as the `db:migrate:deploy` script.
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# ---- prod-deps: production dependencies only. Scripts are skipped on purpose: `postinstall`
# would call `prisma generate` and `prisma` is a development dependency. The generated client
# is copied from the build stage instead. ----
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
RUN mkdir -p /data/uploads && chown -R node:node /data /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/prisma/generated ./prisma/generated
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts ./
USER node
VOLUME ["/data/uploads"]
EXPOSE 3000
# Liveness plus database connectivity (GET /api/health). Starts after the environment check
# in src/instrumentation.ts has had time to run.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "node_modules/next/dist/bin/next", "start"]
