// President-only: /admin/coaches, /admin/receipts (list, issue). 403 for other accounts.
import { http, HttpResponse } from 'msw'

import type { CoachYear } from '@/types'

import { getDb, nextId, nowTimestamp, saveDb, toCoach, type MockReceipt } from '../db'
import { summaryFor } from './report'
import { api, errorResponse, presidentOnly, readJson, yearParam } from './utils'
import { toReceipt, toWaiver } from './waivers'

export const adminHandlers = [
  http.get(
    api('/admin/coaches'),
    presidentOnly(({ request }) => {
      const year = yearParam(request)
      if (year === null) return errorResponse(400, 'invalid year')
      const db = getDb()
      const rows: CoachYear[] = [...db.users]
        .sort(
          (a, b) =>
            a.lastName.localeCompare(b.lastName, 'fr') ||
            a.firstName.localeCompare(b.firstName, 'fr') ||
            a.id - b.id,
        )
        .map((user) => {
          const summary = summaryFor(user, year)
          const waiver = db.waivers.find((w) => w.userId === user.id && w.year === year)
          return {
            coach: toCoach(user),
            totalKm: summary.totalKm,
            totalAmount: summary.totalAmount,
            waiver: waiver ? toWaiver(waiver) : null,
          }
        })
      return HttpResponse.json(rows)
    }),
  ),

  http.get(
    api('/admin/receipts'),
    presidentOnly(({ request }) => {
      const year = yearParam(request)
      if (year === null) return errorResponse(400, 'invalid year')
      return HttpResponse.json(
        getDb()
          .receipts.filter((r) => r.year === year)
          .sort((a, b) => a.seq - b.seq)
          .map(toReceipt),
      )
    }),
  ),

  http.post(
    api('/admin/receipts'),
    presidentOnly(async ({ request, user }) => {
      const body = await readJson(request, ['coachId', 'year'])
      if (body instanceof Response) return body
      const { coachId, year } = body
      if (typeof coachId !== 'number' || typeof year !== 'number') {
        return errorResponse(400, 'coachId and year are required')
      }
      const db = getDb()
      const waiver = db.waivers.find((w) => w.userId === coachId && w.year === year)
      if (!waiver) {
        return errorResponse(409, 'this coach has not waived reimbursement for this year')
      }
      if (db.receipts.some((r) => r.userId === coachId && r.year === year)) {
        return errorResponse(409, 'a receipt was already issued for this coach and year')
      }
      const seq = db.receipts.filter((r) => r.year === year).reduce((m, r) => Math.max(m, r.seq), 0)
      const receipt: MockReceipt = {
        id: nextId(db.receipts),
        seq: seq + 1,
        year,
        userId: coachId,
        amountCents: waiver.amountCents,
        waivedAt: waiver.waivedAt,
        issuedAt: nowTimestamp(),
        issuedBy: user.id,
      }
      db.receipts.push(receipt)
      saveDb()
      return HttpResponse.json(toReceipt(receipt), { status: 201 })
    }),
  ),
]
