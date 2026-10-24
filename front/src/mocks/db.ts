// In-memory store behind the MSW handlers, persisted to localStorage so the mock data
// survives page reloads. Bump SEED_VERSION (seed.ts) whenever the shape or the seed
// changes: an older snapshot is then dropped and the seed is loaded again.
import type { Coach, Trip, Vehicle } from '@/types'

import { SEED_VERSION, seedDb } from './seed'

export const DB_VERSION = SEED_VERSION
export const DB_STORAGE_KEY = `coach-km.mock-db.v${DB_VERSION}`

/** A coach row, with the password the mock login compares against. */
export interface MockUser extends Coach {
  password: string
}

export interface MockVehicle extends Vehicle {
  userId: number
}

export interface MockTrip extends Trip {
  userId: number
}

/** A waived year: its km and amount are frozen when the waiver is recorded. */
export interface MockWaiver {
  userId: number
  year: number
  km: number
  amountCents: number
  waivedAt: string
}

export interface MockReceipt {
  id: number
  /** Sequence number within the year; the receipt number is `<year>-<seq padded to 4>`. */
  seq: number
  year: number
  userId: number
  amountCents: number
  waivedAt: string
  issuedAt: string
  issuedBy: number
}

export interface MockDb {
  version: number
  users: MockUser[]
  vehicles: MockVehicle[]
  trips: MockTrip[]
  waivers: MockWaiver[]
  receipts: MockReceipt[]
}

let current: MockDb | null = null

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function load(): MockDb | null {
  try {
    const raw = storage()?.getItem(DB_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MockDb
    return parsed?.version === DB_VERSION ? parsed : null
  } catch {
    return null
  }
}

/** The store, loaded from localStorage on first use (or seeded). */
export function getDb(): MockDb {
  if (!current) {
    current = load() ?? seedDb()
    saveDb()
  }
  return current
}

/** Writes the store to localStorage. Call it after every mutation. */
export function saveDb(): void {
  if (!current) return
  try {
    storage()?.setItem(DB_STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Storage full or blocked: the data still lives in memory for this session.
  }
}

/** Drops every change and reloads the seed (tests call it in `beforeEach`). */
export function resetMockDb(): MockDb {
  current = seedDb()
  saveDb()
  return current
}

/** The next free id of a table. */
export function nextId(rows: readonly { id: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.id), 0) + 1
}

/** An RFC 3339 timestamp without milliseconds, like the Go API. */
export function nowTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** A shallow copy of `obj` without `key`. */
function without<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy: Partial<T> = { ...obj }
  delete copy[key]
  return copy as Omit<T, K>
}

/** The public shape of a user row (no password). */
export function toCoach(user: MockUser): Coach {
  const coach = without(user, 'password')
  return { ...coach, address: { ...coach.address } }
}

export function toVehicle(row: MockVehicle): Vehicle {
  return without(row, 'userId')
}

export function toTrip(row: MockTrip): Trip {
  return without(row, 'userId')
}
