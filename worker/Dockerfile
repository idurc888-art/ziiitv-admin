FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV WORKER_MODE=continuous
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src/domain ./src/domain
COPY worker/playlist-import-worker.ts ./worker/playlist-import-worker.ts
USER node
CMD ["node", "--import", "tsx", "worker/playlist-import-worker.ts"]
