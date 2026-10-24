// Domain types mirroring api/API.md (camelCase JSON). IDs are numbers, dates are
// `YYYY-MM-DD` strings and timestamps RFC 3339 strings. Money from the API is in
// euros (a JSON number rounded to the cent).

/** RFC 3339 timestamp (UTC), e.g. `2026-04-12T08:30:00Z`. */
export type Timestamp = string
/** Calendar date `YYYY-MM-DD`. */
export type IsoDate = string

export type Role = 'coach' | 'president'

export interface Address {
  line: string
  postalCode: string
  city: string
}

export interface Coach {
  id: number
  email: string
  registrationNumber: string
  firstName: string
  lastName: string
  role: Role
  /** Empty strings until the coach sets it (needed for a waiver). */
  address: Address
  createdAt: Timestamp
}

export type VehicleType = 'car' | 'motorcycle' | 'moped'

export interface Vehicle {
  id: number
  label: string
  type: VehicleType
  /** Puissance administrative in CV (1–99); always `null` for a moped. */
  fiscalHorsepower: number | null
  electric: boolean
  createdAt: Timestamp
}

export interface Trip {
  id: number
  /** UUID set by the front on create (idempotent offline replays); null for older rows. */
  clientId: string | null
  date: IsoDate
  origin: string
  destination: string
  purpose: string
  vehicleId: number
  /** One-way distance, as entered. */
  distanceKm: number
  roundTrip: boolean
  /** Server-computed: `distanceKm × 2` when `roundTrip`. A trip has no € amount. */
  billedKm: number
  createdAt: Timestamp
}

export interface MonthTotal {
  /** 1..12 */
  month: number
  km: number
  amount: number
}

export interface VehicleTotal {
  vehicleId: number
  label: string
  type: VehicleType
  fiscalHorsepower: number | null
  electric: boolean
  km: number
  amount: number
}

export interface Summary {
  year: number
  baremeSource: string
  totalKm: number
  totalAmount: number
  /** Always 12 entries, months 1..12. */
  byMonth: MonthTotal[]
  byVehicle: VehicleTotal[]
}

/** amount (EUR) = d × coef + constant, for a yearly distance d ≤ upToKm (absent or 0 = no bound). */
export interface Tier {
  upToKm?: number
  coef: number
  constant: number
}

/** One horsepower row, minHp..maxHp inclusive (absent or 0 = unbounded on that side). */
export interface Band {
  minHp?: number
  maxHp?: number
  tiers: Tier[]
}

/** One version of the barème kilométrique (mirrors api/internal/rates). */
export interface Bareme {
  fromYear: number
  source: string
  /** 0.2 = +20% for electric vehicles. */
  electricIncrease: number
  byType: Record<VehicleType, Band[]>
}

/** `GET /rates?year=` response: the barème in force for `year`. */
export interface RatesResponse extends Bareme {
  year: number
}

export interface Receipt {
  id: number
  /** e.g. `2025-0001`. */
  number: string
  year: number
  coachId: number
  amount: number
  waivedAt: Timestamp
  issuedAt: Timestamp
  issuedBy: number
}

export interface Waiver {
  year: number
  km: number
  amount: number
  waivedAt: Timestamp
  receipt: Receipt | null
}

/** One row of `GET /admin/coaches?year=` (president only). */
export interface CoachYear {
  coach: Coach
  totalKm: number
  totalAmount: number
  waiver: Waiver | null
}

/** Error body returned by the API for every non-2xx JSON response. */
export interface ApiError {
  error: string
}
