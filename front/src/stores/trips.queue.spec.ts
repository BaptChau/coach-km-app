// The offline queue beyond the basics of trips.spec.ts: ordering across mixed mutations, a
// reload mid-queue, a 401 during the flush, the empty flush and the `online` event wiring.
import * as api from '@/api'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { useOnline } from '@/composables/useOnline'
import { httpError, networkError, serverTrip, tripInput } from '@/test/api-mock'
import type { Coach, Trip, TripInput, TripPatch } from '@/types'
import { useAuthStore, useSummaryStore, useTripsStore } from '.'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

const tripsApi = vi.mocked(api.trips)
const coach = { id: 7, role: 'coach' } as Coach

/** A pinia like the app's: persisted to localStorage. A new one = a page reload. */
function reloadPinia() {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return pinia
}

function signIn(user: Coach = coach) {
  const auth = useAuthStore()
  auth.token = `jwt-${user.id}`
  auth.coach = user
  return auth
}

/** Server trips 5, 6 and 7 in 2026. */
const SERVER_TRIPS = [5, 6, 7].map((id) =>
  serverTrip(tripInput, { id, destination: `Ville ${id}`, clientId: `server-${id}` }),
)

/** Records every request in order, and answers like the server. */
function recordingServer() {
  const log: string[] = []
  let nextId = 500
  tripsApi.create.mockImplementation(async (input: TripInput) => {
    log.push(`create ${input.destination}`)
    return serverTrip(input, { id: ++nextId })
  })
  tripsApi.update.mockImplementation(async (id: number, patch: TripPatch) => {
    log.push(`update ${id} ${JSON.stringify(patch)}`)
    const base = SERVER_TRIPS.find((t) => t.id === id) ?? serverTrip(tripInput, { id })
    const next = { ...base, ...patch } as Trip
    return { ...next, billedKm: next.roundTrip ? next.distanceKm * 2 : next.distanceKm }
  })
  tripsApi.remove.mockImplementation(async (id: number) => {
    log.push(`remove ${id}`)
  })
  return log
}

function goOffline() {
  tripsApi.create.mockRejectedValue(networkError())
  tripsApi.update.mockRejectedValue(networkError())
  tripsApi.remove.mockRejectedValue(networkError())
}

let clientSeq = 0

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  clientSeq = 0
  tripsApi.listByYear.mockResolvedValue(SERVER_TRIPS)
  tripsApi.newClientId.mockImplementation(() => `client-${++clientSeq}`)
  vi.mocked(api.summary.get).mockResolvedValue({} as never)
})

describe('offline queue: ordering', () => {
  it('replays mixed creates, edits and deletes of several trips in order', async () => {
    reloadPinia()
    signIn()
    const trips = useTripsStore()
    await trips.loadYear(2026)
    goOffline()

    const a = await trips.create({ ...tripInput, destination: 'A' })
    await trips.update(5, { purpose: 'Match' })
    const b = await trips.create({ ...tripInput, destination: 'B' })
    await trips.remove(6)
    await trips.update(a.id, { destination: 'A2' }) // folded into create A
    await trips.update(7, { distanceKm: 30 })
    await trips.remove(b.id) // cancels create B: never sent
    await trips.update(5, { distanceKm: 40 }) // merged into the first edit of 5
    await trips.update(7, { purpose: 'Stage' })
    await trips.remove(7) // replaces the queued edit of 7

    expect(trips.queue.map((e) => e.kind)).toEqual(['create', 'update', 'remove', 'remove'])
    expect(trips.pendingCount).toBe(4)
    expect(trips.trips.map((t) => t.destination).sort()).toEqual(['A2', 'Ville 5'])

    const log = recordingServer()
    await expect(trips.flushQueue()).resolves.toEqual({ sent: 4, dropped: 0, remaining: 0 })
    expect(log).toEqual([
      'create A2',
      'update 5 {"purpose":"Match","distanceKm":40}',
      'remove 6',
      'remove 7',
    ])
    expect(trips.trips.every((t) => t.id > 0)).toBe(true)
    expect(trips.trips.map((t) => t.destination).sort()).toEqual(['A2', 'Ville 5'])
    expect(trips.tripById(5)?.billedKm).toBe(80)
  })

  it('replays only the signed-in coach’s entries', async () => {
    reloadPinia()
    signIn({ id: 8, role: 'coach' } as Coach)
    const trips = useTripsStore()
    await trips.loadYear(2026)
    goOffline()
    await trips.create({ ...tripInput, destination: 'Autre coach' })
    useAuthStore().logout({ keepQueue: true })

    signIn()
    await trips.loadYear(2026)
    await trips.create({ ...tripInput, destination: 'Moi' })
    expect(trips.queue).toHaveLength(2)
    expect(trips.pendingCount).toBe(1)

    const log = recordingServer()
    await expect(trips.flushQueue()).resolves.toEqual({ sent: 1, dropped: 0, remaining: 0 })
    expect(log).toEqual(['create Moi'])
    expect(trips.queue.map((e) => e.coachId)).toEqual([8])
  })
})

describe('offline queue: reload mid-queue', () => {
  it('rehydrates the persisted queue into a fresh pinia, then flushes the rest', async () => {
    reloadPinia()
    signIn()
    let trips = useTripsStore()
    await trips.loadYear(2026)
    goOffline()
    await trips.create({ ...tripInput, destination: 'A' })
    await trips.create({ ...tripInput, destination: 'B' })
    await trips.update(5, { purpose: 'Match' })

    // The network comes back for one request only: A is sent, B fails.
    const log = recordingServer()
    tripsApi.create.mockImplementationOnce(async (input: TripInput) => {
      log.push(`create ${input.destination}`)
      return serverTrip(input, { id: 400 })
    })
    tripsApi.create.mockRejectedValueOnce(networkError())
    await expect(trips.flushQueue()).resolves.toEqual({ sent: 1, dropped: 0, remaining: 2 })
    expect(log).toEqual(['create A'])
    await nextTick()

    // Page reload: everything in memory is gone, localStorage is not.
    reloadPinia()
    expect(useAuthStore().coach?.id).toBe(7)
    trips = useTripsStore()
    expect(trips.queue.map((e) => e.kind)).toEqual(['create', 'update'])
    expect(trips.pendingCount).toBe(2)
    expect(trips.loadedYear).toBe(2026)
    const pendingB = trips.trips.find((t) => t.destination === 'B')!
    expect(pendingB.id).toBeLessThan(0)
    expect(trips.isPending(pendingB.id)).toBe(true)
    expect(trips.tripById(400)?.destination).toBe('A')

    // A new trip logged after the reload gets a fresh temporary id.
    tripsApi.create.mockRejectedValueOnce(networkError())
    const c = await trips.create({ ...tripInput, destination: 'C' })
    expect(c.id).toBeLessThan(pendingB.id)

    await expect(trips.flushQueue()).resolves.toEqual({ sent: 3, dropped: 0, remaining: 0 })
    expect(log).toEqual(['create A', 'create B', 'update 5 {"purpose":"Match"}', 'create C'])
    // B keeps the clientId it got before the reload (idempotent replay).
    expect(tripsApi.create.mock.calls.map(([input]) => input.clientId)).toContain('client-2')
    expect(trips.trips.every((t) => t.id > 0)).toBe(true)
    expect(trips.pendingCount).toBe(0)
  })
})

describe('offline queue: flush edge cases', () => {
  it('keeps the queue and ends the session on a 401 during the flush', async () => {
    reloadPinia()
    const auth = signIn()
    const trips = useTripsStore()
    await trips.loadYear(2026)
    goOffline()
    await trips.create({ ...tripInput, destination: 'A' })
    await trips.create({ ...tripInput, destination: 'B' })

    // Like the real client: a 401 calls the unauthorized handler (logout), then rejects.
    const onUnauthorized = vi.mocked(api.onUnauthorized).mock.calls.at(-1)?.[0]
    tripsApi.create.mockImplementation(async () => {
      onUnauthorized?.()
      throw httpError(401, 'missing or invalid token')
    })
    const result = await trips.flushQueue()

    expect(tripsApi.create).toHaveBeenCalledTimes(3) // 2 offline attempts + 1 in the flush
    expect(result).toEqual({ sent: 0, dropped: 0, remaining: 2 })
    expect(auth.isAuthenticated).toBe(false)
    expect(trips.items).toEqual([])
    expect(trips.queue.map((e) => [e.kind, e.coachId])).toEqual([
      ['create', 7],
      ['create', 7],
    ])
    expect(trips.syncing).toBe(false)

    // Signing in again replays both, in order.
    signIn()
    const log = recordingServer()
    await expect(trips.flushQueue()).resolves.toEqual({ sent: 2, dropped: 0, remaining: 0 })
    expect(log).toEqual(['create A', 'create B'])
  })

  it('makes no request and schedules no refresh for an empty queue', async () => {
    reloadPinia()
    signIn()
    const trips = useTripsStore()
    await trips.loadYear(2026)
    const refresh = vi.spyOn(useSummaryStore(), 'scheduleRefresh')
    vi.clearAllMocks()

    await expect(trips.flushQueue()).resolves.toEqual({ sent: 0, dropped: 0, remaining: 0 })
    expect(tripsApi.create).not.toHaveBeenCalled()
    expect(tripsApi.update).not.toHaveBeenCalled()
    expect(tripsApi.remove).not.toHaveBeenCalled()
    expect(tripsApi.listByYear).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(trips.syncing).toBe(false)
  })

  it('does not flush while signed out', async () => {
    reloadPinia()
    signIn()
    const trips = useTripsStore()
    goOffline()
    await trips.create(tripInput)
    useAuthStore().logout({ keepQueue: true })
    vi.clearAllMocks()

    await expect(trips.flushQueue()).resolves.toEqual({ sent: 0, dropped: 0, remaining: 0 })
    expect(tripsApi.create).not.toHaveBeenCalled()
    expect(trips.queue).toHaveLength(1)
  })

  it('a rejected edit is dropped, reported, and the year reloaded from the server', async () => {
    reloadPinia()
    signIn()
    const trips = useTripsStore()
    await trips.loadYear(2026)
    goOffline()
    await trips.update(5, { distanceKm: 99 })
    expect(trips.tripById(5)?.distanceKm).toBe(99)

    tripsApi.update.mockRejectedValue(httpError(404, 'trip not found'))
    tripsApi.listByYear.mockClear()
    await expect(trips.flushQueue()).resolves.toEqual({ sent: 0, dropped: 1, remaining: 0 })
    expect(tripsApi.listByYear).toHaveBeenCalledWith(2026)
    expect(trips.tripById(5)?.distanceKm).toBe(12)
  })
})

describe('offline queue: `online` event → flush (useOnline + real store)', () => {
  it('replays the queue when the browser comes back online', async () => {
    reloadPinia()
    signIn()
    const trips = useTripsStore()
    await trips.loadYear(2026)
    goOffline()
    await trips.create({ ...tripInput, destination: 'A' })
    await trips.remove(6)

    const Host = defineComponent({
      setup() {
        useOnline({ flushOnMount: false })
        return () => h('div')
      },
    })
    const wrapper = mount(Host)
    const log = recordingServer()

    window.dispatchEvent(new Event('offline'))
    await nextTick()
    expect(log).toEqual([])

    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(trips.pendingCount).toBe(0))
    expect(log).toEqual(['create A', 'remove 6'])
    expect(trips.trips.map((t) => t.destination).sort()).toEqual(['A', 'Ville 5', 'Ville 7'])
    wrapper.unmount()
  })
})
