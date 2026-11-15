# The build only emits platform-independent JavaScript and static files, so it always runs natively on the
# build machine. Only the stages that install runtime dependencies or ship a binary follow the target
# architecture (docker buildx build --platform linux/arm64 for the Oracle Ampere hosts).
FROM --platform=$BUILDPLATFORM node:24.14.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/data/package.json packages/data/package.json
COPY packages/jobs/package.json packages/jobs/package.json
RUN npm ci --ignore-scripts
COPY apps ./apps
COPY packages ./packages
COPY scripts/migration ./scripts/migration
COPY src/app/globals.css ./src/app/globals.css
# The Vite app reuses the legacy marketing pages and fonts, so those sources are build inputs.
COPY ["src/app/(marketing)", "./src/app/(marketing)"]
COPY public ./public
COPY src/components ./src/components
COPY src/lib ./src/lib
COPY tsconfig.json tsconfig.portable.json ./
COPY postcss.config.mjs ./
RUN npm run build:portable

FROM node:24.14.1-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/data/package.json packages/data/package.json
COPY packages/jobs/package.json packages/jobs/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace @tutors/api --workspace @tutors/worker --include-workspace-root=false

# Static frontend plus reverse proxy. Pages prerendered against the target environment's API are
# layered over the build output (the default directory is empty, so a build without them still works).
FROM caddy:2.10-alpine AS web
ARG PRERENDERED_DIR=infra/app/prerendered
COPY infra/app/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
COPY ${PRERENDERED_DIR} /srv

FROM node:24.14.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/api.mjs"]
