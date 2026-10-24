import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'

import { ApiRequestError, http, onUnauthorized, setTokenProvider, trips } from '@/api'
import { filenameFromDisposition } from '@/api/export'
import type { TripInput } from '@/types'

type Reply = { status: number; data?: unknown; headers?: Record<string, string> } | 'network'

/** A fake Axios adapter: records each request and answers with `reply`. */
function mockAdapter(reply: Reply) {
  const calls: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = async (cfg) => {
    calls.push(cfg)
    if (reply === 'network') {
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, cfg, {})
    }
    const res: AxiosResponse = {
      data: reply.data ?? null,
      status: reply.status,
      statusText: String(reply.status),
      headers: new AxiosHeaders(reply.headers ?? {}),
      config: cfg,
      request: {},
    }
    if (reply.status >= 400) {
      throw new AxiosError(`HTTP ${reply.status}`, AxiosError.ERR_BAD_REQUEST, cfg, {}, res)
    }
    return res
  }
  http.defaults.adapter = adapter
  return calls
}

const tripInput: TripInput = {
  date: '2026-04-12',
  origin: 'Lyon',
  destination: 'Villeurbanne',
  purpose: 'Entraînement',
  vehicleId: 1,
  distanceKm: 12,
  roundTrip: true,
}

afterEach(() => {
  setTokenProvider(() => null)
  onUnauthorized(null)
})

describe('api client', () => {
  it('adds the Bearer header when a token is available', async () => {
    const calls = mockAdapter({ status: 200, data: [] })
    setTokenProvider(() => 'jwt-123')
    await http.get('/vehicles')
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer jwt-123')
    expect(calls[0]?.baseURL).toBe('/api')
  })

  it('sends no Authorization header without a token', async () => {
    const calls = mockAdapter({ status: 200, data: [] })
    await http.get('/rates', { params: { year: 2026 } })
    expect(calls[0]?.headers.has('Authorization')).toBe(false)
  })

  it('calls the unauthorized handler on a 401', async () => {
    mockAdapter({ status: 401, data: { error: 'invalid token' } })
    const handler = vi.fn()
    onUnauthorized(handler)
    const err = await http.get('/auth/me').catch((e: unknown) => e)
    expect(handler).toHaveBeenCalledOnce()
    expect(err).toBeInstanceOf(ApiRequestError)
    expect((err as ApiRequestError).isUnauthorized).toBe(true)
  })

  it.each(['/auth/login', '/auth/register'])('does not log out on a 401 from %s', async (url) => {
    mockAdapter({ status: 401, data: { error: 'invalid email or password' } })
    const handler = vi.fn()
    onUnauthorized(handler)
    const err = (await http.post(url, {}).catch((e: unknown) => e)) as ApiRequestError
    expect(handler).not.toHaveBeenCalled()
    expect(err.message).toBe('invalid email or password')
  })

  it('normalises a network failure', async () => {
    mockAdapter('network')
    const err = (await http.get('/trips').catch((e: unknown) => e)) as ApiRequestError
    expect(err).toBeInstanceOf(ApiRequestError)
    expect(err.isNetworkError).toBe(true)
    expect(err.status).toBeNull()
    expect(err.isConflict).toBe(false)
  })

  it('normalises a 409 with the server message', async () => {
    mockAdapter({ status: 409, data: { error: 'year 2025 is locked' } })
    const err = (await http.patch('/trips/3', {}).catch((e: unknown) => e)) as ApiRequestError
    expect(err.isNetworkError).toBe(false)
    expect(err.isConflict).toBe(true)
    expect(err.status).toBe(409)
    expect(err.message).toBe('year 2025 is locked')
    expect(err.serverMessage).toBe('year 2025 is locked')
  })

  it('reads { error } from a Blob body (downloads)', async () => {
    const body = new Blob([JSON.stringify({ error: 'no trips' })], { type: 'application/json' })
    mockAdapter({ status: 404, data: body })
    const err = (await http
      .get('/export', { responseType: 'blob' })
      .catch((e: unknown) => e)) as ApiRequestError
    expect(err.isNotFound).toBe(true)
    expect(err.message).toBe('no trips')
  })
})

describe('trips.create', () => {
  it('generates a clientId when the caller has none', async () => {
    const calls = mockAdapter({ status: 201, data: { id: 1 } })
    await trips.create(tripInput)
    const body = JSON.parse(calls[0]?.data as string) as TripInput
    expect(calls[0]?.method).toBe('post')
    expect(calls[0]?.url).toBe('/trips')
    expect(body.clientId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("keeps the caller's clientId (offline replays)", async () => {
    const calls = mockAdapter({ status: 200, data: { id: 1 } })
    await trips.create({ ...tripInput, clientId: 'abc-123' })
    expect(JSON.parse(calls[0]?.data as string)).toMatchObject({ clientId: 'abc-123' })
  })

  it('lists a year with paging', async () => {
    const calls = mockAdapter({ status: 200, data: [] })
    await trips.listByYear(2026, { limit: 50, offset: 100 })
    expect(calls[0]?.params).toEqual({ year: 2026, limit: 50, offset: 100 })
  })
})

describe('filenameFromDisposition', () => {
  it('reads the filename or falls back', () => {
    expect(
      filenameFromDisposition('attachment; filename="recapitulatif-km-2023.csv"', 'x.csv'),
    ).toBe('recapitulatif-km-2023.csv')
    expect(filenameFromDisposition("attachment; filename*=UTF-8''re%C3%A7u.pdf", 'x')).toBe(
      'reçu.pdf',
    )
    expect(filenameFromDisposition(undefined, 'fallback.pdf')).toBe('fallback.pdf')
  })
})
