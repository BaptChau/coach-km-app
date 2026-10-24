// Property-style checks of the barème maths over many inputs (issue #13). The inputs come
// from a fixed-seed generator: every run tests the same values, failures are reproducible.
import { FALLBACK_BAREME as b } from '@/config/rates'
import type { Band, Bareme, Tier, VehicleType } from '@/types'

import { amountCentsFor, bandFor, tierFor, tripPreviewCents, type RatedVehicle } from './bareme'

/** mulberry32: a tiny deterministic PRNG, uniform in [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A km value with one decimal in [0, max]. */
const kmFrom = (r: () => number, max: number) => Math.round(r() * max * 10) / 10

/**
 * A literal transcription of `Bareme.AmountCents` in api/internal/rates/rates.go, kept apart
 * from the app code so both can be compared on many inputs.
 */
function goAmountCents(bareme: Bareme, v: RatedVehicle, km: number): number {
  if (km <= 0) return 0
  const hp = v.fiscalHorsepower ?? 0
  let band: Band | undefined
  for (const candidate of bareme.byType[v.type] ?? []) {
    const minHp = candidate.minHp ?? 0
    const maxHp = candidate.maxHp ?? 0
    if ((minHp === 0 || hp >= minHp) && (maxHp === 0 || hp <= maxHp)) {
      band = candidate
      break
    }
  }
  if (!band) return 0
  let t: Tier | undefined
  for (t of band.tiers) {
    if (!t.upToKm || km <= t.upToKm) break
  }
  if (!t) return 0
  let eur = km * t.coef + t.constant
  if (v.electric) eur *= 1 + bareme.electricIncrease
  return Math.round(eur * 100)
}

/** One representative vehicle per horsepower band of every type, combustion and electric. */
function everyBand(): { name: string; vehicle: RatedVehicle; band: Band }[] {
  const out: { name: string; vehicle: RatedVehicle; band: Band }[] = []
  for (const type of Object.keys(b.byType) as VehicleType[]) {
    for (const band of b.byType[type]) {
      const hp = type === 'moped' ? null : (band.minHp ?? band.maxHp ?? 1)
      for (const electric of [false, true]) {
        const vehicle: RatedVehicle = { type, fiscalHorsepower: hp, electric }
        out.push({ name: `${type} ${hp ?? '-'}CV${electric ? ' électrique' : ''}`, vehicle, band })
      }
    }
  }
  return out
}

const BANDS = everyBand()
const MAX_KM = 40_000

/** The tier boundaries of a band (the `upToKm` of every tier but the last). */
const boundariesOf = (band: Band) => band.tiers.map((t) => t.upToKm).filter((k): k is number => !!k)

describe('barème properties (fixed seed)', () => {
  it('covers every band of every vehicle type', () => {
    // 5 car + 3 motorcycle + 1 moped bands, each combustion and electric.
    expect(BANDS).toHaveLength(18)
    for (const { vehicle, band } of BANDS) expect(bandFor(b, vehicle)).toBe(band)
    expect(new Set(BANDS.flatMap(({ band }) => boundariesOf(band)))).toEqual(
      new Set([3000, 5000, 6000, 20000]),
    )
  })

  it.each(BANDS)('$name: matches the Go formula on 2 000 random km', ({ vehicle }) => {
    const r = rng(0xc0ac4)
    for (let i = 0; i < 2000; i++) {
      const km = kmFrom(r, MAX_KM)
      expect(amountCentsFor(b, vehicle, km)).toBe(goAmountCents(b, vehicle, km))
    }
  })

  it.each(BANDS)('$name: is monotonic (never decreases as km grow)', ({ vehicle, band }) => {
    const r = rng(42)
    const kms = Array.from({ length: 3000 }, () => kmFrom(r, MAX_KM))
    // Probe each tier boundary closely too.
    for (const edge of boundariesOf(band)) kms.push(edge - 0.1, edge, edge + 0.1, edge + 1)
    kms.sort((x, y) => x - y)
    let previous = 0
    for (const km of kms) {
      const amount = amountCentsFor(b, vehicle, km)
      expect(amount, `${km} km`).toBeGreaterThanOrEqual(previous)
      previous = amount
    }
  })

  it.each(BANDS)(
    '$name: only steps up a little at the tier boundaries, like the Go formula',
    ({ vehicle, band }) => {
      for (const edge of boundariesOf(band)) {
        const at = amountCentsFor(b, vehicle, edge)
        const after = amountCentsFor(b, vehicle, edge + 0.01)
        // The boundary km belongs to the lower tier ("km ≤ upToKm").
        expect(tierFor(band, edge)?.upToKm).toBe(edge)
        expect(tierFor(band, edge + 0.01)).not.toBe(tierFor(band, edge))
        // The official barème is nearly continuous: the next tier's formula starts within
        // 0.5 % above the previous one (e.g. +3 € on a moped at 3 000 km, +15 € on a ≤3 CV
        // car at 20 000 km), never below.
        expect(after).toBeGreaterThanOrEqual(at)
        expect(after - at).toBeLessThanOrEqual(Math.ceil(at * 0.005))
        expect(after).toBe(goAmountCents(b, vehicle, edge + 0.01))
      }
    },
  )

  it('values an electric vehicle at round(base € × 1.2), from the unrounded euros', () => {
    const r = rng(7)
    let roundedFirstWouldDiffer = 0
    for (const { vehicle, band } of BANDS.filter((x) => x.vehicle.electric)) {
      for (let i = 0; i < 1000; i++) {
        const km = kmFrom(r, MAX_KM) + 0.1
        const tier = tierFor(band, km)!
        const baseEuros = km * tier.coef + tier.constant
        const electric = amountCentsFor(b, vehicle, km)
        expect(electric).toBe(Math.round(baseEuros * 1.2 * 100))
        // Rounding the combustion amount first would be off by at most a cent.
        const combustion = amountCentsFor(b, { ...vehicle, electric: false }, km)
        expect(Math.abs(electric - Math.round(combustion * 1.2))).toBeLessThanOrEqual(1)
        if (electric !== Math.round(combustion * 1.2)) roundedFirstWouldDiffer++
      }
    }
    // …and it does differ sometimes: the order of the rounding matters.
    expect(roundedFirstWouldDiffer).toBeGreaterThan(0)
  })

  it.each(BANDS)('$name: a trip preview is never negative', ({ vehicle }) => {
    const r = rng(1234)
    for (let i = 0; i < 1500; i++) {
      const yearKm = kmFrom(r, MAX_KM)
      const tripKm = kmFrom(r, 600)
      expect(tripPreviewCents(b, vehicle, yearKm, tripKm)).toBeGreaterThanOrEqual(0)
    }
    // A negative "km so far" (an edit subtracting more than logged) counts as 0.
    expect(tripPreviewCents(b, vehicle, -50, 100)).toBe(amountCentsFor(b, vehicle, 100))
  })

  it.each(BANDS)(
    '$name: the previews of sequential trips add up to the amount of the total',
    ({ vehicle }) => {
      const r = rng(2026)
      for (let year = 0; year < 20; year++) {
        let km = 0
        let sum = 0
        // 30 to 200 trips of 1 to 500 km: crosses every boundary on many years.
        const count = 30 + Math.floor(r() * 170)
        for (let i = 0; i < count; i++) {
          const trip = kmFrom(r, 500) + 1
          sum += tripPreviewCents(b, vehicle, km, trip)
          km += trip
        }
        expect(sum).toBe(amountCentsFor(b, vehicle, km))
      }
    },
  )

  it('values nothing for an unknown type or a band-less horsepower', () => {
    const noBand: Bareme = { ...b, byType: { ...b.byType, car: [{ minHp: 4, tiers: [] }] } }
    expect(amountCentsFor(noBand, { type: 'car', fiscalHorsepower: 2, electric: false }, 100)).toBe(
      0,
    )
    expect(amountCentsFor(noBand, { type: 'car', fiscalHorsepower: 5, electric: false }, 100)).toBe(
      0,
    )
    expect(goAmountCents(noBand, { type: 'car', fiscalHorsepower: 5, electric: false }, 100)).toBe(
      0,
    )
  })
})
