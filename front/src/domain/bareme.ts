// Barème maths, a line-for-line mirror of api/internal/rates/rates.go. Used for live
// previews only: the API's `/summary` is authoritative. Pure functions, no I/O.
import type { Band, Bareme, Tier, Vehicle } from '@/types'

/** What the barème needs to know about a vehicle. */
export type RatedVehicle = Pick<Vehicle, 'type' | 'fiscalHorsepower' | 'electric'>

/** The horsepower band of a vehicle (bounds absent or 0 = unbounded), like `Bareme.band`. */
export function bandFor(bareme: Bareme, vehicle: RatedVehicle): Band | undefined {
  const hp = vehicle.fiscalHorsepower ?? 0
  return (bareme.byType[vehicle.type] ?? []).find(
    (b) => (!b.minHp || hp >= b.minHp) && (!b.maxHp || hp <= b.maxHp),
  )
}

/** The tier for a yearly distance: the first with km ≤ upToKm, else the last one. */
export function tierFor(band: Band, yearlyKm: number): Tier | undefined {
  return (
    band.tiers.find((t) => !t.upToKm || yearlyKm <= t.upToKm) ?? band.tiers[band.tiers.length - 1]
  )
}

/**
 * Values `yearlyKm` driven with `vehicle` over the whole year, in integer cents
 * (`d × coef + constant`, +electricIncrease for electric vehicles, rounded to the cent).
 */
export function amountCentsFor(bareme: Bareme, vehicle: RatedVehicle, yearlyKm: number): number {
  if (!(yearlyKm > 0)) return 0
  const band = bandFor(bareme, vehicle)
  if (!band) return 0
  const tier = tierFor(band, yearlyKm)
  if (!tier) return 0
  let eur = yearlyKm * tier.coef + tier.constant
  if (vehicle.electric) eur *= 1 + bareme.electricIncrease
  return Math.round(eur * 100)
}

/** The distance that counts: doubled for a round trip (the API's `billedKm`). */
export function billedKm(distanceKm: number, roundTrip: boolean): number {
  return roundTrip ? distanceKm * 2 : distanceKm
}

/**
 * What a trip adds to the vehicle's year, in cents: amount(year + trip) − amount(year).
 * This is the "≈ +X € sur l'année" preview. `vehicleYearKm` is the vehicle's billed km
 * for the year without this trip (when editing, subtract the trip's previous billedKm).
 * Across a tier boundary the marginal rate changes, so this is not simply km × coef.
 */
export function tripPreviewCents(
  bareme: Bareme,
  vehicle: RatedVehicle,
  vehicleYearKm: number,
  tripBilledKm: number,
): number {
  const before = Math.max(vehicleYearKm, 0)
  return (
    amountCentsFor(bareme, vehicle, before + tripBilledKm) - amountCentsFor(bareme, vehicle, before)
  )
}
