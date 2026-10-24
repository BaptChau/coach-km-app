// `@/api` mock for store tests: keeps the real ApiRequestError, replaces every call by vi.fn().
// Usage in a spec:
//   vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))
import { ApiRequestError } from '@/api'
import type { Trip, TripInput, Vehicle } from '@/types'

export function mockApi(actual: Record<string, unknown>) {
  return {
    ...actual,
    setTokenProvider: vi.fn(),
    onUnauthorized: vi.fn(),
    saveBlob: vi.fn(),
    auth: { login: vi.fn(), register: vi.fn(), me: vi.fn(), updateMe: vi.fn() },
    vehicles: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    trips: {
      listByYear: vi.fn(async () => []),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      newClientId: vi.fn(() => 'client-1'),
    },
    summary: { get: vi.fn() },
    rates: { get: vi.fn() },
    waivers: { list: vi.fn(async () => []), create: vi.fn(), remove: vi.fn(), receiptPdf: vi.fn() },
    admin: { coaches: vi.fn(), receipts: vi.fn(), issueReceipt: vi.fn() },
  }
}

export const networkError = () => new ApiRequestError('network', null, 'Network Error')
export const httpError = (status: number, message: string) =>
  new ApiRequestError('http', status, message, message)

export const vehicle: Vehicle = {
  id: 1,
  label: 'Clio',
  type: 'car',
  fiscalHorsepower: 5,
  electric: false,
  createdAt: '2026-01-01T00:00:00Z',
}

export const tripInput: TripInput = {
  date: '2026-04-12',
  origin: 'Lyon',
  destination: 'Villeurbanne',
  purpose: 'Entraînement',
  vehicleId: 1,
  distanceKm: 12,
  roundTrip: true,
}

let serverSeq = 100

/** What the server would answer for a create. */
export function serverTrip(input: TripInput, overrides: Partial<Trip> = {}): Trip {
  return {
    id: ++serverSeq,
    clientId: input.clientId ?? null,
    date: input.date,
    origin: input.origin,
    destination: input.destination,
    purpose: input.purpose,
    vehicleId: input.vehicleId,
    distanceKm: input.distanceKm,
    roundTrip: input.roundTrip,
    billedKm: input.roundTrip ? input.distanceKm * 2 : input.distanceKm,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}
