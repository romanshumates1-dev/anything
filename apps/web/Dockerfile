# Production Dockerfile for DealFlow AI Web
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json yarn.lock* .yarnrc.yml ./
COPY .yarn ./.yarn
RUN corepack enable && yarn install --immutable

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.yarn ./.yarn
COPY . .

# Set build-time env vars (these can be overridden at runtime)
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && yarn build

# Production runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy scripts for worker
COPY --from=builder /app/scripts ./scripts

USER nextjs
EXPOSE 4000

CMD ["node", "server.js"]
