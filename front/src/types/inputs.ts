// Request bodies and responses for api/API.md. The API rejects unknown fields with
// 400, so these types list exactly what each endpoint accepts.
import type { Address, Coach, IsoDate, VehicleType } from './models'

export interface RegisterInput {
  email: string
  /** 13 digits starting with 5655006; spaces are removed by the API. */
  registrationNumber: string
  firstName: string
  lastName: string
  password: string
}

export interface LoginInput {
  email: string
  password: string
}

/** `POST /auth/register` and `POST /auth/login` response. */
export interface AuthResponse {
  token: string
  coach: Coach
}

export interface ProfilePatch {
  firstName?: string
  lastName?: string
  address?: Partial<Address>
}

export interface VehicleInput {
  label: string
  type: VehicleType
  /** Required for car and motorcycle; ignored (send null) for a moped. */
  fiscalHorsepower: number | null
  electric: boolean
}

/** Changing type, fiscalHorsepower or electric returns 409 when the vehicle has trips in a waived year. */
export type VehiclePatch = Partial<VehicleInput>

export interface TripInput {
  /** Optional here: `trips.create` generates one when missing. */
  clientId?: string
  date: IsoDate
  origin: string
  destination: string
  purpose: string
  vehicleId: number
  /** One-way distance in km (> 0, ≤ 100000). */
  distanceKm: number
  roundTrip: boolean
}

/** Any subset of the create fields, except `clientId`. */
export type TripPatch = Partial<Omit<TripInput, 'clientId'>>

/** Paging for `GET /trips`. */
export interface PageParams {
  /** Default 1000, max 1000. */
  limit?: number
  offset?: number
}

export interface WaiverInput {
  year: number
}

export interface IssueReceiptInput {
  coachId: number
  year: number
}

export type ExportFormat = 'pdf' | 'csv'
