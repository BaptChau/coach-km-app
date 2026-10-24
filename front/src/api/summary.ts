import type { Summary } from '@/types'

import { http } from './client'

/** `GET /summary?year=`: the authoritative € totals (per vehicle, per month). */
export async function get(year: number): Promise<Summary> {
  const { data } = await http.get<Summary>('/summary', { params: { year } })
  return data
}
