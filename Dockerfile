FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public ./public
COPY src ./src
COPY rust/goldfish/kingdoms.json ./rust/goldfish/kingdoms.json
RUN npm run build:production && mkdir -p /var/data

FROM gcr.io/distroless/nodejs22-debian12:nonroot

WORKDIR /app
COPY --from=build --chown=65532:65532 /app/dist ./dist
COPY --from=build --chown=65532:65532 /app/build/server.mjs ./server.mjs
COPY --from=build --chown=65532:65532 /var/data /var/data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    HEXDECK_DATA_DIR=/var/data/games \
    HEXDECK_STATIC_DIR=/app/dist
EXPOSE 4173
VOLUME ["/var/data"]
CMD ["/app/server.mjs"]
