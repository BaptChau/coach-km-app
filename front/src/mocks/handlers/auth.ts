// /auth/register, /auth/login, /auth/me (GET, PATCH).
import { http, HttpResponse } from 'msw'

import { getDb, nextId, nowTimestamp, saveDb, toCoach, type MockUser } from '../db'
import { api, authed, errorResponse, isString, readJson, tokenFor } from './utils'

/** api/API.md: `REGISTRATION_NUMBER_PATTERN` default. */
export const REGISTRATION_NUMBER_PATTERN = /^5655006[0-9]{6}$/

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NAME = 100

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

function validName(v: unknown): v is string {
  return isString(v) && v.trim().length >= 1 && v.trim().length <= MAX_NAME
}

export const authHandlers = [
  http.post(api('/auth/register'), async ({ request }) => {
    const body = await readJson(request, [
      'email',
      'registrationNumber',
      'firstName',
      'lastName',
      'password',
    ])
    if (body instanceof Response) return body

    const email = isString(body.email) ? body.email.trim().toLowerCase() : ''
    const registrationNumber = isString(body.registrationNumber)
      ? body.registrationNumber.replace(/\s+/g, '')
      : ''
    if (!EMAIL_PATTERN.test(email)) return errorResponse(400, 'email is invalid')
    if (!REGISTRATION_NUMBER_PATTERN.test(registrationNumber)) {
      return errorResponse(400, 'registrationNumber has an invalid format')
    }
    if (!validName(body.firstName)) {
      return errorResponse(400, 'firstName is required (max 100 characters)')
    }
    if (!validName(body.lastName)) {
      return errorResponse(400, 'lastName is required (max 100 characters)')
    }
    const password = isString(body.password) ? body.password : ''
    if (byteLength(password) < 8 || byteLength(password) > 72) {
      return errorResponse(400, 'password must be 8-72 bytes')
    }

    const db = getDb()
    if (db.users.some((u) => u.email === email)) {
      return errorResponse(409, 'email already registered')
    }
    if (db.users.some((u) => u.registrationNumber === registrationNumber)) {
      return errorResponse(409, 'registrationNumber already registered')
    }
    const user: MockUser = {
      id: nextId(db.users),
      email,
      password,
      registrationNumber,
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      role: 'coach',
      address: { line: '', postalCode: '', city: '' },
      createdAt: nowTimestamp(),
    }
    db.users.push(user)
    saveDb()
    return HttpResponse.json({ token: tokenFor(user), coach: toCoach(user) }, { status: 201 })
  }),

  http.post(api('/auth/login'), async ({ request }) => {
    const body = await readJson(request, ['email', 'password'])
    if (body instanceof Response) return body
    const email = isString(body.email) ? body.email.trim().toLowerCase() : ''
    const user = getDb().users.find((u) => u.email === email)
    if (!user || user.password !== body.password) {
      return errorResponse(401, 'invalid email or password')
    }
    return HttpResponse.json({ token: tokenFor(user), coach: toCoach(user) })
  }),

  http.get(
    api('/auth/me'),
    authed(({ user }) => HttpResponse.json({ coach: toCoach(user) })),
  ),

  http.patch(
    api('/auth/me'),
    authed(async ({ request, user }) => {
      const body = await readJson(request, ['firstName', 'lastName', 'address'])
      if (body instanceof Response) return body

      if (body.firstName !== undefined && !validName(body.firstName)) {
        return errorResponse(400, 'firstName is required (max 100 characters)')
      }
      if (body.lastName !== undefined && !validName(body.lastName)) {
        return errorResponse(400, 'lastName is required (max 100 characters)')
      }
      let address = user.address
      if (body.address !== undefined) {
        const a = body.address
        if (!a || typeof a !== 'object' || Array.isArray(a)) {
          return errorResponse(400, 'address must be an object')
        }
        const fields = a as Record<string, unknown>
        const unknown = Object.keys(fields).find((k) => !['line', 'postalCode', 'city'].includes(k))
        if (unknown) return errorResponse(400, `json: unknown field "${unknown}"`)
        address = { ...address }
        for (const k of ['line', 'postalCode', 'city'] as const) {
          const v = fields[k]
          if (v === undefined) continue
          if (!isString(v) || v.trim().length > 255) {
            return errorResponse(400, `address.${k} must be a string (max 255 characters)`)
          }
          address[k] = v.trim()
        }
      }

      if (isString(body.firstName)) user.firstName = body.firstName.trim()
      if (isString(body.lastName)) user.lastName = body.lastName.trim()
      user.address = address
      saveDb()
      return HttpResponse.json({ coach: toCoach(user) })
    }),
  ),
]
