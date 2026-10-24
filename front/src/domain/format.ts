// fr-FR display formatters (Intl). fr-FR groups thousands with a narrow no-break space
// (U+202F) and puts a no-break space (U+00A0) before "€" and "km".
import type { IsoDate, Timestamp, Vehicle, VehicleType } from '@/types'

const LOCALE = 'fr-FR'

const eurosFormat = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' })
const kmFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 })
const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const shortDateFormat = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
})

/** Integer cents → `1 234,56 €`. */
export function formatEuros(cents: number): string {
  return eurosFormat.format(cents / 100)
}

/** Kilometres (at most one decimal) → `1 234,5 km`. */
export function formatKm(km: number): string {
  return `${kmFormat.format(km)} km`
}

/**
 * Parses a `YYYY-MM-DD` date as a local calendar day (no UTC shift), or an RFC 3339
 * timestamp as is.
 */
export function parseDate(iso: IsoDate | Timestamp): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return new Date(iso)
}

/** `2026-04-12` → `12/04/2026`. */
export function formatDate(iso: IsoDate | Timestamp): string {
  return dateFormat.format(parseDate(iso))
}

/** `2026-04-11` → `sam. 11/04`. */
export function formatShortDate(iso: IsoDate | Timestamp): string {
  return shortDateFormat.format(parseDate(iso))
}

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  car: 'Voiture',
  motorcycle: 'Moto',
  moped: 'Cyclomoteur',
}

/** `Voiture · 5 CV · électrique` (no CV for a moped, no "électrique" when thermal). */
export function vehicleLabel(
  vehicle: Pick<Vehicle, 'type' | 'fiscalHorsepower' | 'electric'>,
): string {
  const parts = [VEHICLE_TYPE_LABELS[vehicle.type]]
  if (vehicle.type !== 'moped' && vehicle.fiscalHorsepower != null) {
    parts.push(`${vehicle.fiscalHorsepower} CV`)
  }
  if (vehicle.electric) parts.push('électrique')
  return parts.join(' · ')
}
