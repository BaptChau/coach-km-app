// Helpers shared by the mock handlers: URL prefix, `{ error }` responses, mock auth,
// strict JSON bodies and query parsing, all following api/API.md.
import { HttpResponse, type PathParams } from 'msw'

import { config } from '@/config'

import { getDb, type MockUser } from '../db'

/** The full mock URL of an API path: `/trips` → `/api/trips`. */
export function api(path: string): string {
  return `${config.apiBaseUrl.replace(/\/$/, '')}${path}`
}

/** The API's error shape `{ error }`. */
export function errorResponse(status: number, error: string): Response {
  return HttpResponse.json({ error }, { status })
}

export function noContent(): Response {
  return new HttpResponse(null, { status: 204 })
}

export const TOKEN_PREFIX = 'mock-token-'

/** Mock tokens are opaque strings `mock-token-<userId>`. */
export function tokenFor(user: Pick<MockUser, 'id'>): string {
  return `${TOKEN_PREFIX}${user.id}`
}

/** The user behind `Authorization: Bearer mock-token-<id>`, or null. */
export function userFromRequest(request: Request): MockUser | null {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+mock-token-(\d+)$/i.exec(header.trim())
  if (!match) return null
  const id = Number(match[1])
  return getDb().users.find((u) => u.id === id) ?? null
}

export interface AuthedInfo {
  request: Request
  params: PathParams
  user: MockUser
}

type AuthedResolver = (info: AuthedInfo) => Response | Promise<Response>

/** Wraps a resolver that needs a logged-in user: 401 without a valid token. */
export function authed(resolver: AuthedResolver) {
  return ({ request, params }: { request: Request; params: PathParams }) => {
    const user = userFromRequest(request)
    if (!user) return errorResponse(401, 'missing or invalid token')
    return resolver({ request, params, user })
  }
}

/** Same as `authed`, plus 403 for anyone but the president. */
export function presidentOnly(resolver: AuthedResolver) {
  return authed((info) =>
    info.user.role === 'president' ? resolver(info) : errorResponse(403, 'president only'),
  )
}

export type JsonBody = Record<string, unknown>

/**
 * Reads a JSON object body and rejects unknown fields, like the Go API
 * (`json: unknown field "x"`). Returns a 400 Response on failure.
 */
export async function readJson(
  request: Request,
  allowed: readonly string[],
): Promise<JsonBody | Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'request body must be valid JSON')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(400, 'request body must be a JSON object')
  }
  const unknown = Object.keys(body).find((k) => !allowed.includes(k))
  if (unknown) return errorResponse(400, `json: unknown field "${unknown}"`)
  return body as JsonBody
}

/** A positive integer path id, or null. */
export function pathId(params: PathParams, name = 'id'): number | null {
  const raw = params[name]
  const id = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** `?year=` (defaults to the current year), or null when it is not a valid year. */
export function yearParam(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get('year')
  if (raw === null || raw === '') return new Date().getFullYear()
  const year = Number(raw)
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null
}

export function isString(v: unknown): v is string {
  return typeof v === 'string'
}
