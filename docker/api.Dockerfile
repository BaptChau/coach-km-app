# syntax=docker/dockerfile:1
# Go API image. Build context: ./api (see compose.yaml). The api/ folder is
# left untouched, so this file and its .dockerignore live in docker/.
#
# Targets: `prod` (the default, last stage) and `dev`, which starts every
# container with a fresh database filled with dummy data (compose.dev.yaml).

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
# modernc SQLite is pure Go: a static binary with no cgo.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/admin ./cmd/admin

FROM alpine:3.22 AS runtime
# tzdata: dates and receipt numbering follow Europe/Paris; wget (busybox) serves the healthcheck.
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app && \
    mkdir -p /data && chown app:app /data
COPY --from=build /out/server /out/admin /app/
ENV PORT=3000 \
    DB_PATH=/data/coach-km.db \
    TZ=Europe/Paris
USER app
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/app/server"]

# ---- dev: fresh, seeded database on every start -------------------------------
# Extra build contexts (compose.dev.yaml): "seed" = ./scripts, "devtools" = ./docker/dev.
FROM runtime AS dev
USER root
RUN apk add --no-cache nodejs
COPY --from=seed seed-dev.mjs /app/seed-dev.mjs
COPY --from=devtools --chmod=755 entrypoint.sh /app/dev-entrypoint.sh
USER app
# The database lives in the container's tmpfs: gone when the container stops.
ENV DB_PATH=/tmp/coach-km.db
ENTRYPOINT ["/app/dev-entrypoint.sh"]

# ---- prod (default) -----------------------------------------------------------
FROM runtime AS prod
