# coach-km-app API contract (v1)

Single source of truth shared by the Go API (`api/`) and the Vue PWA (`front/`).

- JSON everywhere, **camelCase** fields. Dates are `YYYY-MM-DD`; timestamps are RFC 3339 (UTC).
- Money is a JSON number in **euros, rounded to the cent** (computed server-side in integer cents).
- Auth: `Authorization: Bearer <jwt>` (HS256, 24 h). A missing, invalid or expired token returns **401**.
- Errors: `{ "error": "<message>" }` with 400 (validation), 401, 404, 409 (conflict), 500 or 502.
- Request bodies are capped at 1 MiB, and unknown JSON fields are rejected with 400.
- Everything is scoped to the authenticated coach. Another coach's resource returns **404**, never 403.

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{ email, registrationNumber, firstName, lastName, password }` | **201** `{ token, coach }` |
| POST | `/auth/login` | `{ email, password }` | 200 `{ token, coach }` |
| GET | `/auth/me` | — | 200 `{ coach }` |

`Coach = { id, email, registrationNumber, firstName, lastName, createdAt }`

- `email` is trimmed, lower-cased and unique (409 `email already registered`).
- `registrationNumber` is the club registration number: 13 digits starting with the common prefix `5655006`
  (e.g. `5655006101030`). Spaces are removed. It must be unique (409) and match `REGISTRATION_NUMBER_PATTERN`
  (default `^5655006[0-9]{6}$`).
- `password` must be 8–72 bytes.
- A failed login always returns 401 `invalid email or password`, so the response never reveals whether an email is registered.

## Vehicles

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/vehicles` | — | 200 `Vehicle[]` |
| POST | `/vehicles` | `{ label, type }` | 201 `Vehicle` |
| PATCH | `/vehicles/{id}` | any of `{ label, type }` | 200 `Vehicle` |
| DELETE | `/vehicles/{id}` | — | 204 · **409** if trips still use it |

`Vehicle = { id, label, type: "car" | "two_wheeler", createdAt }`

## Trips

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/trips?year=YYYY[&limit=&offset=]` | — | 200 `Trip[]` (newest first; `year` defaults to the current year, `limit` defaults to 1000, max 1000) |
| POST | `/trips` | `{ clientId?, date, origin, destination, purpose, vehicleId, distanceKm, roundTrip }` | **201** `Trip`, or **200** with the existing trip when `clientId` was already used |
| GET | `/trips/{id}` | — | 200 `Trip` |
| PATCH | `/trips/{id}` | any subset of the POST fields except `clientId` | 200 `Trip` |
| DELETE | `/trips/{id}` | — | 204 |

```
Trip = {
  id, clientId, date, origin, destination, purpose, vehicleId,
  distanceKm,   // one-way distance, as entered
  roundTrip,    // true ⇒ billedKm = distanceKm × 2
  billedKm,     // server-computed
  rate,         // €/km applied (barème of the trip's year, for the vehicle type)
  amount,       // billedKm × rate, in €, rounded to the cent
  createdAt
}
```

- **Offline queue:** the front sets `clientId` (a UUID) when it creates a trip offline. Replaying the same POST,
  even several times concurrently, creates the trip only once and returns the stored trip.
- `vehicleId` must be one of the coach's own vehicles, otherwise the API returns 400.
- `origin`, `destination` and `purpose` are required (max 255 characters). `distanceKm` must be greater than 0 and at most 100000.

## Rates (barème kilométrique bénévoles)

`GET /rates?year=YYYY` (public, cacheable) → `{ year, provisional, rates: { car, two_wheeler } }`

If a year has no published rates yet, the API applies the latest earlier year's rates and sets `provisional: true`.
Rates are stored in the `rates` table in thousandths of a euro (0.331 €/km = 331). Restart the API after adding a year.

## Summary

`GET /summary?year=YYYY` →

```
{ year, provisional, totalKm, totalAmount,
  byMonth:   [{ month: 1..12, km, amount }],          // always 12 entries
  byVehicle: [{ vehicleId, label, type, km, amount }] }
```

## Export

`GET /export?year=YYYY&format=csv|pdf` returns a file download (`Content-Disposition: attachment`).

- **CSV:** UTF-8 with BOM, `;` separator and comma decimals, so it opens cleanly in French Excel.
- **PDF:** the yearly récapitulatif, with the coach's name and registration number, one row per trip and totals.

## Misc

- `GET /healthz` returns 200 `{ status: "ok" }` (checks the DB).
- `GET /external/demo` (auth required) is a demo outbound call, to be replaced by a distance provider.
