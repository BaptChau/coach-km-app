// The mock API through the real `@/api` wrappers (msw/node intercepts Axios).
import { setupServer } from 'msw/node'

import {
  admin,
  ApiRequestError,
  auth,
  exportApi,
  rates,
  setTokenProvider,
  summary,
  trips,
  vehicles,
  waivers,
} from '@/api'
import { FALLBACK_BAREME } from '@/config/rates'
import { amountCentsFor } from '@/domain'
import type { TripInput } from '@/types'

import { DB_STORAGE_KEY, getDb, resetMockDb } from './db'
import { handlers } from './handlers'
import { SEED_COACH_EMAIL, SEED_PASSWORD, SEED_PRESIDENT_EMAIL } from './seed'
import { split } from './valuation'

const server = setupServer(...handlers)
const year = new Date().getFullYear()
const prevYear = year - 1

let token: string | null = null

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
  setTokenProvider(() => token)
})
afterAll(() => {
  server.close()
  setTokenProvider(() => null)
})
beforeEach(() => {
  token = null
  resetMockDb()
})

async function loginAs(email: string): Promise<void> {
  const res = await auth.login({ email, password: SEED_PASSWORD })
  token = res.token
}

async function failure(p: Promise<unknown>): Promise<ApiRequestError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(ApiRequestError)
  return err as ApiRequestError
}

function tripInput(overrides: Partial<TripInput> = {}): TripInput {
  return {
    date: `${year}-01-05`,
    origin: 'Bar-le-Duc',
    destination: 'Verdun',
    purpose: 'Match U15',
    vehicleId: 1,
    distanceKm: 56,
    roundTrip: true,
    ...overrides,
  }
}

describe('mock auth', () => {
  it('logs in the seed coach with a mock token', async () => {
    const res = await auth.login({ email: ' Coach@Club.fr ', password: SEED_PASSWORD })
    expect(res.token).toBe('mock-token-1')
    expect(res.coach).toMatchObject({
      email: SEED_COACH_EMAIL,
      firstName: 'Jeanne',
      lastName: 'Dupont',
      registrationNumber: '5655006101030',
      role: 'coach',
    })
    expect(res.coach).not.toHaveProperty('password')
  })

  it('rejects bad credentials and missing tokens with 401', async () => {
    const bad = await failure(auth.login({ email: SEED_COACH_EMAIL, password: 'nope' }))
    expect(bad.status).toBe(401)
    expect(bad.message).toBe('invalid email or password')
    expect((await failure(auth.me())).status).toBe(401)
  })

  it('registers with a spaced registration number, 409 on duplicates', async () => {
    const input = {
      email: 'paul@club.fr',
      registrationNumber: '5655006 101 099',
      firstName: 'Paul',
      lastName: 'Martin',
      password: 'password1',
    }
    const res = await auth.register(input)
    expect(res.coach.registrationNumber).toBe('5655006101099')
    expect(res.coach.address).toEqual({ line: '', postalCode: '', city: '' })
    expect((await failure(auth.register(input))).status).toBe(409)
    const badNumber = await failure(
      auth.register({ ...input, email: 'x@club.fr', registrationNumber: '1234567890123' }),
    )
    expect(badNumber.status).toBe(400)
  })
})

describe('mock trips', () => {
  beforeEach(() => loginAs(SEED_COACH_EMAIL))

  it('lists a year newest first with billedKm', async () => {
    const list = await trips.listByYear(year)
    expect(list.length).toBeGreaterThan(10)
    expect(list.every((t) => t.date.startsWith(`${year}-`))).toBe(true)
    const dates = list.map((t) => t.date)
    expect([...dates].sort().reverse()).toEqual(dates)
    for (const t of list) expect(t.billedKm).toBe(t.roundTrip ? t.distanceKm * 2 : t.distanceKm)
    expect((await trips.listByYear(prevYear)).length).toBeGreaterThan(5)
  })

  it('creates once per clientId: 201 then 200 with the same trip', async () => {
    const before = getDb().trips.length
    const input = tripInput({ clientId: 'offline-uuid-1' })
    const first = await trips.create(input)
    const again = await trips.create(input)
    expect(again).toEqual(first)
    expect(first.billedKm).toBe(112)
    expect(getDb().trips.length).toBe(before + 1)
    expect(JSON.parse(localStorage.getItem(DB_STORAGE_KEY) ?? '{}').trips).toHaveLength(before + 1)
  })

  it('answers 201 on create and 200 on a replay (status codes)', async () => {
    const send = (body: TripInput) =>
      fetch(new URL('/api/trips', location.href), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const input = tripInput({ clientId: 'offline-uuid-2' })
    expect((await send(input)).status).toBe(201)
    expect((await send(input)).status).toBe(200)
  })

  it('locks the waived previous year with 409', async () => {
    const created = await failure(trips.create(tripInput({ date: `${prevYear}-03-01` })))
    expect(created.status).toBe(409)
    const old = (await trips.listByYear(prevYear))[0]!
    expect((await failure(trips.update(old.id, { distanceKm: 10 }))).status).toBe(409)
    expect((await failure(trips.remove(old.id))).status).toBe(409)
    const current = (await trips.listByYear(year))[0]!
    const moved = await failure(trips.update(current.id, { date: `${prevYear}-06-01` }))
    expect(moved.status).toBe(409)
  })

  it('validates fields and hides other coaches’ trips', async () => {
    expect((await failure(trips.create(tripInput({ origin: '' })))).status).toBe(400)
    expect((await failure(trips.create(tripInput({ distanceKm: 0 })))).status).toBe(400)
    // Vehicle 3 is the president's.
    expect((await failure(trips.create(tripInput({ vehicleId: 3 })))).status).toBe(400)
    const presidentTrip = getDb().trips.find((t) => t.userId === 2)!
    expect((await failure(trips.get(presidentTrip.id))).status).toBe(404)
  })
})

describe('mock vehicles', () => {
  beforeEach(() => loginAs(SEED_COACH_EMAIL))

  it('requires CV except for a moped, and refuses to delete a vehicle in use', async () => {
    const list = await vehicles.list()
    expect(list.map((v) => v.label)).toEqual(['Clio', 'Moto électrique'])
    const noHp = await failure(
      vehicles.create({ label: 'Twingo', type: 'car', fiscalHorsepower: null, electric: false }),
    )
    expect(noHp.status).toBe(400)
    const moped = await vehicles.create({
      label: 'Scooter',
      type: 'moped',
      fiscalHorsepower: 3,
      electric: false,
    })
    expect(moped.fiscalHorsepower).toBeNull()
    expect((await failure(vehicles.remove(1))).status).toBe(409)
    await vehicles.remove(moped.id)
    // Re-rating a vehicle used in a waived year is refused; renaming is fine.
    expect((await failure(vehicles.update(1, { fiscalHorsepower: 6 }))).status).toBe(409)
    expect((await vehicles.update(1, { label: 'Clio V' })).label).toBe('Clio V')
  })
})

describe('mock summary and rates', () => {
  beforeEach(() => loginAs(SEED_COACH_EMAIL))

  it('serves the fallback barème', async () => {
    const r = await rates.get(year)
    expect(r.year).toBe(year)
    expect(r.byType).toEqual(FALLBACK_BAREME.byType)
  })

  it('values each vehicle once on its yearly km, months summing to the total', async () => {
    const s = await summary.get(year)
    const list = await trips.listByYear(year)
    const fleet = await vehicles.list()
    let totalCents = 0
    for (const v of fleet) {
      const km = list.filter((t) => t.vehicleId === v.id).reduce((n, t) => n + t.billedKm, 0)
      const cents = amountCentsFor(FALLBACK_BAREME, v, km)
      const row = s.byVehicle.find((b) => b.vehicleId === v.id)!
      expect(row.km).toBeCloseTo(km, 6)
      expect(Math.round(row.amount * 100)).toBe(cents)
      totalCents += cents
    }
    expect(Math.round(s.totalAmount * 100)).toBe(totalCents)
    expect(s.byMonth).toHaveLength(12)
    const monthCents = s.byMonth.reduce((n, m) => n + Math.round(m.amount * 100), 0)
    expect(monthCents).toBe(totalCents)
    expect(s.byMonth.reduce((n, m) => n + m.km, 0)).toBeCloseTo(s.totalKm, 6)
  })

  it('splits with the largest remainder', () => {
    expect(split(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(split(10, [0, 0])).toEqual([0, 0])
  })

  it('downloads the export with its filename', async () => {
    const csv = await exportApi.download(year, 'csv')
    expect(csv.filename).toBe(`recapitulatif-km-${year}.csv`)
    const pdf = await exportApi.download(year, 'pdf')
    expect(pdf.filename).toBe(`recapitulatif-km-${year}.pdf`)
    const res = await fetch(new URL(`/api/export?year=${year}&format=pdf`, location.href), {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect((await res.text()).startsWith('%PDF-')).toBe(true)
  })
})

describe('mock waivers and admin', () => {
  it('has a waived previous year with receipt <prevYear>-0001', async () => {
    await loginAs(SEED_COACH_EMAIL)
    const list = await waivers.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ year: prevYear, receipt: { number: `${prevYear}-0001` } })
    expect((await failure(waivers.create(prevYear))).status).toBe(409)
    expect((await failure(waivers.remove(prevYear))).status).toBe(409)
    const pdf = await waivers.receiptPdf(list[0]!.receipt!.id)
    expect(pdf.filename).toBe(`recu-fiscal-${prevYear}-0001.pdf`)
  })

  it('refuses /admin to a coach with 403', async () => {
    await loginAs(SEED_COACH_EMAIL)
    const err = await failure(admin.coaches(year))
    expect(err.status).toBe(403)
    expect(err.isForbidden).toBe(true)
  })

  it('lets the president list coaches and issue the next receipt', async () => {
    await loginAs(SEED_COACH_EMAIL)
    const waiver = await waivers.create(year)
    expect(waiver.receipt).toBeNull()

    await loginAs(SEED_PRESIDENT_EMAIL)
    const rows = await admin.coaches(year)
    expect(rows.map((r) => r.coach.lastName)).toEqual(['Dupont', 'Lefèvre'])
    expect(rows[0]?.waiver?.amount).toBe(waiver.amount)

    const receipt = await admin.issueReceipt({ coachId: 1, year })
    expect(receipt).toMatchObject({ number: `${year}-0001`, amount: waiver.amount, issuedBy: 2 })
    expect((await failure(admin.issueReceipt({ coachId: 1, year }))).status).toBe(409)
    expect((await failure(admin.issueReceipt({ coachId: 2, year }))).status).toBe(409)
    expect(await admin.receipts(year)).toHaveLength(1)
  })
})
