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

const decimalFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 })

/** A number without unit, fr-FR (`32,5`, `1 234`). */
export function formatDecimal(value: number): string {
  return decimalFormat.format(value)
}

/** Euros from the API (a number rounded to the cent) → integer cents for `formatEuros`. */
export function toCents(euros: number): number {
  return Math.round(euros * 100)
}

/**
 * Parses a number typed by a French user: a comma or a dot as decimal separator, spaces
 * ignored (`"1 234,5"` → 1234.5). Returns `null` when it is not a positive number.
 */
export function parseDecimal(text: string | number | null | undefined): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null
  const clean = (text ?? '').replace(/[\s  ]/g, '').replace(',', '.')
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(clean)) return null
  const n = Number(clean)
  return Number.isFinite(n) ? n : null
}

/** Today as a local `YYYY-MM-DD` (no UTC shift). */
export function todayIso(now: Date = new Date()): IsoDate {
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}
