// Year valuation, mirroring api/internal/report/valuation.go: each vehicle is valued
// once on its yearly billed km (tiered barème), then its amount is spread over the
// months pro rata to km, with largest-remainder rounding so the months add up exactly.
import { FALLBACK_BAREME } from '@/config/rates'
import { amountCentsFor } from '@/domain'
import type { Bareme } from '@/types'

import type { MockDb, MockVehicle } from './db'

/** The mock serves one barème version for every year (the API's current arrêté). */
export function baremeFor(): Bareme {
  return FALLBACK_BAREME
}

export interface VehicleValuation {
  vehicle: MockVehicle
  km: number
  cents: number
}

export interface Valuation {
  year: number
  bareme: Bareme
  vehicles: VehicleValuation[]
  byMonthKm: number[]
  byMonthCents: number[]
  totalKm: number
  totalCents: number
}

/** Splits `total` cents over `weights`, like `rates.Split` (largest remainder, stable order). */
export function split(total: number, weights: readonly number[]): number[] {
  const out = weights.map(() => 0)
  const sum = weights.reduce((s, w) => s + w, 0)
  if (sum <= 0 || total === 0) return out
  let given = 0
  const rems = weights.map((w, i) => {
    const exact = (total * w) / sum
    out[i] = Math.floor(exact)
    given += out[i]
    return { i, r: exact - Math.floor(exact) }
  })
  rems.sort((a, b) => b.r - a.r) // Array.prototype.sort is stable
  for (let k = 0; k < total - given; k++) {
    const target = rems[k]
    if (target) out[target.i] = (out[target.i] ?? 0) + 1
  }
  return out
}

/** Rounds float km sums to 0.01 so the JSON has no binary noise (0.30000000000000004). */
export function roundKm(km: number): number {
  return Math.round(km * 100) / 100
}

export function centsToEuros(cents: number): number {
  return Math.round(cents) / 100
}

/** The year (as a number) of a `YYYY-MM-DD` date. */
export function yearOf(date: string): number {
  return Number(date.slice(0, 4))
}

/** Values one coach's year from their trips. */
export function valueYear(db: MockDb, userId: number, year: number): Valuation {
  const bareme = baremeFor()
  const vehicles = db.vehicles.filter((v) => v.userId === userId)
  const byMonthKm = Array.from({ length: 12 }, () => 0)
  const byMonthCents = Array.from({ length: 12 }, () => 0)
  let totalKm = 0
  let totalCents = 0

  const valued = vehicles.map((vehicle) => {
    const monthKm = Array.from({ length: 12 }, () => 0)
    for (const t of db.trips) {
      if (t.userId !== userId || t.vehicleId !== vehicle.id || yearOf(t.date) !== year) continue
      const m = Number(t.date.slice(5, 7)) - 1
      if (m >= 0 && m < 12) monthKm[m] = (monthKm[m] ?? 0) + t.billedKm
    }
    const km = monthKm.reduce((s, k) => s + k, 0)
    const cents = amountCentsFor(bareme, vehicle, km)
    const parts = split(cents, monthKm)
    for (let m = 0; m < 12; m++) {
      byMonthKm[m] = (byMonthKm[m] ?? 0) + (monthKm[m] ?? 0)
      byMonthCents[m] = (byMonthCents[m] ?? 0) + (parts[m] ?? 0)
    }
    totalKm += km
    totalCents += cents
    return { vehicle, km, cents }
  })

  return { year, bareme, vehicles: valued, byMonthKm, byMonthCents, totalKm, totalCents }
}
