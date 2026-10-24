import { createPinia, setActivePinia } from 'pinia'
import * as api from '@/api'
import { httpError, networkError, serverTrip, tripInput } from '@/test/api-mock'
import type { Coach, Trip, TripInput } from '@/types'
import {
  SUMMARY_REFRESH_DELAY_MS,
  useAuthStore,
  useSummaryStore,
  useTripsStore,
  useUiStore,
} from '.'
import { useWaiversStore } from './waivers'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

const tripsApi = vi.mocked(api.trips)

const coach = { id: 7, role: 'coach' } as Coach

async function setup() {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.token = 'jwt'
  auth.coach = coach
  const trips = useTripsStore()
  await trips.loadYear(2026)
  return trips
}

/** A promise you resolve by hand, to observe in-flight states. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  tripsApi.listByYear.mockResolvedValue([])
  tripsApi.newClientId.mockReturnValue('client-1')
  vi.mocked(api.summary.get).mockResolvedValue({} as never)
})

describe('trips store: online', () => {
  it('shows a create optimistically, then swaps in the server trip', async () => {
    const trips = await setup()
    const d = deferred<Trip>()
    tripsApi.create.mockReturnValue(d.promise)

    const pending = trips.create(tripInput)
    expect(trips.trips).toHaveLength(1)
    const temp = trips.trips[0]!
    expect(temp.id).toBeLessThan(0)
    expect(temp.billedKm).toBe(24)
    expect(trips.isPending(temp.id)).toBe(false) // in flight, not queued

    const saved = serverTrip({ ...tripInput, clientId: 'client-1' }, { id: 42 })
    d.resolve(saved)
    await expect(pending).resolves.toEqual(saved)
    expect(trips.trips.map((t) => t.id)).toEqual([42])
    expect(tripsApi.create).toHaveBeenCalledWith({ ...tripInput, clientId: 'client-1' })
  })

  it('rolls back and rethrows a 409 (locked year on the server)', async () => {
    const trips = await setup()
    tripsApi.create.mockRejectedValue(httpError(409, 'year 2026 is locked'))

    await expect(trips.create(tripInput)).rejects.toMatchObject({
      isConflict: true,
      message: 'year 2026 is locked',
    })
    expect(trips.trips).toHaveLength(0)
    expect(trips.pendingCount).toBe(0)
  })

  it('rolls back a rejected edit and a rejected delete', async () => {
    const existing = serverTrip(tripInput, { id: 5 })
    tripsApi.listByYear.mockResolvedValue([existing])
    const trips = await setup()

    tripsApi.update.mockRejectedValue(httpError(400, 'distanceKm must be > 0'))
    await expect(trips.update(5, { distanceKm: 0 })).rejects.toThrow('distanceKm')
    expect(trips.tripById(5)?.distanceKm).toBe(12)

    tripsApi.remove.mockRejectedValue(httpError(409, 'locked'))
    await expect(trips.remove(5)).rejects.toThrow('locked')
    expect(trips.tripById(5)).toBeDefined()
  })

  it('refuses mutations in a locked year without calling the API', async () => {
    const trips = await setup()
    useWaiversStore().items = [
      { year: 2025, km: 100, amount: 60, waivedAt: '2026-01-02T00:00:00Z', receipt: null },
    ]
    expect(trips.isYearLocked(2025)).toBe(true)
    expect(trips.isYearLocked(2026)).toBe(false)

    await expect(trips.create({ ...tripInput, date: '2025-06-01' })).rejects.toMatchObject({
      isConflict: true,
    })
    expect(tripsApi.create).not.toHaveBeenCalled()
    expect(trips.trips).toHaveLength(0)
  })

  it('refetches the summary (debounced) after mutations', async () => {
    vi.useFakeTimers()
    try {
      const trips = await setup()
      const summary = useSummaryStore()
      useUiStore().setYear(2026)
      const data = { year: 2026, totalAmount: 15.26 } as never
      vi.mocked(api.summary.get).mockResolvedValue(data)
      tripsApi.create.mockImplementation(async (input: TripInput) => serverTrip(input))

      await trips.create(tripInput)
      await trips.create({ ...tripInput, date: '2026-04-13' })
      expect(api.summary.get).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(SUMMARY_REFRESH_DELAY_MS)
      expect(api.summary.get).toHaveBeenCalledOnce()
      expect(api.summary.get).toHaveBeenCalledWith(2026)
      expect(summary.data).toEqual(data)
    } finally {
      vi.useRealTimers()
    }
  })

  it('undoCreate deletes the trip just created', async () => {
    const trips = await setup()
    tripsApi.create.mockResolvedValue(serverTrip(tripInput, { id: 9 }))
    tripsApi.remove.mockResolvedValue()
    const saved = await trips.create(tripInput)
    await trips.undoCreate(saved.id)
    expect(tripsApi.remove).toHaveBeenCalledWith(9)
    expect(trips.trips).toHaveLength(0)
  })
})

describe('trips store: offline queue', () => {
  it('queues a create on a network error and replays it with the same clientId', async () => {
    const trips = await setup()
    tripsApi.create.mockRejectedValueOnce(networkError())

    const local = await trips.create(tripInput)
    expect(local.id).toBeLessThan(0)
    expect(trips.isPending(local.id)).toBe(true)
    expect(trips.pendingCount).toBe(1)
    expect(trips.queue[0]).toMatchObject({ kind: 'create', input: { clientId: 'client-1' } })

    tripsApi.create.mockImplementation(async (input: TripInput) => serverTrip(input, { id: 77 }))
    const result = await trips.flushQueue()

    expect(result).toEqual({ sent: 1, dropped: 0, remaining: 0 })
    expect(tripsApi.create).toHaveBeenCalledTimes(2)
    expect(tripsApi.create.mock.calls[0]?.[0].clientId).toBe('client-1')
    expect(tripsApi.create.mock.calls[1]?.[0].clientId).toBe('client-1')
    expect(trips.trips.map((t) => t.id)).toEqual([77])
    expect(trips.isPending(77)).toBe(false)
    expect(trips.pendingCount).toBe(0)
  })

  it('stops the flush on a network error and keeps the order', async () => {
    const trips = await setup()
    tripsApi.create.mockRejectedValue(networkError())
    await trips.create(tripInput)
    await trips.create({ ...tripInput, destination: 'Bron' })
    tripsApi.create.mockClear()

    const result = await trips.flushQueue()
    expect(result).toEqual({ sent: 0, dropped: 0, remaining: 2 })
    expect(tripsApi.create).toHaveBeenCalledOnce()
    expect(tripsApi.create.mock.calls[0]?.[0].destination).toBe('Villeurbanne')
  })

  it('folds an edit into the queued create, and a delete cancels it', async () => {
    const trips = await setup()
    tripsApi.create.mockRejectedValue(networkError())
    const local = await trips.create(tripInput)

    const edited = await trips.update(local.id, { distanceKm: 20, roundTrip: false })
    expect(edited.billedKm).toBe(20)
    expect(trips.queue).toHaveLength(1)
    expect(trips.queue[0]).toMatchObject({ kind: 'create', input: { distanceKm: 20 } })
    expect(tripsApi.update).not.toHaveBeenCalled()

    await trips.remove(local.id)
    expect(trips.queue).toHaveLength(0)
    expect(trips.trips).toHaveLength(0)
    expect(tripsApi.remove).not.toHaveBeenCalled()
    expect(tripsApi.create).toHaveBeenCalledOnce() // only the first, failed attempt
  })

  it('sends the folded create once with the edited values', async () => {
    const trips = await setup()
    tripsApi.create.mockRejectedValueOnce(networkError())
    const local = await trips.create(tripInput)
    await trips.update(local.id, { destination: 'Bron' })

    tripsApi.create.mockImplementation(async (input: TripInput) => serverTrip(input, { id: 50 }))
    await trips.flushQueue()
    expect(tripsApi.create).toHaveBeenLastCalledWith({
      ...tripInput,
      destination: 'Bron',
      clientId: 'client-1',
    })
    expect(trips.tripById(50)?.destination).toBe('Bron')
  })

  it('queues edits and deletes of synced trips, merging edits', async () => {
    tripsApi.listByYear.mockResolvedValue([
      serverTrip(tripInput, { id: 5 }),
      serverTrip(tripInput, { id: 6 }),
    ])
    const trips = await setup()
    tripsApi.update.mockRejectedValue(networkError())
    tripsApi.remove.mockRejectedValue(networkError())

    await trips.update(5, { distanceKm: 30 })
    await trips.update(5, { purpose: 'Match' })
    await trips.remove(6)
    expect(trips.queue.map((e) => e.kind)).toEqual(['update', 'remove'])
    expect(trips.queue[0]).toMatchObject({ patch: { distanceKm: 30, purpose: 'Match' } })
    expect(trips.isPending(5)).toBe(true)
    expect(trips.tripById(5)?.billedKm).toBe(60)
    expect(trips.tripById(6)).toBeUndefined()

    tripsApi.update.mockImplementation(async (id, patch) =>
      serverTrip(tripInput, { id, ...patch, billedKm: 60 }),
    )
    tripsApi.remove.mockResolvedValue()
    await expect(trips.flushQueue()).resolves.toEqual({ sent: 2, dropped: 0, remaining: 0 })
    expect(tripsApi.update).toHaveBeenLastCalledWith(5, { distanceKm: 30, purpose: 'Match' })
    expect(tripsApi.remove).toHaveBeenLastCalledWith(6)
  })

  it('drops an entry the server rejects and notifies', async () => {
    const trips = await setup()
    tripsApi.create.mockRejectedValueOnce(networkError())
    await trips.create(tripInput)

    tripsApi.create.mockRejectedValueOnce(httpError(409, 'year 2026 is locked'))
    const result = await trips.flushQueue()
    expect(result).toEqual({ sent: 0, dropped: 1, remaining: 0 })
    expect(trips.trips).toHaveLength(0)
    expect(useUiStore().current?.message).toContain('year 2026 is locked')
  })

  it('runs a single flush when called concurrently', async () => {
    const trips = await setup()
    tripsApi.create.mockRejectedValue(networkError())
    await trips.create(tripInput)
    await trips.create({ ...tripInput, destination: 'Bron' })
    tripsApi.create.mockReset()
    tripsApi.create.mockImplementation(async (input: TripInput) => serverTrip(input))

    const [a, b] = await Promise.all([trips.flushQueue(), trips.flushQueue()])
    expect(a).toBe(b)
    expect(tripsApi.create).toHaveBeenCalledTimes(2)
    expect(new Set(trips.trips.map((t) => t.id)).size).toBe(2)
    expect(trips.trips.every((t) => t.id > 0)).toBe(true)
  })

  it('an edit made while the create is being flushed goes to the server id', async () => {
    const trips = await setup()
    tripsApi.create.mockRejectedValueOnce(networkError())
    const local = await trips.create(tripInput)
    const d = deferred<Trip>()
    tripsApi.create.mockReturnValueOnce(d.promise)

    const flush = trips.flushQueue()
    const edit = trips.update(local.id, { purpose: 'Match' })
    d.resolve(serverTrip({ ...tripInput, clientId: 'client-1' }, { id: 88 }))
    tripsApi.update.mockImplementation(async (id, patch) => serverTrip(tripInput, { id, ...patch }))
    await flush
    await edit
    expect(tripsApi.update).toHaveBeenCalledWith(88, { purpose: 'Match' })
    expect(trips.tripById(88)?.purpose).toBe('Match')
  })

  it('keeps queued trips visible after a reload of the year', async () => {
    const trips = await setup()
    tripsApi.create.mockRejectedValue(networkError())
    await trips.create(tripInput)
    tripsApi.listByYear.mockResolvedValue([serverTrip(tripInput, { id: 3, clientId: 'other' })])

    await trips.loadYear(2026)
    expect(trips.trips).toHaveLength(2)
    expect(trips.pendingCount).toBe(1)
  })
})

describe('trips store: getters', () => {
  it('groups by month, ranks places and finds the last trip', async () => {
    tripsApi.listByYear.mockResolvedValue([
      serverTrip(tripInput, {
        id: 1,
        date: '2026-03-02',
        destination: 'Bron',
        createdAt: '2026-03-02T10:00:00Z',
      }),
      serverTrip(tripInput, {
        id: 2,
        date: '2026-04-01',
        destination: 'Bron',
        createdAt: '2026-04-01T10:00:00Z',
      }),
      serverTrip(tripInput, {
        id: 3,
        date: '2026-04-05',
        destination: 'Vienne',
        vehicleId: 2,
        createdAt: '2026-04-05T10:00:00Z',
      }),
    ])
    const trips = await setup()

    expect(trips.groupedByMonth.map((g) => [g.key, g.trips.length, g.km])).toEqual([
      ['2026-04', 2, 48],
      ['2026-03', 1, 24],
    ])
    expect(trips.groupedByMonth[0]?.label).toBe('avril 2026')
    expect(trips.recentDestinations).toEqual(['Bron', 'Vienne'])
    expect(trips.recentOrigins).toEqual(['Lyon'])
    expect(trips.lastTrip?.id).toBe(3)
    expect(trips.kmByVehicle(2026)).toEqual({ 1: 48, 2: 24 })
  })
})
