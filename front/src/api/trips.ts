import type { PageParams, Trip, TripInput, TripPatch } from '@/types'

import { http } from './client'

/** A new client id for a trip create (a UUID v4). */
export function newClientId(): string {
  return crypto.randomUUID()
}

/** `GET /trips?year=&limit=&offset=` → the year's trips, newest first (limit 1000 by default). */
export async function listByYear(year: number, page: PageParams = {}): Promise<Trip[]> {
  const { data } = await http.get<Trip[]>('/trips', { params: { year, ...page } })
  return data
}

/** `GET /trips/{id}` */
export async function get(id: number): Promise<Trip> {
  const { data } = await http.get<Trip>(`/trips/${id}`)
  return data
}

/**
 * `POST /trips` → 201, or 200 with the stored trip when the `clientId` was already used.
 * Always sends a `clientId`: the caller's (the offline queue passes a stable one so replays
 * are idempotent) or a fresh UUID. 409 in a waived (locked) year.
 */
export async function create(input: TripInput): Promise<Trip> {
  const body: Required<TripInput> = { ...input, clientId: input.clientId || newClientId() }
  const { data } = await http.post<Trip>('/trips', body)
  return data
}

/** `PATCH /trips/{id}`. 409 in a waived (locked) year. */
export async function update(id: number, patch: TripPatch): Promise<Trip> {
  const { data } = await http.patch<Trip>(`/trips/${id}`, patch)
  return data
}

/** `DELETE /trips/{id}` → 204. 409 in a waived (locked) year. */
export async function remove(id: number): Promise<void> {
  await http.delete(`/trips/${id}`)
}
