// /trips (list by year, create with clientId dedupe, get, patch, delete), with the
// waived-year lock.
import { http, HttpResponse } from 'msw'

import { billedKm } from '@/domain'

import { getDb, nextId, nowTimestamp, saveDb, toTrip, type MockTrip } from '../db'
import { yearOf } from '../valuation'
import {
  api,
  authed,
  errorResponse,
  isString,
  noContent,
  pathId,
  readJson,
  yearParam,
} from './utils'

const PATCH_FIELDS = [
  'date',
  'origin',
  'destination',
  'purpose',
  'vehicleId',
  'distanceKm',
  'roundTrip',
] as const
const CREATE_FIELDS = ['clientId', ...PATCH_FIELDS] as const
const MAX_TEXT = 255
const MAX_DISTANCE = 100_000
const MAX_CLIENT_ID = 64

const LOCKED_MSG = "this year's reimbursement was waived; its trips can no longer change"
const BAD_VEHICLE = 'vehicleId must be one of your vehicles'

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Merges `body` onto `t` and validates it like the API. Returns an error message or ''. */
function apply(t: MockTrip, body: Record<string, unknown>): string {
  for (const k of ['date', 'origin', 'destination', 'purpose'] as const) {
    if (body[k] === undefined) continue
    if (!isString(body[k])) return `${k} must be a string`
    t[k] = body[k].trim()
  }
  if (body.vehicleId !== undefined) {
    if (typeof body.vehicleId !== 'number') return 'vehicleId is required'
    t.vehicleId = body.vehicleId
  }
  if (body.distanceKm !== undefined) {
    if (typeof body.distanceKm !== 'number') return 'distanceKm must be > 0 and <= 100000'
    t.distanceKm = body.distanceKm
  }
  if (body.roundTrip !== undefined) {
    if (typeof body.roundTrip !== 'boolean') return 'roundTrip must be a boolean'
    t.roundTrip = body.roundTrip
  }

  if (!isIsoDate(t.date)) return 'date must be YYYY-MM-DD'
  for (const k of ['origin', 'destination', 'purpose'] as const) {
    if (t[k] === '' || [...t[k]].length > MAX_TEXT) return `${k} is required (max 255 characters)`
  }
  if (!(t.vehicleId > 0)) return 'vehicleId is required'
  if (!(t.distanceKm > 0) || t.distanceKm > MAX_DISTANCE) {
    return 'distanceKm must be > 0 and <= 100000'
  }
  t.billedKm = billedKm(t.distanceKm, t.roundTrip)
  return ''
}

function isLocked(userId: number, date: string): boolean {
  const year = yearOf(date)
  return getDb().waivers.some((w) => w.userId === userId && w.year === year)
}

function ownsVehicle(userId: number, vehicleId: number): boolean {
  return getDb().vehicles.some((v) => v.id === vehicleId && v.userId === userId)
}

function ownTrip(userId: number, id: number | null): MockTrip | undefined {
  return getDb().trips.find((t) => t.id === id && t.userId === userId)
}

/** Newest first, like the API (date, then id). */
function newestFirst(a: MockTrip, b: MockTrip): number {
  return a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1
}

export const tripHandlers = [
  http.get(
    api('/trips'),
    authed(({ request, user }) => {
      const year = yearParam(request)
      if (year === null) return errorResponse(400, 'invalid year')
      const q = new URL(request.url).searchParams
      const limit = q.has('limit') ? Number(q.get('limit')) : 1000
      const offset = q.has('offset') ? Number(q.get('offset')) : 0
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        return errorResponse(400, 'limit must be between 1 and 1000')
      }
      if (!Number.isInteger(offset) || offset < 0) {
        return errorResponse(400, 'offset must be >= 0')
      }
      const rows = getDb()
        .trips.filter((t) => t.userId === user.id && yearOf(t.date) === year)
        .sort(newestFirst)
        .slice(offset, offset + limit)
      return HttpResponse.json(rows.map(toTrip))
    }),
  ),

  http.post(
    api('/trips'),
    authed(async ({ request, user }) => {
      const body = await readJson(request, CREATE_FIELDS)
      if (body instanceof Response) return body

      const db = getDb()
      const trip: MockTrip = {
        id: 0,
        userId: user.id,
        clientId: null,
        date: '',
        origin: '',
        destination: '',
        purpose: '',
        vehicleId: 0,
        distanceKm: 0,
        roundTrip: false,
        billedKm: 0,
        createdAt: '',
      }
      const msg = apply(trip, body)
      if (msg) return errorResponse(400, msg)

      if (body.clientId !== undefined && body.clientId !== null) {
        const id = isString(body.clientId) ? body.clientId.trim() : ''
        if (id === '' || id.length > MAX_CLIENT_ID) {
          return errorResponse(400, 'clientId must be 1-64 characters')
        }
        // A replayed offline request: answer with the stored trip, even if its year
        // has been locked since.
        const existing = db.trips.find((t) => t.userId === user.id && t.clientId === id)
        if (existing) return HttpResponse.json(toTrip(existing), { status: 200 })
        trip.clientId = id
      }

      if (isLocked(user.id, trip.date)) return errorResponse(409, LOCKED_MSG)
      if (!ownsVehicle(user.id, trip.vehicleId)) return errorResponse(400, BAD_VEHICLE)

      trip.id = nextId(db.trips)
      trip.createdAt = nowTimestamp()
      db.trips.push(trip)
      saveDb()
      return HttpResponse.json(toTrip(trip), { status: 201 })
    }),
  ),

  http.get(
    api('/trips/:id'),
    authed(({ params, user }) => {
      const trip = ownTrip(user.id, pathId(params))
      return trip ? HttpResponse.json(toTrip(trip)) : errorResponse(404, 'trip not found')
    }),
  ),

  http.patch(
    api('/trips/:id'),
    authed(async ({ request, params, user }) => {
      const raw = await readJson(request, CREATE_FIELDS)
      if (raw instanceof Response) return raw
      if (raw.clientId !== undefined) return errorResponse(400, "clientId can't be changed")
      const trip = ownTrip(user.id, pathId(params))
      if (!trip) return errorResponse(404, 'trip not found')

      const next = { ...trip }
      const msg = apply(next, raw)
      if (msg) return errorResponse(400, msg)
      // Locked when the trip is in a waived year, or would move into one.
      if (isLocked(user.id, trip.date) || isLocked(user.id, next.date)) {
        return errorResponse(409, LOCKED_MSG)
      }
      if (!ownsVehicle(user.id, next.vehicleId)) return errorResponse(400, BAD_VEHICLE)

      Object.assign(trip, next)
      saveDb()
      return HttpResponse.json(toTrip(trip))
    }),
  ),

  http.delete(
    api('/trips/:id'),
    authed(({ params, user }) => {
      const trip = ownTrip(user.id, pathId(params))
      if (!trip) return errorResponse(404, 'trip not found')
      if (isLocked(user.id, trip.date)) return errorResponse(409, LOCKED_MSG)
      const db = getDb()
      db.trips = db.trips.filter((t) => t.id !== trip.id)
      saveDb()
      return noContent()
    }),
  ),
]
