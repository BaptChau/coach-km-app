import type { RatesResponse } from '@/types'

import { http } from './client'

/** `GET /rates?year=` (public): the barème in force for that year. */
export async function get(year: number): Promise<RatesResponse> {
  const { data } = await http.get<RatesResponse>('/rates', { params: { year } })
  return data
}
