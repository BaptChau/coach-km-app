// /vehicles (list, create, patch, delete).
import { http, HttpResponse } from 'msw'

import type { VehicleType } from '@/types'

import { getDb, nextId, nowTimestamp, saveDb, toVehicle, type MockVehicle } from '../db'
import { yearOf } from '../valuation'
import { api, authed, errorResponse, isString, noContent, pathId, readJson } from './utils'

const FIELDS = ['label', 'type', 'fiscalHorsepower', 'electric'] as const
const TYPES: readonly VehicleType[] = ['car', 'motorcycle', 'moped']

/** Merges `body` onto `v` and validates it like the API. Returns an error message or ''. */
function apply(v: MockVehicle, body: Record<string, unknown>): string {
  if (body.label !== undefined) {
    if (!isString(body.label)) return 'label is required (max 100 characters)'
    v.label = body.label.trim()
  }
  if (body.type !== undefined) v.type = body.type as VehicleType
  if (body.fiscalHorsepower !== undefined) {
    v.fiscalHorsepower = body.fiscalHorsepower as number | null
  }
  if (body.electric !== undefined) {
    if (typeof body.electric !== 'boolean') return 'electric must be a boolean'
    v.electric = body.electric
  }
  if (v.label.length < 1 || v.label.length > 100) return 'label is required (max 100 characters)'
  if (!TYPES.includes(v.type)) return 'type must be "car", "motorcycle" or "moped"'
  if (v.type === 'moped') {
    v.fiscalHorsepower = null // the moped barème has no horsepower bands
  } else {
    const hp = v.fiscalHorsepower
    if (typeof hp !== 'number' || !Number.isInteger(hp) || hp < 1 || hp > 99) {
      return 'fiscalHorsepower (CV) is required for a car or motorcycle'
    }
  }
  return ''
}

function ownVehicle(userId: number, id: number | null): MockVehicle | undefined {
  return getDb().vehicles.find((v) => v.id === id && v.userId === userId)
}

export const vehicleHandlers = [
  http.get(
    api('/vehicles'),
    authed(({ user }) =>
      HttpResponse.json(
        getDb()
          .vehicles.filter((v) => v.userId === user.id)
          .map(toVehicle),
      ),
    ),
  ),

  http.post(
    api('/vehicles'),
    authed(async ({ request, user }) => {
      const body = await readJson(request, FIELDS)
      if (body instanceof Response) return body
      const db = getDb()
      const vehicle: MockVehicle = {
        id: nextId(db.vehicles),
        userId: user.id,
        label: '',
        type: 'car',
        fiscalHorsepower: null,
        electric: false,
        createdAt: nowTimestamp(),
      }
      if (body.type === undefined)
        return errorResponse(400, 'type must be "car", "motorcycle" or "moped"')
      const msg = apply(vehicle, body)
      if (msg) return errorResponse(400, msg)
      db.vehicles.push(vehicle)
      saveDb()
      return HttpResponse.json(toVehicle(vehicle), { status: 201 })
    }),
  ),

  http.patch(
    api('/vehicles/:id'),
    authed(async ({ request, params, user }) => {
      const body = await readJson(request, FIELDS)
      if (body instanceof Response) return body
      const vehicle = ownVehicle(user.id, pathId(params))
      if (!vehicle) return errorResponse(404, 'vehicle not found')

      const next = { ...vehicle }
      const msg = apply(next, body)
      if (msg) return errorResponse(400, msg)

      const db = getDb()
      const rerated =
        next.type !== vehicle.type ||
        next.fiscalHorsepower !== vehicle.fiscalHorsepower ||
        next.electric !== vehicle.electric
      const waivedYears = new Set(db.waivers.filter((w) => w.userId === user.id).map((w) => w.year))
      const usedInWaivedYear = db.trips.some(
        (t) => t.vehicleId === vehicle.id && waivedYears.has(yearOf(t.date)),
      )
      if (rerated && usedInWaivedYear) {
        return errorResponse(
          409,
          'vehicle is used in a year whose reimbursement was waived; only its label can change',
        )
      }
      Object.assign(vehicle, next)
      saveDb()
      return HttpResponse.json(toVehicle(vehicle))
    }),
  ),

  http.delete(
    api('/vehicles/:id'),
    authed(({ params, user }) => {
      const vehicle = ownVehicle(user.id, pathId(params))
      if (!vehicle) return errorResponse(404, 'vehicle not found')
      const db = getDb()
      if (db.trips.some((t) => t.vehicleId === vehicle.id)) {
        return errorResponse(409, 'vehicle is used by trips; delete or reassign them first')
      }
      db.vehicles = db.vehicles.filter((v) => v.id !== vehicle.id)
      saveDb()
      return noContent()
    }),
  ),
]
