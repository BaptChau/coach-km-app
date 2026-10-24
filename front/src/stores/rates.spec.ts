import { createPinia, setActivePinia } from 'pinia'
import * as api from '@/api'
import { FALLBACK_BAREME } from '@/config/rates'
import { networkError, serverTrip, tripInput, vehicle } from '@/test/api-mock'
import type { Coach, RatesResponse } from '@/types'
import { useAuthStore, useRatesStore, useTripsStore } from '.'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.token = 'jwt'
  auth.coach = { id: 7 } as Coach
})

describe('rates store', () => {
  it('caches /rates per year', async () => {
    const res: RatesResponse = { ...FALLBACK_BAREME, year: 2026, source: 'API' }
    vi.mocked(api.rates.get).mockResolvedValue(res)
    const rates = useRatesStore()
    await Promise.all([rates.load(2026), rates.load(2026)])
    await rates.load(2026)
    expect(api.rates.get).toHaveBeenCalledOnce()
    expect(rates.baremeFor(2026).source).toBe('API')
    expect(rates.isFallback(2026)).toBe(false)
  })

  it('falls back to the bundled barème on failure, and retries later', async () => {
    vi.mocked(api.rates.get).mockRejectedValueOnce(networkError())
    const rates = useRatesStore()
    await expect(rates.load(2026)).resolves.toBe(FALLBACK_BAREME)
    expect(rates.isFallback(2026)).toBe(true)

    vi.mocked(api.rates.get).mockResolvedValueOnce({
      ...FALLBACK_BAREME,
      year: 2026,
      source: 'API',
    })
    await rates.load(2026)
    expect(rates.isFallback(2026)).toBe(false)
    expect(api.rates.get).toHaveBeenCalledTimes(2)
  })

  it('previews a trip across the 5000 km tier boundary', async () => {
    // 4990 km already logged with the 5 CV car: amount(4990) = 4990 × 0.636 = 3173.64 €.
    vi.mocked(api.trips.listByYear).mockResolvedValue([
      serverTrip(tripInput, { id: 1, distanceKm: 4990, roundTrip: false, billedKm: 4990 }),
    ])
    const trips = useTripsStore()
    await trips.loadYear(2026)
    const rates = useRatesStore()

    // +20 km → 5010 km: 5010 × 0.357 + 1395 = 3183.57 €, i.e. +9.93 € (not 20 × 0.636).
    expect(rates.previewCents(vehicle, 20, null, 2026)).toBe(993)
    // Same trip inside the first tier, when editing trip 1 itself (its km excluded).
    expect(rates.previewCents(vehicle, 20, 1, 2026)).toBe(1272)
  })
})

describe('rates store: fallback edge cases', () => {
  beforeEach(() => {
    vi.mocked(api.rates.get).mockReset()
    vi.mocked(api.rates.get).mockRejectedValue(networkError())
  })

  it('previews with the fallback barème before any load', () => {
    const rates = useRatesStore()
    expect(rates.isFallback(2026)).toBe(true)
    expect(rates.baremeFor(2026)).toBe(FALLBACK_BAREME)
    // 100 km with the 5 CV car, first tier: 100 × 0.636 €.
    expect(rates.previewCents(vehicle, 100, null, 2026)).toBe(6360)
    expect(api.rates.get).not.toHaveBeenCalled()
  })

  it('shares one request between concurrent loads that fail', async () => {
    const rates = useRatesStore()
    const results = await Promise.all([rates.load(2026), rates.load(2026), rates.load(2026)])
    expect(results.every((r) => r === FALLBACK_BAREME)).toBe(true)
    expect(api.rates.get).toHaveBeenCalledOnce()
    expect(rates.fallbackYears).toEqual([2026])

    // A second failure does not list the year twice.
    await rates.load(2026)
    expect(api.rates.get).toHaveBeenCalledTimes(2)
    expect(rates.fallbackYears).toEqual([2026])
  })

  it('keeps each year apart and uses the API barème in previews once loaded', async () => {
    const car5 = FALLBACK_BAREME.byType.car[2]!
    const doubled: RatesResponse = {
      ...FALLBACK_BAREME,
      year: 2026,
      source: 'API',
      byType: {
        ...FALLBACK_BAREME.byType,
        car: FALLBACK_BAREME.byType.car.map((band) =>
          band === car5
            ? { ...band, tiers: band.tiers.map((t) => ({ ...t, coef: t.coef * 2 })) }
            : band,
        ),
      },
    }
    vi.mocked(api.rates.get).mockImplementation(async (year: number) => {
      if (year === 2026) return doubled
      throw networkError()
    })
    const rates = useRatesStore()
    await rates.load(2026)
    await rates.load(2025)

    expect(rates.isFallback(2026)).toBe(false)
    expect(rates.isFallback(2025)).toBe(true)
    expect(rates.previewCents(vehicle, 100, null, 2026)).toBe(12720)
    expect(rates.previewCents(vehicle, 100, null, 2025)).toBe(6360)
  })

  it('only subtracts the edited trip when it is this vehicle’s and this year’s', async () => {
    vi.mocked(api.trips.listByYear).mockResolvedValue([
      serverTrip(tripInput, { id: 1, distanceKm: 4990, roundTrip: false, billedKm: 4990 }),
      serverTrip(tripInput, { id: 2, vehicleId: 2, distanceKm: 50, billedKm: 100 }),
    ])
    await useTripsStore().loadYear(2026)
    const rates = useRatesStore()

    // Trip 2 belongs to another vehicle: the 4990 km of vehicle 1 still count.
    expect(rates.previewCents(vehicle, 20, 2, 2026)).toBe(993)
    // Unknown trip id: nothing subtracted either.
    expect(rates.previewCents(vehicle, 20, 999, 2026)).toBe(993)
    // Another year has no km for this vehicle: the full first-tier amount.
    expect(rates.previewCents(vehicle, 20, 1, 2025)).toBe(1272)
  })

  it('a year persisted as fallback is retried after a reload', async () => {
    const rates = useRatesStore()
    await rates.load(2026)
    expect(rates.isFallback(2026)).toBe(true)

    // Same state as rehydrated from storage, in a fresh pinia.
    const saved = { byYear: { ...rates.byYear }, fallbackYears: [...rates.fallbackYears] }
    setActivePinia(createPinia())
    const reloaded = useRatesStore()
    reloaded.$patch(saved)
    vi.mocked(api.rates.get).mockResolvedValueOnce({
      ...FALLBACK_BAREME,
      year: 2026,
      source: 'API',
    })
    await expect(reloaded.load(2026)).resolves.toMatchObject({ source: 'API' })
    expect(reloaded.fallbackYears).toEqual([])
  })
})
