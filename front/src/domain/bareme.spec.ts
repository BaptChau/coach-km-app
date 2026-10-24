import { FALLBACK_BAREME as b } from '@/config/rates'
import type { Vehicle } from '@/types'

import { amountCentsFor, bandFor, billedKm, tripPreviewCents } from './bareme'

type V = Pick<Vehicle, 'type' | 'fiscalHorsepower' | 'electric'>
const car = (hp: number, electric = false): V => ({ type: 'car', fiscalHorsepower: hp, electric })
const moto = (hp: number): V => ({ type: 'motorcycle', fiscalHorsepower: hp, electric: false })
const moped: V = { type: 'moped', fiscalHorsepower: null, electric: false }

describe('amountCentsFor (mirrors api/internal/rates/rates_test.go)', () => {
  it.each<[string, V, number, number]>([
    ['car 5CV first tier', car(5), 1000, 63600],
    ['car 5CV tier edge', car(5), 5000, 318000],
    ['car 5CV second tier', car(5), 10000, 496500],
    ['car 7CV+ third tier', car(11), 25000, 1175000],
    ['car 2CV uses ≤3CV row', car(2), 100, 5290],
    ['car electric +20%', car(4, true), 100, 7272],
    ['motorcycle 1-2CV', moto(1), 2000, 79000],
    ['motorcycle 3-5CV mid', moto(4), 4000, 148600],
    ['motorcycle >5CV', moto(8), 7000, 240100],
    ['moped', moped, 3500, 98750],
    ['no km', car(5), 0, 0],
  ])('%s', (_name, v, km, want) => {
    expect(amountCentsFor(b, v, km)).toBe(want)
  })

  it('switches tier just past each car boundary', () => {
    expect(amountCentsFor(b, car(5), 5001)).toBe(Math.round((5001 * 0.357 + 1395) * 100))
    expect(amountCentsFor(b, car(5), 20000)).toBe(Math.round((20000 * 0.357 + 1395) * 100))
    expect(amountCentsFor(b, car(5), 20001)).toBe(Math.round(20001 * 0.427 * 100))
  })

  it('switches tier at the two-wheel boundaries (3000 / 6000 km)', () => {
    expect(amountCentsFor(b, moto(4), 3000)).toBe(140400)
    expect(amountCentsFor(b, moto(4), 3001)).toBe(Math.round((3001 * 0.082 + 1158) * 100))
    expect(amountCentsFor(b, moped, 6000)).toBe(Math.round((6000 * 0.079 + 711) * 100))
    expect(amountCentsFor(b, moped, 6001)).toBe(Math.round(6001 * 0.198 * 100))
  })

  it('applies the electric increase on every tier', () => {
    expect(amountCentsFor(b, car(5, true), 10000)).toBe(Math.round(4965 * 1.2 * 100))
  })

  it('picks horsepower bands with open bounds', () => {
    expect(bandFor(b, car(1))?.maxHp).toBe(3)
    expect(bandFor(b, car(7))?.minHp).toBe(7)
    expect(bandFor(b, car(99))?.minHp).toBe(7)
    expect(bandFor(b, moto(2))?.maxHp).toBe(2)
    expect(bandFor(b, moto(5))?.minHp).toBe(3)
    expect(bandFor(b, moped)).toBe(b.byType.moped[0])
  })

  it('returns 0 for negative km', () => {
    expect(amountCentsFor(b, car(5), -10)).toBe(0)
  })
})

describe('billedKm', () => {
  it('doubles a round trip', () => {
    expect(billedKm(12.5, true)).toBe(25)
    expect(billedKm(12.5, false)).toBe(12.5)
  })
})

describe('tripPreviewCents', () => {
  it('is the marginal amount within a tier', () => {
    expect(tripPreviewCents(b, car(5), 1000, 100)).toBe(6360)
  })

  it('is amount(year + trip) − amount(year) across a tier boundary', () => {
    // 4900 → 5100 km: 318 000 − 311 640 is not 200 × 0.636.
    const before = amountCentsFor(b, car(5), 4900)
    const after = amountCentsFor(b, car(5), 5100)
    expect(before).toBe(311640)
    expect(after).toBe(Math.round((5100 * 0.357 + 1395) * 100))
    expect(tripPreviewCents(b, car(5), 4900, 200)).toBe(after - before)
    expect(tripPreviewCents(b, car(5), 4900, 200)).not.toBe(Math.round(200 * 0.636 * 100))
  })

  it('treats the first trip of the year as the full amount', () => {
    expect(tripPreviewCents(b, car(4, true), 0, 100)).toBe(7272)
  })
})
