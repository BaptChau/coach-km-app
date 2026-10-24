// The single Axios instance for api/API.md, plus the typed error every wrapper throws.
//
// The client never imports a store: the auth store (issue #9) plugs itself in with
// `setTokenProvider(() => token)` and `onUnauthorized(() => logout())`.
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'

import { config } from '@/config'
import type { ApiError } from '@/types'

/** Request timeout in ms. A timeout counts as a network error (the offline queue retries it). */
export const REQUEST_TIMEOUT_MS = 15_000

/** Paths where a 401 means "wrong credentials", not "session expired". */
const CREDENTIAL_PATHS = ['/auth/login', '/auth/register']

let tokenProvider: () => string | null = () => null
let unauthorizedHandler: (() => void) | null = null

/** Sets where the Bearer token comes from (the auth store, issue #9). */
export function setTokenProvider(fn: () => string | null): void {
  tokenProvider = fn
}

/** Sets what to do when an authenticated call returns 401 (log out and go to the login page). */
export function onUnauthorized(fn: (() => void) | null): void {
  unauthorizedHandler = fn
}

export type ApiErrorKind = 'network' | 'timeout' | 'canceled' | 'http'

/**
 * Every failure of the API layer. `isNetworkError` means the request never got an answer
 * (offline, DNS, timeout): the offline queue keeps it and retries. Any other error was
 * rejected by the server and must not be retried as is.
 */
export class ApiRequestError extends Error {
  /** HTTP status, or `null` when there was no response. */
  readonly status: number | null
  readonly kind: ApiErrorKind
  /** The server's `{ error }` message when there was one. */
  readonly serverMessage: string | null

  constructor(
    kind: ApiErrorKind,
    status: number | null,
    message: string,
    serverMessage: string | null = null,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ApiRequestError'
    this.kind = kind
    this.status = status
    this.serverMessage = serverMessage
  }

  /** No answer from the server (offline, unreachable or timed out). Safe to retry later. */
  get isNetworkError(): boolean {
    return this.kind === 'network' || this.kind === 'timeout'
  }
  get isTimeout(): boolean {
    return this.kind === 'timeout'
  }
  get isCanceled(): boolean {
    return this.kind === 'canceled'
  }
  /** 400: validation error, the message usually names the field. */
  get isValidation(): boolean {
    return this.status === 400
  }
  get isUnauthorized(): boolean {
    return this.status === 401
  }
  /** 403: president-only route. */
  get isForbidden(): boolean {
    return this.status === 403
  }
  get isNotFound(): boolean {
    return this.status === 404
  }
  /** 409: duplicate, vehicle in use, or locked (waived) year. */
  get isConflict(): boolean {
    return this.status === 409
  }
  get isServerError(): boolean {
    return this.status !== null && this.status >= 500
  }
}

export function isApiRequestError(e: unknown): e is ApiRequestError {
  return e instanceof ApiRequestError
}

export const http = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
})

http.interceptors.request.use((req: InternalAxiosRequestConfig) => {
  const token = tokenProvider()
  if (token) req.headers.set('Authorization', `Bearer ${token}`)
  return req
})

http.interceptors.response.use(
  (res: AxiosResponse) => res,
  async (err: unknown) => {
    const apiError = await toApiRequestError(err)
    if (apiError.isUnauthorized && !isCredentialRequest(err)) unauthorizedHandler?.()
    throw apiError
  },
)

function isCredentialRequest(err: unknown): boolean {
  const url = axios.isAxiosError(err) ? (err.config?.url ?? '') : ''
  const path = url.split('?')[0] ?? ''
  return CREDENTIAL_PATHS.some((p) => path === p || path.endsWith(p))
}

/** Reads `{ error }` from a JSON body, or from a Blob body (downloads use `responseType: 'blob'`). */
async function serverMessageOf(data: unknown): Promise<string | null> {
  let body = data
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    try {
      body = JSON.parse(await body.text())
    } catch {
      return null
    }
  }
  if (body && typeof body === 'object' && typeof (body as ApiError).error === 'string') {
    return (body as ApiError).error
  }
  return null
}

/** Normalises anything Axios can throw into an `ApiRequestError`. */
export async function toApiRequestError(err: unknown): Promise<ApiRequestError> {
  if (err instanceof ApiRequestError) return err
  if (axios.isCancel(err))
    return new ApiRequestError('canceled', null, 'Request canceled', null, { cause: err })
  if (!axios.isAxiosError(err)) {
    const message = err instanceof Error ? err.message : String(err)
    return new ApiRequestError('network', null, message, null, { cause: err })
  }
  const e = err as AxiosError
  if (!e.response) {
    const timedOut = e.code === AxiosError.ECONNABORTED || e.code === AxiosError.ETIMEDOUT
    return new ApiRequestError(
      timedOut ? 'timeout' : 'network',
      null,
      e.message || 'Network Error',
      null,
      { cause: err },
    )
  }
  const status = e.response.status
  const serverMessage = await serverMessageOf(e.response.data)
  return new ApiRequestError('http', status, serverMessage ?? `HTTP ${status}`, serverMessage, {
    cause: err,
  })
}
