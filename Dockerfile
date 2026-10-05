# syntax=docker/dockerfile:1
FROM node:24.16.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM node:24.16.0-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 \
    DATABASE_PATH=/data/distributor.db DATA_REGION=CA \
    SECURE_COOKIES=true
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY --from=build /app/dist ./dist
COPY docs/THIRD-PARTY-NOTICES.md docs/RUNTIME.md ./docs/
COPY docs/licenses ./docs/licenses
COPY --chmod=755 scripts/container-entrypoint.sh /usr/local/bin/distributor-entrypoint
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["distributor-entrypoint"]
CMD ["node", "--import", "tsx", "src/server/main.ts"]
