import type { Vehicle, VehicleInput, VehiclePatch } from '@/types'

import { http } from './client'

/** `GET /vehicles` */
export async function list(): Promise<Vehicle[]> {
  const { data } = await http.get<Vehicle[]>('/vehicles')
  return data
}

/** `POST /vehicles` → 201 */
export async function create(input: VehicleInput): Promise<Vehicle> {
  const { data } = await http.post<Vehicle>('/vehicles', input)
  return data
}

/** `PATCH /vehicles/{id}`. 409 when re-rating a vehicle that has trips in a waived year. */
export async function update(id: number, patch: VehiclePatch): Promise<Vehicle> {
  const { data } = await http.patch<Vehicle>(`/vehicles/${id}`, patch)
  return data
}

/** `DELETE /vehicles/{id}` → 204. 409 while trips still use it. */
export async function remove(id: number): Promise<void> {
  await http.delete(`/vehicles/${id}`)
}
