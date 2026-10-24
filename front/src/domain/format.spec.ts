import { formatDate, formatEuros, formatKm, formatShortDate, vehicleLabel } from './format'

const NNBSP = ' ' // fr-FR thousands separator
const NBSP = ' ' // before € and units

describe('fr-FR formatters', () => {
  it('formats cents as euros', () => {
    expect(formatEuros(123456)).toBe(`1${NNBSP}234,56${NBSP}€`)
    expect(formatEuros(2067)).toBe(`20,67${NBSP}€`)
    expect(formatEuros(0)).toBe(`0,00${NBSP}€`)
  })

  it('formats kilometres', () => {
    expect(formatKm(12345.67)).toBe(`12${NNBSP}345,7${NBSP}km`)
    expect(formatKm(42)).toBe(`42${NBSP}km`)
  })

  it('formats dates without a timezone shift', () => {
    expect(formatDate('2026-04-12')).toBe('12/04/2026')
    expect(formatDate('2026-01-01')).toBe('01/01/2026')
    expect(formatShortDate('2026-04-11')).toBe('sam. 11/04')
    expect(formatShortDate('2026-04-12')).toBe('dim. 12/04')
  })

  it('labels a vehicle', () => {
    expect(vehicleLabel({ type: 'car', fiscalHorsepower: 5, electric: true })).toBe(
      `Voiture · 5${NBSP}CV · électrique`,
    )
    expect(vehicleLabel({ type: 'motorcycle', fiscalHorsepower: 3, electric: false })).toBe(
      `Moto · 3${NBSP}CV`,
    )
    expect(vehicleLabel({ type: 'moped', fiscalHorsepower: null, electric: false })).toBe(
      'Cyclomoteur',
    )
  })
})
