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
