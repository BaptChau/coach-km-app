import type { Waiver } from '@/types'

import { http } from './client'
import { downloadFile, type Download } from './export'

/** `GET /waivers`: the coach's waived years. */
export async function list(): Promise<Waiver[]> {
  const { data } = await http.get<Waiver[]>('/waivers')
  return data
}

/**
 * `POST /waivers { year }` → 201. Freezes the year's amount and locks its trips.
 * 400 if the address is missing or there is no mileage, 409 if already waived.
 */
export async function create(year: number): Promise<Waiver> {
  const { data } = await http.post<Waiver>('/waivers', { year })
  return data
}

/** `DELETE /waivers/{year}` → 204 (unlocks the year). 409 once a receipt is issued. */
export async function remove(year: number): Promise<void> {
  await http.delete(`/waivers/${year}`)
}

/** `GET /receipts/{id}/pdf`: the Cerfa 11580 tax receipt. */
export function receiptPdf(id: number): Promise<Download> {
  return downloadFile(`/receipts/${id}/pdf`, `recu-fiscal-${id}.pdf`)
}
