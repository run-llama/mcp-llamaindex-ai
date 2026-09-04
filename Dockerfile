# No `# syntax=` pin. That directive makes BuildKit pull the frontend image from
# Docker Hub, and the publish workflow logs in first with a token scoped to push
# `llamaindex/` — which cannot pull `docker/dockerfile`, so an authenticated
# build fails where an anonymous one would have worked. buildx's built-in
# frontend already supports the cache mounts below.

# Build stage: needs the full dependency tree; the runtime stage does not.
FROM node:22-alpine AS builder
# Declared so the cache mount below can key on it; the stage still builds as the
# target platform, because next build traces arch-specific SWC binaries into
# node_modules and a cross-built bundle would ship the wrong ones.
ARG TARGETPLATFORM
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# The cache id carries the platform: a multi-arch build runs both legs
# concurrently, and BuildKit cache mounts are shared by default, so one
# store mounted twice produces intermittent pnpm store errors on release day.
RUN --mount=type=cache,id=pnpm-$TARGETPLATFORM,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile

COPY . .

# Passed inline rather than via ENV so they stay out of the image metadata: the
# build only needs them to compile, and every real value is supplied at run
# time. api_key mode is what lets the build proceed without WorkOS configured.
RUN NEXT_TELEMETRY_DISABLED=1 \
    MCP_AUTH_MODE=api_key \
    LLAMA_CLOUD_REGION=na \
    pnpm build

# Runtime stage: standalone output plus the traced node_modules only.
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

# server.js and its traced dependencies. `static` is not folded into standalone
# by Next and has to be copied alongside it. There is no public/ in this repo.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
