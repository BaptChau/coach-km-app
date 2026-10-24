// /rates (public), /summary and /export.
import { http, HttpResponse } from 'msw'

import type { RatesResponse, Summary } from '@/types'

import { getDb, type MockUser } from '../db'
import { attachment, csv, frNumber, minimalPdf } from '../files'
import { baremeFor, centsToEuros, roundKm, valueYear, yearOf } from '../valuation'
import { api, authed, errorResponse, yearParam } from './utils'

/** The `/summary` body for a coach's year (exported for tests and the admin handlers). */
export function summaryFor(user: Pick<MockUser, 'id'>, year: number): Summary {
  const val = valueYear(getDb(), user.id, year)
  return {
    year,
    baremeSource: val.bareme.source,
    totalKm: roundKm(val.totalKm),
    totalAmount: centsToEuros(val.totalCents),
    byMonth: val.byMonthKm.map((km, i) => ({
      month: i + 1,
      km: roundKm(km),
      amount: centsToEuros(val.byMonthCents[i] ?? 0),
    })),
    byVehicle: val.vehicles.map(({ vehicle, km, cents }) => ({
      vehicleId: vehicle.id,
      label: vehicle.label,
      type: vehicle.type,
      fiscalHorsepower: vehicle.fiscalHorsepower,
      electric: vehicle.electric,
      km: roundKm(km),
      amount: centsToEuros(cents),
    })),
  }
}

function frDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function exportCsv(user: MockUser, year: number): string {
  const db = getDb()
  const vehicles = new Map(db.vehicles.map((v) => [v.id, v.label]))
  const trips = db.trips
    .filter((t) => t.userId === user.id && yearOf(t.date) === year)
    .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
  const summary = summaryFor(user, year)
  return csv([
    [
      'Date',
      'Départ',
      'Arrivée',
      'Motif',
      'Véhicule',
      'Distance (km)',
      'Aller-retour',
      'Km retenus',
    ],
    ...trips.map((t) => [
      frDate(t.date),
      t.origin,
      t.destination,
      t.purpose,
      vehicles.get(t.vehicleId) ?? '',
      frNumber(t.distanceKm, 1),
      t.roundTrip ? 'oui' : 'non',
      frNumber(t.billedKm, 1),
    ]),
    [],
    ['Total km retenus', '', '', '', '', '', '', frNumber(summary.totalKm, 1)],
    ['Montant total (€)', '', '', '', '', '', '', frNumber(summary.totalAmount)],
  ])
}

function exportPdf(user: MockUser, year: number): Uint8Array {
  const s = summaryFor(user, year)
  return minimalPdf([
    `Recapitulatif des frais kilometriques ${year}`,
    `${user.firstName} ${user.lastName} - licence ${user.registrationNumber}`,
    ...s.byVehicle.map((v) => `${v.label} : ${frNumber(v.km, 1)} km, ${frNumber(v.amount)} EUR`),
    `Total : ${frNumber(s.totalKm, 1)} km, ${frNumber(s.totalAmount)} EUR`,
    '(document de demonstration genere par les mocks)',
  ])
}

export const reportHandlers = [
  http.get(api('/rates'), ({ request }) => {
    const year = yearParam(request)
    if (year === null) return errorResponse(400, 'invalid year')
    const body: RatesResponse = { year, ...baremeFor() }
    return HttpResponse.json(body)
  }),

  http.get(
    api('/summary'),
    authed(({ request, user }) => {
      const year = yearParam(request)
      if (year === null) return errorResponse(400, 'invalid year')
      return HttpResponse.json(summaryFor(user, year))
    }),
  ),

  http.get(
    api('/export'),
    authed(({ request, user }) => {
      const year = yearParam(request)
      if (year === null) return errorResponse(400, 'invalid year')
      const format = new URL(request.url).searchParams.get('format') ?? 'pdf'
      const filename = `recapitulatif-km-${year}.${format}`
      if (format === 'csv') {
        return new HttpResponse(exportCsv(user, year), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': attachment(filename),
          },
        })
      }
      if (format === 'pdf') {
        return new HttpResponse(exportPdf(user, year), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': attachment(filename),
          },
        })
      }
      return errorResponse(400, 'format must be csv or pdf')
    }),
  ),

  http.get(api('/healthz'), () => HttpResponse.json({ status: 'ok' })),
]
