// The thin REST wrappers (method, path, body, unwrapping) and the error normalisation paths
// client.spec.ts does not reach: timeouts, cancellations, non-Axios errors, unreadable blobs.
import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'

import { auth, http, onUnauthorized, saveBlob, toApiRequestError, trips } from '@/api'

type Answer = (cfg: InternalAxiosRequestConfig) => AxiosResponse | Promise<AxiosResponse>

function respond(data: unknown, status = 200): Answer {
  return (cfg) => ({
    data,
    status,
    statusText: String(status),
    headers: new AxiosHeaders({}),
    config: cfg,
    request: {},
  })
}

function useAdapter(answer: Answer) {
  const calls: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = async (cfg) => {
    calls.push(cfg)
    return answer(cfg)
  }
  http.defaults.adapter = adapter
  return calls
}

const coach = { id: 7, email: 'coach@club.fr' }

afterEach(() => {
  onUnauthorized(null)
})

describe('api wrappers', () => {
  it('auth.me and auth.updateMe unwrap `{ coach }`', async () => {
    const calls = useAdapter(respond({ coach }))
    await expect(auth.me()).resolves.toEqual(coach)
    await expect(auth.updateMe({ firstName: 'Ana' })).resolves.toEqual(coach)
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['get', '/auth/me'],
      ['patch', '/auth/me'],
    ])
    expect(JSON.parse(calls[1]!.data as string)).toEqual({ firstName: 'Ana' })
  })

  it('auth.register and auth.login post their input', async () => {
    const calls = useAdapter(respond({ token: 't', coach }))
    await auth.login({ email: 'a@b.fr', password: 'x' })
    expect(calls[0]?.url).toBe('/auth/login')
    expect(calls[0]?.method).toBe('post')
  })

  it('trips.get, update and remove hit /trips/{id}', async () => {
    const calls = useAdapter(respond({ id: 5 }))
    await expect(trips.get(5)).resolves.toEqual({ id: 5 })
    await trips.update(5, { purpose: 'Match' })
    await trips.remove(5)
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['get', '/trips/5'],
      ['patch', '/trips/5'],
      ['delete', '/trips/5'],
    ])
  })

  it('newClientId makes distinct UUIDs', () => {
    const a = trips.newClientId()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(trips.newClientId()).not.toBe(a)
  })

  it('a 401 on /auth/login does not end the session', async () => {
    const handler = vi.fn()
    onUnauthorized(handler)
    useAdapter((cfg) => {
      throw new AxiosError(
        'HTTP 401',
        AxiosError.ERR_BAD_REQUEST,
        cfg,
        {},
        respond({ error: 'invalid email or password' }, 401)(cfg) as AxiosResponse,
      )
    })
    await expect(auth.login({ email: 'a@b.fr', password: 'x' })).rejects.toMatchObject({
      status: 401,
    })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('toApiRequestError', () => {
  it('keeps an ApiRequestError as is', async () => {
    const first = await toApiRequestError(new Error('boom'))
    await expect(toApiRequestError(first)).resolves.toBe(first)
    expect(first.kind).toBe('network')
    expect(first.message).toBe('boom')
  })

  it('normalises a non-Error throw', async () => {
    await expect(toApiRequestError('weird')).resolves.toMatchObject({
      kind: 'network',
      message: 'weird',
    })
  })

  it('tells timeouts and cancellations apart', async () => {
    const timeout = await toApiRequestError(new AxiosError('timeout', AxiosError.ECONNABORTED))
    expect(timeout.kind).toBe('timeout')
    expect(timeout.isTimeout).toBe(true)
    expect(timeout.isNetworkError).toBe(true)

    const canceled = await toApiRequestError(new axios.CanceledError())
    expect(canceled.kind).toBe('canceled')
    expect(canceled.isCanceled).toBe(true)
    expect(canceled.isNetworkError).toBe(false)
  })

  it('falls back to "HTTP <status>" for an unreadable or empty error body', async () => {
    const res = (data: unknown, status: number) =>
      ({ data, status, statusText: '', headers: {}, config: {} }) as AxiosResponse
    const blob = await toApiRequestError(
      new AxiosError('x', 'ERR', undefined, {}, res(new Blob(['not json']), 500)),
    )
    expect(blob).toMatchObject({ status: 500, message: 'HTTP 500', serverMessage: null })
    expect(blob.isServerError).toBe(true)

    const forbidden = await toApiRequestError(
      new AxiosError('x', 'ERR', undefined, {}, res('', 403)),
    )
    expect(forbidden.isForbidden).toBe(true)
    expect(forbidden.message).toBe('HTTP 403')
  })
})

describe('saveBlob', () => {
  it('clicks a temporary link, then revokes the object URL', () => {
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      saveBlob(new Blob(['x']), 'recap.pdf')
      expect(click).toHaveBeenCalledOnce()
      const link = click.mock.contexts[0] as HTMLAnchorElement
      expect(link.download).toBe('recap.pdf')
      expect(document.querySelector('a[download]')).toBeNull()
      expect(revoke).not.toHaveBeenCalled()
      vi.advanceTimersByTime(30_000)
      expect(revoke).toHaveBeenCalledWith('blob:x')
    } finally {
      click.mockRestore()
      vi.useRealTimers()
    }
  })
})
