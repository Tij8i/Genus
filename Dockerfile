# i56 phase 4c — Genus dashboard container image.
#
# Single-stage Node 20 alpine build. Ships:
#   • The Node/Express server ported from Cloudflare Pages Functions (server/).
#   • The dashboard static assets (index.html, assets/, docs/, modules/, etc.).
#   • The wizard SPA (dashboard/public/wizard/).
#   • The synthetic BU fixtures (Acme Roastery demo) baked into
#     /app/synthetic-fixtures/. server/index.js seedFirstRun() copies them into
#     the mounted bus-data volume on empty-volume boot.
#
# The Cloudflare Pages deployment continues to serve functions/ from the same
# repo untouched; this image simply doesn't ship functions/ (see .dockerignore).

FROM node:20-alpine

# Add a small init so Node handles SIGTERM cleanly (docker compose down).
RUN apk add --no-cache tini

WORKDIR /app

# Layer 1: dependency install. Keeps the npm ci layer cached until package
# files actually change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Layer 2: application code. .dockerignore excludes .git, node_modules,
# functions, tests, docs/products, etc.
COPY . .

# Layer 3: bake synthetic BU fixtures into an image-only path so seedFirstRun()
# in server/index.js can copy them into the mounted bus-data volume on
# empty-volume boot (never overwrites an existing volume).
RUN mkdir -p /app/synthetic-fixtures \
  && cp -R /app/dashboard/public/data/bus/synthetic/. /app/synthetic-fixtures/

# Runtime env defaults. Compose file may override.
ENV NODE_ENV=production \
    GENUS_LOCAL_MODE=1 \
    PORT=8080 \
    GENUS_BUS_ROOT=/app/bus \
    GENUS_SYNTHETIC_FIXTURES_DIR=/app/synthetic-fixtures

EXPOSE 8080

# Healthcheck: /_boot is a cheap static page that's up before the API handlers
# finish importing. Any 2xx = container is serving; anything else = not ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/_boot || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/app/server/index.js"]
