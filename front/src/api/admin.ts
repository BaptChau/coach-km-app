// President-only endpoints (403 for other accounts).
import type { CoachYear, IssueReceiptInput, Receipt } from '@/types'

import { http } from './client'

/** `GET /admin/coaches?year=`: every coach with their year total and waiver. */
export async function coaches(year: number): Promise<CoachYear[]> {
  const { data } = await http.get<CoachYear[]>('/admin/coaches', { params: { year } })
  return data
}

/** `GET /admin/receipts?year=` */
export async function receipts(year: number): Promise<Receipt[]> {
  const { data } = await http.get<Receipt[]>('/admin/receipts', { params: { year } })
  return data
}

/**
 * `POST /admin/receipts { coachId, year }` → 201. 409 if the coach hasn't waived or the
 * receipt exists, 503 if the association isn't configured on the server.
 */
export async function issueReceipt(input: IssueReceiptInput): Promise<Receipt> {
  const { data } = await http.post<Receipt>('/admin/receipts', input)
  return data
}
