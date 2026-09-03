# syntax=docker/dockerfile:1

# Build stage: needs the full dependency tree; the runtime stage does not.
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
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
