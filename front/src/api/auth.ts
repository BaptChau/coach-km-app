import type { AuthResponse, Coach, LoginInput, ProfilePatch, RegisterInput } from '@/types'

import { http } from './client'

/** `POST /auth/register` → 201 `{ token, coach }`. 409 when the e-mail or registration number is taken. */
export async function register(input: RegisterInput): Promise<AuthResponse> {
  const { data } = await http.post<AuthResponse>('/auth/register', input)
  return data
}

/** `POST /auth/login` → `{ token, coach }`. 401 `invalid email or password` on bad credentials. */
export async function login(input: LoginInput): Promise<AuthResponse> {
  const { data } = await http.post<AuthResponse>('/auth/login', input)
  return data
}

/** `GET /auth/me` → the authenticated coach. */
export async function me(): Promise<Coach> {
  const { data } = await http.get<{ coach: Coach }>('/auth/me')
  return data.coach
}

/** `PATCH /auth/me` → the updated coach (names and postal address). */
export async function updateMe(patch: ProfilePatch): Promise<Coach> {
  const { data } = await http.patch<{ coach: Coach }>('/auth/me', patch)
  return data.coach
}
