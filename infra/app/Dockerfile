FROM node:24.14.1-bookworm-slim AS build
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

FROM node:24.14.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/api.mjs"]
