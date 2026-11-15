# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV SKIP_ENV_VALIDATION=1
ENV DATABASE_URL="file:./build-placeholder.sqlite"
RUN npm run build
# See scripts/patch-next-forwarded-host.mjs for why: self-hosted behind a
# reverse proxy, Next's standalone server otherwise builds every request's
# absolute URL (including Auth.js's per-request OAuth callbackUrl) from its
# own bind address instead of the real Caddy-forwarded Host header, which
# breaks GitHub sign-in with a redirect_uri mismatch.
RUN node scripts/patch-next-forwarded-host.mjs .next/standalone/node_modules/next/dist/server/next-server.js

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
	&& adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
