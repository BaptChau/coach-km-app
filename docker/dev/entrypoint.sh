#!/bin/sh
# Development entrypoint of the API image (target `dev`): starts from an empty
# database, starts the server, fills it with dummy data, then hands over to the
# server. Never used in production.
set -eu

rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"

/app/server &
pid=$!
# Forward docker stop / Ctrl-C to the server so it shuts down cleanly.
trap 'kill -TERM "$pid" 2>/dev/null' TERM INT

i=0
until wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -gt 50 ] || ! kill -0 "$pid" 2>/dev/null; then
        echo "dev-entrypoint: the API did not start" >&2
        exit 1
    fi
    sleep 0.2
done

node /app/seed-dev.mjs --target container || echo "dev-entrypoint: seeding failed, the API runs with what it has" >&2

# `wait` returns early when a trapped signal arrives: keep waiting until the
# server has really exited.
while kill -0 "$pid" 2>/dev/null; do
    wait "$pid" || true
done
