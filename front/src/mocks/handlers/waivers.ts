// Abandon de frais, coach side: /waivers (list, create, delete) and /receipts/{id}/pdf.
import { http, HttpResponse } from 'msw'

import type { Receipt, Waiver } from '@/types'

import { getDb, nowTimestamp, saveDb, type MockReceipt, type MockWaiver } from '../db'
import { attachment, frNumber, minimalPdf } from '../files'
import { centsToEuros, roundKm, valueYear } from '../valuation'
import { api, authed, errorResponse, noContent, pathId, readJson } from './utils'

export function receiptNumber(r: Pick<MockReceipt, 'year' | 'seq'>): string {
  return `${r.year}-${String(r.seq).padStart(4, '0')}`
}

export function toReceipt(r: MockReceipt): Receipt {
  return {
    id: r.id,
    number: receiptNumber(r),
    year: r.year,
    coachId: r.userId,
    amount: centsToEuros(r.amountCents),
    waivedAt: r.waivedAt,
    issuedAt: r.issuedAt,
    issuedBy: r.issuedBy,
  }
}

export function toWaiver(w: MockWaiver): Waiver {
  const receipt = getDb().receipts.find((r) => r.userId === w.userId && r.year === w.year)
  return {
    year: w.year,
    km: roundKm(w.km),
    amount: centsToEuros(w.amountCents),
    waivedAt: w.waivedAt,
    receipt: receipt ? toReceipt(receipt) : null,
  }
}

function receiptPdf(r: MockReceipt): Uint8Array {
  const coach = getDb().users.find((u) => u.id === r.userId)
  const name = coach ? `${coach.firstName} ${coach.lastName}` : `coach ${r.userId}`
  const address = coach
    ? `${coach.address.line}, ${coach.address.postalCode} ${coach.address.city}`
    : ''
  return minimalPdf([
    `Recu au titre des dons n° ${receiptNumber(r)}`,
    'Cerfa n° 11580*05 - articles 200, 238 bis et 978 du CGI',
    `Donateur : ${name}`,
    address,
    `Montant : ${frNumber(centsToEuros(r.amountCents))} EUR - Forme : Autres - Nature : Numeraire`,
    `Abandon de frais kilometriques de l'annee ${r.year}`,
    '(document de demonstration genere par les mocks)',
  ])
}

export const waiverHandlers = [
  http.get(
    api('/waivers'),
    authed(({ user }) =>
      HttpResponse.json(
        getDb()
          .waivers.filter((w) => w.userId === user.id)
          .sort((a, b) => b.year - a.year)
          .map(toWaiver),
      ),
    ),
  ),

  http.post(
    api('/waivers'),
    authed(async ({ request, user }) => {
      const body = await readJson(request, ['year'])
      if (body instanceof Response) return body
      const year = body.year
      if (
        typeof year !== 'number' ||
        !Number.isInteger(year) ||
        year < 2000 ||
        year > new Date().getFullYear()
      ) {
        return errorResponse(400, 'year must be a past or current year')
      }
      const { line, postalCode, city } = user.address
      if (!line || !postalCode || !city) {
        return errorResponse(
          400,
          'set your postal address (PATCH /auth/me) first: it is printed on the tax receipt',
        )
      }
      const db = getDb()
      const val = valueYear(db, user.id, year)
      if (val.totalCents <= 0) return errorResponse(400, 'no mileage to waive for this year')
      if (db.waivers.some((w) => w.userId === user.id && w.year === year)) {
        return errorResponse(409, 'reimbursement for this year is already waived')
      }
      const waiver: MockWaiver = {
        userId: user.id,
        year,
        km: val.totalKm,
        amountCents: val.totalCents,
        waivedAt: nowTimestamp(),
      }
      db.waivers.push(waiver)
      saveDb()
      return HttpResponse.json(toWaiver(waiver), { status: 201 })
    }),
  ),

  http.delete(
    api('/waivers/:year'),
    authed(({ params, user }) => {
      const year = Number(params.year)
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return errorResponse(400, 'invalid year')
      }
      const db = getDb()
      const waiver = db.waivers.find((w) => w.userId === user.id && w.year === year)
      if (!waiver) return errorResponse(404, 'no waiver for this year')
      if (db.receipts.some((r) => r.userId === user.id && r.year === year)) {
        return errorResponse(409, 'a tax receipt was already issued for this year')
      }
      db.waivers = db.waivers.filter((w) => w !== waiver)
      saveDb()
      return noContent()
    }),
  ),

  http.get(
    api('/receipts/:id/pdf'),
    authed(({ params, user }) => {
      const id = pathId(params)
      const receipt = getDb().receipts.find(
        (r) => r.id === id && (r.userId === user.id || user.role === 'president'),
      )
      if (!receipt) return errorResponse(404, 'receipt not found')
      return new HttpResponse(receiptPdf(receipt), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': attachment(`recu-fiscal-${receiptNumber(receipt)}.pdf`),
        },
      })
    }),
  ),
]
