// Mocks ↔ French error mapping parity: the `{ error }` strings the MSW mocks send (copied from
// the Go handlers) must be the ones `src/domain/errors.ts` knows, so they cannot drift apart.
import { setupServer } from 'msw/node'

import { admin, ApiRequestError, auth, setTokenProvider, trips, vehicles, waivers } from '@/api'
import { API_MESSAGES, describeError, GENERIC_ERROR } from '@/domain/errors'

import { resetMockDb } from './db'
import { handlers } from './handlers'
import { SEED_COACH_EMAIL, SEED_PASSWORD, SEED_PRESIDENT_EMAIL } from './seed'

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
  token = (await auth.login({ email, password: SEED_PASSWORD })).token
}

async function rejectionOf(p: Promise<unknown>): Promise<ApiRequestError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(ApiRequestError)
  return err as ApiRequestError
}

const mappingOf = (message: string) =>
  API_MESSAGES.find((m) => message.toLowerCase().startsWith(m.starts.toLowerCase()))

const register = {
  email: 'nouveau@club.fr',
  registrationNumber: '5655006999999',
  firstName: 'Léa',
  lastName: 'Petit',
  password: 'motdepasse',
}

const trip = {
  date: `${year}-01-05`,
  origin: 'Bar-le-Duc',
  destination: 'Verdun',
  purpose: 'Match',
  vehicleId: 1,
  distanceKm: 56,
  roundTrip: true,
}

describe('mock error messages → French mapping (key cases)', () => {
  it.each<[string, () => Promise<unknown>, string]>([
    [
      'bad credentials',
      () => auth.login({ email: SEED_COACH_EMAIL, password: 'mauvais' }),
      'E-mail ou mot de passe incorrect.',
    ],
    [
      'duplicate e-mail',
      () => auth.register({ ...register, email: SEED_COACH_EMAIL }),
      'Cet e-mail est déjà inscrit',
    ],
    [
      'duplicate licence number',
      () => auth.register({ ...register, registrationNumber: '5655006101030' }),
      'Ce numéro de licence est déjà inscrit',
    ],
    [
      'invalid licence number',
      () => auth.register({ ...register, registrationNumber: '123' }),
      '13 chiffres, commençant par 5655006',
    ],
  ])('%s', async (_name, call, french) => {
    const err = await rejectionOf(call())
    expect(mappingOf(err.serverMessage ?? '')).toBeDefined()
    expect(describeError(err).message).toBe(french)
  })

  it.each<[string, () => Promise<unknown>, string]>([
    [
      'trip in a waived year',
      () => trips.create({ ...trip, date: `${prevYear}-03-01` }),
      'Année clôturée : vous avez renoncé au remboursement, ses trajets ne peuvent plus changer.',
    ],
    [
      'someone else’s vehicle',
      () => trips.create({ ...trip, vehicleId: 999 }),
      'Choisissez un de vos véhicules',
    ],
    [
      'vehicle in use',
      () => vehicles.remove(1),
      'Ce véhicule est utilisé par des trajets : supprimez ces trajets ou changez leur véhicule avant de le supprimer.',
    ],
    [
      'year already waived',
      () => waivers.create(prevYear),
      'Vous avez déjà renoncé au remboursement pour cette année.',
    ],
    [
      'withdraw after the receipt',
      () => waivers.remove(prevYear),
      'Le reçu fiscal de cette année est déjà émis : la renonciation ne peut plus être annulée.',
    ],
    ['admin as a coach', () => admin.coaches(year), 'Action réservée au président.'],
  ])('coach: %s', async (_name, call, french) => {
    await loginAs(SEED_COACH_EMAIL)
    const err = await rejectionOf(call())
    expect(mappingOf(err.serverMessage ?? '')).toBeDefined()
    expect(describeError(err).message).toBe(french)
  })

  it('president: receipts not waived or already issued', async () => {
    await loginAs(SEED_PRESIDENT_EMAIL)
    const coachId = (await admin.coaches(prevYear)).find((r) => r.coach.email === SEED_COACH_EMAIL)!
      .coach.id

    const notWaived = await rejectionOf(admin.issueReceipt({ coachId, year }))
    expect(describeError(notWaived).message).toBe(
      'Ce coach n’a pas renoncé au remboursement pour cette année.',
    )
    const issued = await rejectionOf(admin.issueReceipt({ coachId, year: prevYear }))
    expect(describeError(issued).message).toBe(
      'Le reçu de ce coach est déjà émis pour cette année.',
    )
  })
})

describe('every literal mock error message is mapped', () => {
  const sources = import.meta.glob<string>('./handlers/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  })

  /** Technical messages a coach never triggers from the UI: the status fallback is enough. */
  const TECHNICAL = new Set([
    'missing or invalid token',
    'request body must be valid JSON',
    'request body must be a JSON object',
    'limit must be between 1 and 1000',
    'offset must be >= 0',
    'clientId must be 1-64 characters',
    "clientId can't be changed",
    'coachId and year are required',
    'roundTrip must be a boolean',
  ])

  function literalMessages(): string[] {
    const found = new Set<string>()
    const patterns = [
      // errorResponse(409, 'message') — possibly over several lines
      /errorResponse\(\s*\d{3},\s*(['"])((?:(?!\1).)+)\1/gs,
      // validators: return 'message'
      /return (['"])((?:(?!\1).)+)\1/g,
      // message constants: const LOCKED_MSG = "…", const BAD_VEHICLE = '…'
      /const (?:[A-Z_]+_MSG|BAD_[A-Z_]+) = (['"])((?:(?!\1).)+)\1/g,
    ]
    for (const source of Object.values(sources)) {
      for (const re of patterns) for (const m of source.matchAll(re)) found.add(m[2]!)
    }
    return [...found]
  }

  it('finds the messages of every handler file', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(6)
    expect(literalMessages().length).toBeGreaterThan(30)
  })

  it.each(literalMessages().filter((m) => !TECHNICAL.has(m)))('"%s"', (message) => {
    const err = new ApiRequestError('http', 400, message, message)
    expect(mappingOf(message), `no API_MESSAGES entry for "${message}"`).toBeDefined()
    expect(describeError(err).message).not.toBe(GENERIC_ERROR)
  })
})
