# DealFlow AI — multi-stage image for the Next.js web app + the job worker.
# Both the `app` and `worker` compose services run from THIS image (different
# commands): the app serves Next, the worker runs scripts/worker.mjs.
#
# NOTE: the app's DB layer is @neondatabase/serverless (HTTP/WS driver), so
# DATABASE_URL must point at Neon (cloud) or a Neon-compatible proxy — a vanilla
# postgres container does not speak that driver's protocol. See docker-compose.yml.

# ── deps: install workspace dependencies (cached unless manifests change) ──────
FROM node:20-alpine AS deps
WORKDIR /repo
# corepack pins yarn 4 (packageManager field in package.json)
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY apps/web/package.json apps/web/package.json
# Only the web app is needed for the server image; skip desktop/mobile installs.
RUN yarn workspaces focus web || yarn install --immutable

# ── build: compile the Next standalone bundle ─────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn workspace web build

# ── runner: minimal non-root runtime ──────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /repo/apps/web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4000

# non-root user
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs

# Next standalone output already contains the trimmed node_modules it needs.
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public
# The worker + migration scripts (plain node, run in the same image).
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/scripts ./apps/web/scripts
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/db ./apps/web/db

USER nextjs
EXPOSE 4000

# Liveness: the public health probe (booleans only, zero config).
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/system/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

# Default = the app server. The worker service overrides CMD in compose.
CMD ["node", "apps/web/server.js"]
