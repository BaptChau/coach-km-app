# COACH-KM-APP

An application for a French sports association: volunteer coaches log the kilometres they drive for the club,
see what they're owed under the official barème kilométrique, and can waive the reimbursement to get a tax
receipt (Cerfa 11580) issued by the club president.

- `api/`: Go API with SQLite. Contract: [api/API.md](api/API.md).
- `front/`: Vue 3 + Vuetify PWA, mobile first. See [front/README.md](front/README.md).
- `docker/`, `compose.yaml`: the API behind an nginx reverse proxy. See [docker/README.md](docker/README.md).
- `scripts/seed-dev.mjs`: dummy data for development (below).

## Run it

### With Docker (API + nginx serving the PWA)

```bash
cp .env.example .env              # set JWT_SECRET: openssl rand -base64 48
docker compose up --build -d
node scripts/seed-dev.mjs         # optional: dummy data (see below)
```

Open http://localhost:8080 (or the `HTTP_PORT` set in `.env`). Details and the security setup are in
[docker/README.md](docker/README.md).

### For development

Two options for the front:

- **Front only, no backend:** `cd front && npm install && npm run dev`, then open http://localhost:5173.
  A mock API runs in the browser, already filled with the same dummy data as below.
- **Front + real API:**

  ```bash
  # terminal 1: the API on port 3000, database in api/dev.db
  cd api && JWT_SECRET=dev-secret-xyz go run ./cmd/server

  # terminal 2: dummy data, then the front with the mock API turned off
  node scripts/seed-dev.mjs --target local
  cd front && VITE_USE_MOCKS=false npm run dev
  ```

  The Vite dev server forwards `/api` to `http://localhost:3000` (override with `API_PROXY_TARGET`).

## Development data

`scripts/seed-dev.mjs` (Node 22+, no dependencies) fills an empty development API with dummy data **through the
API**, then sets the president role with the admin CLI. It is safe to run again: nothing is duplicated.

```bash
node scripts/seed-dev.mjs                  # Docker stack: http://localhost:$HTTP_PORT/api
node scripts/seed-dev.mjs --target local   # go run ./cmd/server: http://localhost:3000
```

Every account uses the password **`password1`**:

| E-mail | Name | Role | What it shows |
|---|---|---|---|
| `coach@club.fr` | Jeanne Dupont | coach | A car (5 CV) and an electric motorcycle, 25 trips over this year and last year. Last year is waived and its tax receipt issued. |
| `president@club.fr` | Marc Lefèvre | **president** | The Admin screen. One car (6 CV), 4 trips this year. |
| `paul.martin@club.fr` | Paul Martin | coach | A car and a moped. Last year waived, receipt still to issue ("À émettre"). |
| `sophie.bernard@club.fr` | Sophie Bernard | coach | An electric car, a few trips, no waiver and no address yet (the export screen asks for it). |

The first two accounts and their trips are the same as the front's mock API, so both backends show the same
screens. Trips in the current year never fall after today.

Options:

- `SEED_API_URL`: the API's base URL, if it isn't one of the defaults above.
- `HTTP_PORT`: the Docker stack's port; read from `.env` when not set.
- `DB_PATH`: with `--target local`, the database the admin CLI updates, relative to `api/` (default `./dev.db`).

Notes:

- **The tax receipt is issued only when the association details are complete**, `ASSOCIATION_OBJECT` included.
  Otherwise the script prints a warning; fill them in (`.env` for Docker, environment variables for
  `go run`) and run it again.
- Through nginx, login is limited to 10 per minute. The script waits and retries, so a run can take about 30 s.
- **Never run it against production:** it creates accounts with a known password.

To start again from an empty database: `docker compose down -v` (Docker) or `rm api/dev.db*` (local).
