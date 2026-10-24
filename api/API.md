# coach-km-app API contract (v1)

Single source of truth shared by the Go API (`api/`) and the Vue PWA (`front/`).

- JSON everywhere, **camelCase** fields. Dates are `YYYY-MM-DD`; timestamps are RFC 3339 (UTC).
- Money is a JSON number in **euros, rounded to the cent** (computed server-side in integer cents).
- Auth: `Authorization: Bearer <jwt>` (HS256, 24 h). A missing, invalid or expired token returns **401**.
- Errors: `{ "error": "<message>" }` with 400 (validation), 401, 403 (president only), 404, 409 (conflict / locked year), 500, 502 or 503.
- Request bodies are capped at 1 MiB, and unknown JSON fields are rejected with 400.
- Everything is scoped to the authenticated coach. Another coach's resource returns **404**, never 403.

## Auth and profile

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{ email, registrationNumber, firstName, lastName, password }` | **201** `{ token, coach }` |
| POST | `/auth/login` | `{ email, password }` | 200 `{ token, coach }` |
| GET | `/auth/me` | — | 200 `{ coach }` |
| PATCH | `/auth/me` | any of `{ firstName, lastName, address: { line, postalCode, city } }` | 200 `{ coach }` |

```
Coach = { id, email, registrationNumber, firstName, lastName,
          role: "coach" | "president",
          address: { line, postalCode, city },   // empty strings until set; printed on the tax receipt
          createdAt }
```

- `email` is trimmed, lower-cased and unique (409 `email already registered`).
- `registrationNumber` is the club registration number: 13 digits starting with the common prefix `5655006`
  (e.g. `5655006101030`). Spaces are removed. It must be unique (409) and match `REGISTRATION_NUMBER_PATTERN`
  (default `^5655006[0-9]{6}$`).
- `password` must be 8–72 bytes.
- A failed login always returns 401 `invalid email or password`, so the response never reveals whether an email is registered.
- Roles are set on the server only: `go run ./cmd/admin set-role <email> president|coach`. No API call can grant them.

## Vehicles

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/vehicles` | — | 200 `Vehicle[]` |
| POST | `/vehicles` | `{ label, type, fiscalHorsepower, electric }` | 201 `Vehicle` |
| PATCH | `/vehicles/{id}` | any of the POST fields | 200 `Vehicle` · **409** if `type`, `fiscalHorsepower` or `electric` change while the vehicle has trips in a waived year (the label can always change) |
| DELETE | `/vehicles/{id}` | — | 204 · **409** if trips still use it |

`Vehicle = { id, label, type: "car" | "motorcycle" | "moped", fiscalHorsepower, electric, createdAt }`

- `fiscalHorsepower` is the *puissance administrative* in CV (1–99). It is required for `car` and `motorcycle`;
  for `moped` it is ignored and returned as `null`, because the moped barème has no horsepower bands.

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
  createdAt
}
```

- A trip has **no € amount**. The barème is tiered on each vehicle's total distance for the year, so money only exists per vehicle per year (see Summary).
- **Offline queue:** the front sets `clientId` (a UUID) when it creates a trip offline. Replaying the same POST,
  even several times concurrently, creates the trip only once and returns the stored trip.
- `vehicleId` must be one of the coach's own vehicles, otherwise the API returns 400.
- `origin`, `destination` and `purpose` are required (max 255 characters). `distanceKm` must be greater than 0 and at most 100000.
- **Locked years:** once the coach has waived reimbursement for a year, creating, editing or deleting a trip in that year (or moving one into it) returns **409**.

## Rates (barème kilométrique)

Volunteers are reimbursed using the employees' barème (service-public.gouv.fr
[F1132](https://www.service-public.gouv.fr/particuliers/vosdroits/F1132), arrêté du 27 mars 2023). Its rules:

- The rate depends on the vehicle category and its fiscal horsepower.
- It is **tiered on `d`, the total distance driven with that vehicle in the year**: amount = `d × coef + constant`.
  Car tiers break at 5,000 and 20,000 km; motorcycle and moped tiers break at 3,000 and 6,000 km.
- Electric vehicles get **+20%**.

`GET /rates?year=YYYY` (public, cacheable) →

```
{ year, fromYear, source, electricIncrease: 0.2,
  byType: { car | motorcycle | moped: [ { minHp?, maxHp?, tiers: [ { upToKm?, coef, constant } ] } ] } }
```

A band without `minHp`/`maxHp` has no bound on that side, and the last tier has no `upToKm`. The front can use this to
preview a vehicle's yearly amount. A new arrêté is added as a new version in `internal/rates/rates.go`, and it applies
from its `fromYear` onwards.

## Summary

`GET /summary?year=YYYY` →

```
{ year, baremeSource, totalKm, totalAmount,
  byMonth:   [{ month: 1..12, km, amount }],     // always 12 entries
  byVehicle: [{ vehicleId, label, type, fiscalHorsepower, electric, km, amount }] }
```

Each vehicle is valued once on its yearly distance. Its amount is then spread across the months in proportion to the km
driven, rounded so that the months always add up exactly to the total.

## Export

`GET /export?year=YYYY&format=csv|pdf` returns a file download (`Content-Disposition: attachment`).

- **CSV:** UTF-8 with BOM, `;` separator and comma decimals, so it opens cleanly in French Excel.
- **PDF:** the yearly récapitulatif: the coach's name and registration number, the trip log, the per-vehicle valuation and the total.

## Abandon de frais: waivers and tax receipts (Cerfa 11580)

A coach can give up being reimbursed and have the amount treated as a donation, which gives a 66% tax reduction.
service-public requires that renunciation in writing, so the flow is:

1. The coach sets a postal address (`PATCH /auth/me`).
2. The coach records a **waiver** for a year. This freezes the year's amount and locks its trips.
3. The **president** issues the numbered tax receipt.

### Coach

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/waivers` | — | 200 `Waiver[]` |
| POST | `/waivers` | `{ year }` | **201** `Waiver` · 400 if the address is missing or there is no mileage · 409 if the year is already waived |
| DELETE | `/waivers/{year}` | — | 204 (unlocks the year) · **409** once a receipt has been issued |
| GET | `/receipts/{id}/pdf` | — | the receipt PDF (the coach's own receipts; the president can download any receipt) |

`Waiver = { year, km, amount, waivedAt, receipt: Receipt | null }`

### President only (403 for other accounts)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/admin/coaches?year=YYYY` | — | 200 `[{ coach, totalKm, totalAmount, waiver: Waiver \| null }]` |
| GET | `/admin/receipts?year=YYYY` | — | 200 `Receipt[]` |
| POST | `/admin/receipts` | `{ coachId, year }` | **201** `Receipt` · 409 if the coach hasn't waived or the receipt already exists · 503 if `ASSOCIATION_*` isn't configured |

`Receipt = { id, number: "2025-0001", year, coachId, amount, waivedAt, issuedAt, issuedBy }`

- Receipt numbers run in sequence per year with no gaps, even when several receipts are issued at the same time.
- The amount is copied from the waiver, and a receipt can't be changed once issued.
- The PDF follows the sections of model Cerfa n° 11580*05, with the beneficiary taken from the `ASSOCIATION_*` settings.
  It ticks article 200, *Forme : Autres* and *Nature : Numéraire*, and adds an abandon-de-frais mention.

## Misc

- `GET /healthz` returns 200 `{ status: "ok" }` (checks the DB).
- `GET /external/demo` (auth required) is a demo outbound call, to be replaced by a distance provider.
