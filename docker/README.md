# Running coach-km-app with Docker

Two containers, started by [`compose.yaml`](../compose.yaml) at the repository root:

```
browser ──HTTP──▶ web (nginx, port 8080) ──/api/*──▶ api (Go, port 3000) ──▶ SQLite volume
                   └─ serves the PWA (front/dist)
```

- **web**: nginx serving the built PWA, and the **only** published entry point. It forwards
  `/api/*` to the API with the `/api` prefix stripped (the API has no CORS, so the PWA calls it
  same-origin).
- **api**: the Go server. It publishes no port and sits on an `internal` network with no route to
  the internet. Its SQLite database lives in the `api-data` volume.

The Dockerfiles live in `docker/` so that nothing in `api/` changes.

## Quick start

```bash
cp .env.example .env
# set JWT_SECRET (e.g. openssl rand -base64 48) and, for receipts, ASSOCIATION_OBJECT
docker compose up --build -d
```

Open http://localhost:8080 (or the `HTTP_PORT` you set).

## Development and production modes

`.env.example` contains `COMPOSE_FILE=compose.yaml:compose.dev.yaml`, so a copy of it runs in
**development mode**:

- The API image is built with the `dev` target. Its database lives in the container's tmpfs, and at
  every start the container wipes it, starts the server and runs `scripts/seed-dev.mjs`.
- **Every `docker compose up --build -d` resets the database to the dummy data**: four accounts with
  the password `password1` (see the root [README](../README.md#development-data)). The small
  `reset-trigger` service is rebuilt without cache each time, which makes Compose restart the API.
  It takes about 10 s.
- A plain `docker compose up -d` keeps the data, and so does editing trips in the app; a
  `docker compose restart api` resets it.
- A placeholder `ASSOCIATION_OBJECT` is used when `.env` leaves it empty, so the seeded tax receipt
  can be issued.

**Production mode: delete the `COMPOSE_FILE` line from `.env`.** The API then uses the `prod`
target (no Node, no seed script), stores its database in the persistent `api-data` volume, and
starts empty. Register an account, then make it the president:

```bash
docker compose exec api /app/admin set-role <email> president
```

Useful commands:

```bash
docker compose ps                 # both services should be "healthy"
docker compose logs -f web api    # access log + API request log
docker compose up --build -d      # deploy a new version (production: data is kept in the volume)
docker compose down               # stop (add -v to DELETE the database volume)
```

### Backup (production mode)

SQLite runs in WAL mode; use its online backup rather than copying the file:

```bash
docker run --rm -v coach-km_api-data:/data -v "$PWD":/backup alpine \
  sh -c 'apk add -q sqlite && sqlite3 /data/coach-km.db ".backup /backup/coach-km-$(date +%F).db"'
```

## What protects the app

**Reverse proxy (nginx, `docker/nginx/`)**

- The API is reachable only through nginx; its container publishes no port.
- **Rate limits per IP:** `POST /api/auth/login` and `/register` allow 10 per minute (burst 5),
  because they are brute-force targets and bcrypt is costly. The rest of `/api` allows
  10 requests/s (burst 40, enough for an offline-queue sync). Over the limit: `429`.
- 30 concurrent connections per IP; short header/body timeouts against slow clients
  (slowloris); bodies over 1 MiB rejected with `413` before reaching the API.
- Only the expected methods: `GET` for the PWA files, `POST` for login/register.
- **Security headers** on every response: a strict Content-Security-Policy (no inline scripts,
  no third-party origins), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy` / `-Resource-Policy`. The nginx version is
  hidden.
- API responses are marked `Cache-Control: private, no-cache` so no shared cache keeps personal
  data. Dotfiles (`.env`, `.git`…) are denied, and the dev-only MSW worker is not shipped.
- Caching for the PWA: hashed `/assets/` for a year, `index.html`, `sw.js` and the manifest
  revalidated on every load so a deploy reaches installed apps.

**Containers**

- Both run as **non-root** users (`app` uid 10001, `nginx` uid 101), with a **read-only** root
  filesystem (only `/tmp` and the data volume are writable), **all Linux capabilities dropped**,
  `no-new-privileges`, and memory/PID limits.
- The API's network is `internal`: even if it were compromised it couldn't call out. (The demo
  endpoint `/api/external/demo` therefore fails; give the API a second, non-internal network
  when the real distance provider replaces it.)
- Secrets come from `.env`, which is git-ignored; nothing secret is baked into the images.
- Healthchecks on both services; `web` starts only once `api` is healthy. Logs are rotated.

## HTTPS (required in production)

The stack serves plain HTTP on `127.0.0.1` by default. In production, put TLS in front of it:
logins send passwords and tokens, and the PWA (service worker, install prompt) only works over
HTTPS. Two common options:

- a TLS terminator on the host (Caddy, Traefik, a host nginx with Let's Encrypt, or a provider's
  load balancer) forwarding to `127.0.0.1:${HTTP_PORT}`; nginx already trusts
  `X-Forwarded-For` from private networks for the rate limits;
- or set `HTTP_BIND=0.0.0.0` behind a cloud load balancer that terminates TLS.

Once TLS is in place, add `Strict-Transport-Security` (HSTS) at the TLS terminator.
