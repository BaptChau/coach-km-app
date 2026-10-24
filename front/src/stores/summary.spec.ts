import { createPinia, setActivePinia } from 'pinia'
import * as api from '@/api'
import { httpError, networkError } from '@/test/api-mock'
import type { Summary } from '@/types'
import { SUMMARY_REFRESH_DELAY_MS, useSummaryStore, useUiStore } from '.'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

const summaryGet = vi.mocked(api.summary.get)

function summaryOf(year: number, totalAmount = 100): Summary {
  return { year, baremeSource: 'API', totalKm: 10, totalAmount, byMonth: [], byVehicle: [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.useRealTimers()
})

describe('summary store', () => {
  it('loads the selected year by default', async () => {
    useUiStore().setYear(2025)
    summaryGet.mockResolvedValue(summaryOf(2025))
    const summary = useSummaryStore()
    await expect(summary.load()).resolves.toEqual(summaryOf(2025))
    expect(summaryGet).toHaveBeenCalledWith(2025)
    expect(summary.loading).toBe(false)
  })

  it('keeps the cached data offline, and rethrows server errors', async () => {
    const summary = useSummaryStore()
    summaryGet.mockResolvedValueOnce(summaryOf(2026, 42))
    await summary.load(2026)

    summaryGet.mockRejectedValueOnce(networkError())
    await expect(summary.load(2026)).resolves.toEqual(summaryOf(2026, 42))
    expect(summary.data?.totalAmount).toBe(42)
    expect(summary.error?.isNetworkError).toBe(true)

    summaryGet.mockRejectedValueOnce(httpError(500, 'boom'))
    await expect(summary.load(2026)).rejects.toMatchObject({ status: 500 })
    expect(summary.data?.totalAmount).toBe(42)
    expect(summary.loading).toBe(false)

    summaryGet.mockResolvedValueOnce(summaryOf(2026, 43))
    await summary.load(2026)
    expect(summary.error).toBeNull()
  })

  it('ignores a slow answer for a year the user already left', async () => {
    const summary = useSummaryStore()
    let resolveOld!: (s: Summary) => void
    summaryGet.mockReturnValueOnce(new Promise((r) => (resolveOld = r)))
    summaryGet.mockResolvedValueOnce(summaryOf(2026))

    const old = summary.load(2025)
    await summary.load(2026)
    resolveOld(summaryOf(2025))
    await old
    expect(summary.data?.year).toBe(2026)
    expect(summary.loading).toBe(false)
  })

  it('collapses refresh requests and refetches the year on screen', async () => {
    vi.useFakeTimers()
    const summary = useSummaryStore()
    useUiStore().setYear(2026)
    summaryGet.mockResolvedValue(summaryOf(2025))
    await summary.load(2025)
    summaryGet.mockClear()

    summary.scheduleRefresh()
    await vi.advanceTimersByTimeAsync(SUMMARY_REFRESH_DELAY_MS - 1)
    summary.scheduleRefresh()
    await vi.advanceTimersByTimeAsync(SUMMARY_REFRESH_DELAY_MS - 1)
    expect(summaryGet).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(summaryGet).toHaveBeenCalledOnce()
    // The summary shown (2025), not the selected year.
    expect(summaryGet).toHaveBeenCalledWith(2025)
  })

  it('swallows a failed background refresh', async () => {
    vi.useFakeTimers()
    const summary = useSummaryStore()
    summaryGet.mockRejectedValue(httpError(500, 'boom'))
    summary.scheduleRefresh(10)
    await vi.advanceTimersByTimeAsync(10)
    expect(summaryGet).toHaveBeenCalledOnce()
    expect(summary.error?.status).toBe(500)
  })

  it('reset cancels a scheduled refresh and an in-flight load', async () => {
    vi.useFakeTimers()
    const summary = useSummaryStore()
    let resolve!: (s: Summary) => void
    summaryGet.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const pending = summary.load(2026)
    summary.scheduleRefresh()

    summary.reset()
    resolve(summaryOf(2026))
    await pending
    await vi.advanceTimersByTimeAsync(SUMMARY_REFRESH_DELAY_MS * 2)

    expect(summaryGet).toHaveBeenCalledOnce()
    expect(summary.data).toBeNull()
    expect(summary.loading).toBe(false)
  })
})
