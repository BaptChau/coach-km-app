// Trips of the selected year with optimistic UI and a persisted offline queue (issue #9).
//
// Every mutation is applied to `items` first, then sent:
// - success: the local item is replaced by the server's trip, `/summary` is refetched;
// - network error (or `navigator.onLine === false`): the mutation is queued (persisted) and
//   the item shows as pending; `flushQueue()` replays the queue later, in order;
// - any other `ApiRequestError` (400, 409 locked year…): the local change is rolled back
//   and the error is rethrown so the UI can show the server message.
//
// A trip created offline has a temporary negative id until the server answers. Its create
// keeps one `clientId`, so replays are deduplicated by the API. Edits and deletes of such a
// trip are folded into the queued create (or cancel it) without any request.
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ApiRequestError, isApiRequestError, trips as tripsApi } from '@/api'
import { billedKm } from '@/domain'
import type { Trip, TripInput, TripPatch } from '@/types'
import { useAuthStore } from './auth'
import { useSummaryStore } from './summary'
import { useUiStore } from './ui'
import { useVehiclesStore } from './vehicles'
import { useWaiversStore } from './waivers'

interface QueuedBase {
  /** Unique key of the queue entry. */
  key: string
  /** Owner of the entry: only that coach's session replays it. */
  coachId: number | null
  queuedAt: string
}

export interface QueuedCreate extends QueuedBase {
  kind: 'create'
  tempId: number
  input: TripInput & { clientId: string }
}

export interface QueuedUpdate extends QueuedBase {
  kind: 'update'
  tripId: number
  patch: TripPatch
}

export interface QueuedRemove extends QueuedBase {
  kind: 'remove'
  tripId: number
}

export type QueueEntry = QueuedCreate | QueuedUpdate | QueuedRemove

type NewEntry =
  | Omit<QueuedCreate, keyof QueuedBase>
  | Omit<QueuedUpdate, keyof QueuedBase>
  | Omit<QueuedRemove, keyof QueuedBase>

export interface FlushResult {
  /** Entries the server accepted. */
  sent: number
  /** Entries the server rejected (dropped, with a notification). */
  dropped: number
  /** Entries still queued (a network error stopped the flush). */
  remaining: number
}

export interface MonthGroup {
  /** `YYYY-MM` */
  key: string
  year: number
  /** 1..12 */
  month: number
  /** e.g. "avril 2026" */
  label: string
  km: number
  trips: Trip[]
}

/** The year of a `YYYY-MM-DD` date. */
export function yearOf(date: string): number {
  return Number(date.slice(0, 4))
}

/** Temporary ids (trips not yet stored by the server) are negative. */
export function isTempId(id: number): boolean {
  return id < 0
}

function lockedError(year: number): ApiRequestError {
  const message = `Année ${year} clôturée : vous avez renoncé au remboursement.`
  return new ApiRequestError('http', 409, message, message)
}

function isNetworkFailure(e: unknown): boolean {
  return isApiRequestError(e) && e.isNetworkError
}

function browserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function withPatch(trip: Trip, patch: TripPatch): Trip {
  const next = { ...trip, ...patch }
  return { ...next, billedKm: billedKm(next.distanceKm, next.roundTrip) }
}

function localTrip(id: number, input: TripInput & { clientId: string }, createdAt: string): Trip {
  return {
    id,
    clientId: input.clientId,
    date: input.date,
    origin: input.origin,
    destination: input.destination,
    purpose: input.purpose,
    vehicleId: input.vehicleId,
    distanceKm: input.distanceKm,
    roundTrip: input.roundTrip,
    billedKm: billedKm(input.distanceKm, input.roundTrip),
    createdAt,
  }
}

function newerFirst(a: Trip, b: Trip): number {
  return (
    b.date.localeCompare(a.date) ||
    b.createdAt.localeCompare(a.createdAt) ||
    Math.abs(b.id) - Math.abs(a.id)
  )
}

const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })

/** Places, most frequent first (ties: most recent first), case-insensitive, at most `limit`. */
function frequentPlaces(trips: Trip[], pick: (t: Trip) => string, limit = 20): string[] {
  const stats = new Map<string, { label: string; count: number; last: string }>()
  for (const t of trips) {
    const label = pick(t).trim()
    if (!label) continue
    const key = label.toLocaleLowerCase('fr-FR')
    const s = stats.get(key)
    if (!s) stats.set(key, { label, count: 1, last: t.createdAt })
    else {
      s.count++
      if (t.createdAt > s.last) {
        s.last = t.createdAt
        s.label = label
      }
    }
  }
  return [...stats.values()]
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .slice(0, limit)
    .map((s) => s.label)
}

let entrySeq = 0

export const useTripsStore = defineStore(
  'trips',
  () => {
    /** The year `items` holds (null before the first load). */
    const loadedYear = ref<number | null>(null)
    /** Trips of `loadedYear`, server ones plus optimistic/pending ones. Unordered: use `trips`. */
    const items = ref<Trip[]>([])
    /** Offline queue, persisted, replayed in order by `flushQueue`. */
    const queue = ref<QueueEntry[]>([])
    const loading = ref(false)
    const error = ref<ApiRequestError | null>(null)
    /** True while `flushQueue` runs. */
    const syncing = ref(false)

    // In-memory bookkeeping (not persisted).
    /** Creates being sent (online create or flush), by temporary id. */
    const inflight = new Map<number, Promise<void>>()
    /** Temporary id → server id, once a create succeeded. */
    const idMap = new Map<number, number>()
    let flushing: Promise<FlushResult> | null = null
    /** Key of the queue entry `flushQueue` is sending (never folded into). */
    let sendingKey: string | null = null
    let loadSeq = 0

    // --- helpers ---------------------------------------------------------------------------

    function coachId(): number | null {
      return useAuthStore().coach?.id ?? null
    }

    const myQueue = computed(() => queue.value.filter((e) => e.coachId === coachId()))

    function enqueue(entry: NewEntry): void {
      queue.value.push({
        ...entry,
        key: `${Date.now().toString(36)}-${++entrySeq}`,
        coachId: coachId(),
        queuedAt: new Date().toISOString(),
      } as QueueEntry)
    }

    function dropEntry(key: string): void {
      queue.value = queue.value.filter((e) => e.key !== key)
    }

    function nextTempId(): number {
      let min = 0
      for (const t of items.value) min = Math.min(min, t.id)
      for (const e of queue.value) if (e.kind === 'create') min = Math.min(min, e.tempId)
      for (const id of inflight.keys()) min = Math.min(min, id)
      return min - 1
    }

    function findItem(id: number): Trip | undefined {
      return items.value.find((t) => t.id === id)
    }

    /** Puts `trip` in place of `oldId` (or adds it) when it belongs to the loaded year. */
    function putItem(oldId: number, trip: Trip): void {
      const index = items.value.findIndex((t) => t.id === oldId)
      const shown = yearOf(trip.date) === loadedYear.value
      if (index >= 0) {
        if (shown) items.value.splice(index, 1, trip)
        else items.value.splice(index, 1)
      } else if (shown) {
        items.value.push(trip)
      }
    }

    function removeItem(id: number): Trip | undefined {
      const index = items.value.findIndex((t) => t.id === id)
      if (index < 0) return undefined
      return items.value.splice(index, 1)[0]
    }

    function assertUnlocked(year: number): void {
      if (useWaiversStore().isLocked(year)) throw lockedError(year)
    }

    function serverChanged(): void {
      useSummaryStore().scheduleRefresh()
    }

    /** A rejected mutation may mean the year got locked elsewhere: refresh the waivers. */
    function onRejected(e: unknown): void {
      if (isApiRequestError(e) && e.isConflict)
        useWaiversStore()
          .load()
          .catch(() => {})
    }

    type Target =
      { kind: 'server'; id: number } | { kind: 'queued'; entry: QueuedCreate } | { kind: 'gone' }

    /**
     * Where a trip id lives now: on the server, only in the queue, or nowhere. Waits for a
     * create of that trip being sent. Callers act synchronously on the result.
     */
    async function resolveTarget(id: number): Promise<Target> {
      if (!isTempId(id)) return { kind: 'server', id }
      for (;;) {
        const running = inflight.get(id)
        if (!running) break
        await running
      }
      return resolveNow(id)
    }

    function resolveNow(id: number): Target {
      if (!isTempId(id)) return { kind: 'server', id }
      if (inflight.has(id)) return { kind: 'gone' }
      const mapped = idMap.get(id)
      if (mapped != null) return { kind: 'server', id: mapped }
      const entry = queue.value.find(
        (e): e is QueuedCreate => e.kind === 'create' && e.tempId === id,
      )
      return entry ? { kind: 'queued', entry } : { kind: 'gone' }
    }

    function enqueueUpdate(tripId: number, patch: TripPatch): void {
      const existing = queue.value.find(
        (e): e is QueuedUpdate =>
          e.kind === 'update' && e.tripId === tripId && e.coachId === coachId(),
      )
      if (existing && existing.key !== sendingKey) existing.patch = { ...existing.patch, ...patch }
      else enqueue({ kind: 'update', tripId, patch: { ...patch } })
    }

    function enqueueRemove(tripId: number): void {
      queue.value = queue.value.filter(
        (e) => !(e.kind === 'update' && e.tripId === tripId && e.key !== sendingKey),
      )
      enqueue({ kind: 'remove', tripId })
    }

    /** Applies this coach's queued mutations for `year` on top of a server list. */
    function overlay(list: Trip[], year: number): Trip[] {
      let result = list.slice()
      for (const e of myQueue.value) {
        if (e.kind === 'create') {
          const dup = result.some((t) => t.clientId === e.input.clientId)
          if (!dup && yearOf(e.input.date) === year) {
            result.push(localTrip(e.tempId, e.input, e.queuedAt))
          }
        } else if (e.kind === 'update') {
          result = result
            .map((t) => (t.id === e.tripId ? withPatch(t, e.patch) : t))
            .filter((t) => yearOf(t.date) === year)
        } else {
          result = result.filter((t) => t.id !== e.tripId)
        }
      }
      return result
    }

    // --- getters ---------------------------------------------------------------------------

    /** The loaded year's trips, newest first. */
    const trips = computed(() => items.value.slice().sort(newerFirst))

    const groupedByMonth = computed<MonthGroup[]>(() => {
      const groups: MonthGroup[] = []
      for (const t of trips.value) {
        const key = t.date.slice(0, 7)
        let group = groups[groups.length - 1]
        if (!group || group.key !== key) {
          const year = yearOf(t.date)
          const month = Number(t.date.slice(5, 7))
          group = {
            key,
            year,
            month,
            label: monthFormat.format(new Date(year, month - 1, 1)),
            km: 0,
            trips: [],
          }
          groups.push(group)
        }
        group.trips.push(t)
        group.km += t.billedKm
      }
      return groups
    })

    const recentDestinations = computed(() => frequentPlaces(items.value, (t) => t.destination))
    const recentOrigins = computed(() => frequentPlaces(items.value, (t) => t.origin))

    /** The last trip logged (by creation time), for the form's smart defaults. */
    const lastTrip = computed<Trip | null>(() => {
      let last: Trip | null = null
      for (const t of items.value) {
        if (!last || t.createdAt > last.createdAt) last = t
      }
      return last
    })

    const pendingIds = computed(() => {
      const ids = new Set<number>()
      for (const e of myQueue.value) ids.add(e.kind === 'create' ? e.tempId : e.tripId)
      return ids
    })

    /** Number of mutations waiting for the network. */
    const pendingCount = computed(() => myQueue.value.length)

    function isPending(tripId: number): boolean {
      return pendingIds.value.has(tripId)
    }

    function tripById(id: number): Trip | undefined {
      return findItem(id) ?? (isTempId(id) ? findItem(idMap.get(id) ?? 0) : undefined)
    }

    /** Billed km per vehicle id in `year` (from the loaded trips, pending ones included). */
    function kmByVehicle(year: number): Record<number, number> {
      const km: Record<number, number> = {}
      for (const t of items.value) {
        if (yearOf(t.date) === year) km[t.vehicleId] = (km[t.vehicleId] ?? 0) + t.billedKm
      }
      return km
    }

    /** A waived year: its trips are read-only. */
    function isYearLocked(year: number): boolean {
      return useWaiversStore().isLocked(year)
    }

    // --- actions ---------------------------------------------------------------------------

    /** Loads a year's trips, with the queued mutations applied. Offline, keeps the cache. */
    async function loadYear(year: number = useUiStore().year): Promise<Trip[]> {
      const ticket = ++loadSeq
      loading.value = true
      error.value = null
      try {
        const list = await tripsApi.listByYear(year)
        if (ticket === loadSeq) {
          items.value = overlay(list, year)
          loadedYear.value = year
        }
      } catch (e) {
        if (ticket !== loadSeq) return trips.value
        if (isApiRequestError(e)) error.value = e
        if (loadedYear.value !== year) {
          items.value = overlay([], year)
          loadedYear.value = year
        }
        if (!isNetworkFailure(e)) throw e
      } finally {
        if (ticket === loadSeq) loading.value = false
      }
      return trips.value
    }

    /**
     * Logs a trip. Resolves with the server's trip, or with the local pending trip (negative
     * id) when offline. Rejects (after rollback) when the server refuses it.
     */
    async function create(input: TripInput): Promise<Trip> {
      assertUnlocked(yearOf(input.date))
      const body = { ...input, clientId: input.clientId || tripsApi.newClientId() }
      const tempId = nextTempId()
      const local = localTrip(tempId, body, new Date().toISOString())
      putItem(tempId, local)
      useVehiclesStore().markUsed(input.vehicleId)

      if (browserOffline()) {
        enqueue({ kind: 'create', tempId, input: body })
        return local
      }

      let release = (): void => {}
      inflight.set(tempId, new Promise<void>((r) => (release = r)))
      try {
        const saved = await tripsApi.create(body)
        idMap.set(tempId, saved.id)
        putItem(tempId, saved)
        serverChanged()
        return saved
      } catch (e) {
        if (isNetworkFailure(e)) {
          enqueue({ kind: 'create', tempId, input: body })
          return findItem(tempId) ?? local
        }
        removeItem(tempId)
        onRejected(e)
        throw e
      } finally {
        inflight.delete(tempId)
        release()
      }
    }

    /** Edits a trip (optimistic). A not-yet-synced trip's edit is folded into its create. */
    async function update(id: number, patch: TripPatch): Promise<Trip> {
      const current = findItem(id)
      if (current) assertUnlocked(yearOf(current.date))
      if (patch.date) assertUnlocked(yearOf(patch.date))

      await resolveTarget(id)
      // Re-resolved synchronously: a flush may have started while awaiting.
      const target = inflight.has(id) ? await resolveTarget(id) : resolveNow(id)
      if (target.kind === 'gone') {
        throw new ApiRequestError('http', 404, 'Trajet introuvable', null)
      }
      if (target.kind === 'queued') {
        const entry = target.entry
        entry.input = { ...entry.input, ...patch }
        const base = findItem(id) ?? localTrip(id, entry.input, entry.queuedAt)
        const next = withPatch(base, patch)
        putItem(id, next)
        return next
      }

      const serverId = target.id
      const snapshot = findItem(serverId)
      const optimistic = snapshot ? withPatch(snapshot, patch) : undefined
      if (optimistic) putItem(serverId, optimistic)

      // Without a local copy there is nothing to show as pending: no queueing then.
      if (optimistic && browserOffline()) {
        enqueueUpdate(serverId, patch)
        return optimistic
      }
      try {
        const saved = await tripsApi.update(serverId, patch)
        putItem(serverId, saved)
        serverChanged()
        return saved
      } catch (e) {
        if (optimistic && isNetworkFailure(e)) {
          enqueueUpdate(serverId, patch)
          return optimistic
        }
        if (snapshot) putItem(serverId, snapshot)
        onRejected(e)
        throw e
      }
    }

    /** Deletes a trip (optimistic). A not-yet-synced trip's queued create is cancelled. */
    async function remove(id: number): Promise<void> {
      const current = findItem(id)
      if (current) assertUnlocked(yearOf(current.date))

      await resolveTarget(id)
      const target = inflight.has(id) ? await resolveTarget(id) : resolveNow(id)
      if (target.kind === 'gone') {
        removeItem(id)
        return
      }
      if (target.kind === 'queued') {
        dropEntry(target.entry.key)
        removeItem(id)
        return
      }

      const serverId = target.id
      const snapshot = removeItem(serverId)
      if (browserOffline()) {
        enqueueRemove(serverId)
        return
      }
      try {
        await tripsApi.remove(serverId)
        serverChanged()
      } catch (e) {
        if (isNetworkFailure(e)) {
          enqueueRemove(serverId)
          return
        }
        if (isApiRequestError(e) && e.isNotFound) return
        if (snapshot) putItem(serverId, snapshot)
        onRejected(e)
        throw e
      }
    }

    /** The "Annuler" action of the "Trajet enregistré" snackbar. */
    function undoCreate(id: number): Promise<void> {
      return remove(id)
    }

    async function send(entry: QueueEntry): Promise<void> {
      if (entry.kind === 'create') {
        const saved = await tripsApi.create(entry.input)
        dropEntry(entry.key)
        idMap.set(entry.tempId, saved.id)
        for (const e of queue.value) {
          if (e.kind !== 'create' && e.tripId === entry.tempId) e.tripId = saved.id
        }
        putItem(entry.tempId, saved)
      } else if (entry.kind === 'update') {
        const saved = await tripsApi.update(entry.tripId, entry.patch)
        dropEntry(entry.key)
        // Re-apply edits queued meanwhile for the same trip.
        const later = queue.value.find(
          (e): e is QueuedUpdate => e.kind === 'update' && e.tripId === entry.tripId,
        )
        putItem(entry.tripId, later ? withPatch(saved, later.patch) : saved)
      } else {
        try {
          await tripsApi.remove(entry.tripId)
        } catch (e) {
          if (!(isApiRequestError(e) && e.isNotFound)) throw e
        }
        dropEntry(entry.key)
      }
    }

    async function runFlush(): Promise<FlushResult> {
      const owner = coachId()
      let sent = 0
      let dropped = 0
      let reload = false
      syncing.value = true
      try {
        for (;;) {
          const entry = queue.value.find((e) => e.coachId === owner)
          if (!entry || !useAuthStore().isAuthenticated) break
          sendingKey = entry.key
          let release = (): void => {}
          if (entry.kind === 'create') {
            inflight.set(entry.tempId, new Promise<void>((r) => (release = r)))
          }
          try {
            await send(entry)
            sent++
          } catch (e) {
            // No answer, expired session or unknown failure: keep the entry and stop.
            if (!isApiRequestError(e) || e.isNetworkError || e.isUnauthorized) break
            dropEntry(entry.key)
            dropped++
            if (entry.kind === 'create') removeItem(entry.tempId)
            else reload = true
            onRejected(e)
            const what =
              entry.kind === 'create'
                ? `Le trajet du ${entry.input.date} vers ${entry.input.destination}`
                : entry.kind === 'update'
                  ? 'Une modification de trajet'
                  : 'Une suppression de trajet'
            useUiStore().notify(`${what} n'a pas pu être synchronisé : ${e.message}`, {
              color: 'error',
              timeout: -1,
            })
          } finally {
            sendingKey = null
            if (entry.kind === 'create') inflight.delete(entry.tempId)
            release()
          }
        }
      } finally {
        syncing.value = false
      }
      if (sent || dropped) serverChanged()
      if (reload && loadedYear.value != null) await loadYear(loadedYear.value).catch(() => {})
      // Counted for the flush's owner: a 401 may have ended the session meanwhile.
      return { sent, dropped, remaining: queue.value.filter((e) => e.coachId === owner).length }
    }

    /**
     * Replays this coach's queue in order. Stops at the first network error; drops (and
     * reports) what the server rejects. Concurrent calls share the same run.
     */
    function flushQueue(): Promise<FlushResult> {
      if (!flushing) flushing = runFlush().finally(() => (flushing = null))
      return flushing
    }

    /** Clears the loaded trips (logout). The queue is kept: see `clearQueue`. */
    function reset(): void {
      loadSeq++
      items.value = []
      loadedYear.value = null
      loading.value = false
      error.value = null
      idMap.clear()
    }

    /** Drops a coach's queued mutations (default: the current coach's). */
    function clearQueue(owner: number | null = coachId()): void {
      queue.value = queue.value.filter((e) => e.coachId !== owner)
    }

    return {
      loadedYear,
      items,
      queue,
      loading,
      error,
      syncing,
      trips,
      groupedByMonth,
      recentDestinations,
      recentOrigins,
      lastTrip,
      pendingCount,
      isPending,
      tripById,
      kmByVehicle,
      isYearLocked,
      loadYear,
      create,
      update,
      remove,
      undoCreate,
      flushQueue,
      reset,
      clearQueue,
    }
  },
  { persist: { key: 'coach-km:trips', pick: ['queue', 'items', 'loadedYear'] } },
)
