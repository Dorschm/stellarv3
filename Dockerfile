# Use an official Node runtime as the base image
FROM node:24-slim AS base
WORKDIR /usr/src/app

# Build stage - install ALL dependencies and build
FROM base AS build
ENV HUSKY=0
# procps (ps) is needed by `concurrently --kill-others-on-fail` used by
# build-prod; without it, the slim base image masks real build errors
# with a spawn ps ENOENT crash.
RUN apt-get update \
    && apt-get install -y --no-install-recommends procps \
    && rm -rf /var/lib/apt/lists/*
# Copy package files first for better caching
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy only what's needed for build
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY eslint.config.js ./
COPY index.html ./
COPY resources ./resources
COPY proprietary ./proprietary
COPY src ./src

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT="$GIT_COMMIT"
RUN npm run build-prod

# Production dependencies stage - separate from build
FROM base AS prod-deps
ENV HUSKY=0
ENV NPM_CONFIG_IGNORE_SCRIPTS=1
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev
# better-sqlite3 ships a prebuilt native binary via prebuild-install that is
# normally extracted during the postinstall hook. We keep
# NPM_CONFIG_IGNORE_SCRIPTS=1 for supply-chain safety, then explicitly
# rebuild this single package so its prebuilt .node file lands in
# node_modules/. node-gyp-build will download the matching binary for the
# node:24-slim base; no compiler toolchain needs to be installed.
RUN --mount=type=cache,target=/root/.npm \
    npm rebuild better-sqlite3 --foreground-scripts

# Final production image
FROM base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    nginx \
    curl \
    wget \
    supervisor \
    apache2-utils \
    && rm -rf /var/lib/apt/lists/*

# Update worker_connections in nginx.conf
RUN sed -i 's/worker_connections [0-9]*/worker_connections 8192/' /etc/nginx/nginx.conf

# Setup supervisor configuration
RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Copy production node_modules from prod-deps stage (cached separately from build)
COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY package*.json ./

# Copy built artifacts from build stage
COPY --from=build /usr/src/app/static ./static

COPY resources ./resources

# Strip map binary data from the image (~12 MB), but keep manifest.json
# files. The server reads num_sector_tiles from each manifest in
# MapSectorTiles.ts when sizing newly-created games; without the manifests
# the catch falls back to a 1_000_000 default which both spams the
# error log and produces incorrect game balancing for non-procedural
# maps. Manifests total ~12 KB.
RUN find ./resources/maps -type f ! -name 'manifest.json' -delete \
    && find ./resources/maps -type d -empty -delete
COPY tsconfig.json ./
COPY src ./src


ARG GIT_COMMIT=unknown
RUN echo "$GIT_COMMIT" > static/commit.txt

ENV GIT_COMMIT="$GIT_COMMIT"

RUN <<'EOF' tee /usr/local/bin/start.sh
#!/bin/sh
if [ "$DOMAIN" = openfront.dev ] && [ "$SUBDOMAIN" != main ]; then
    exec timeout 18h /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
else
    exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
fi
EOF
RUN chmod +x /usr/local/bin/start.sh
ENTRYPOINT ["/usr/local/bin/start.sh"]
