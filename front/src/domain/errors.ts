// The Go API answers `{ error }` in English (api/API.md). This is the one place that turns
// those messages (and network failures) into plain French for the coach, and tells which
// form field they concern so the message can go under it.
//
// No runtime import of `@/api`: the error is recognised by shape, so this stays a pure module.
import type { ApiRequestError } from '@/api'

/** Form fields an API message can name (the JSON field names). */
export type ErrorField =
  | 'email'
  | 'registrationNumber'
  | 'firstName'
  | 'lastName'
  | 'password'
  | 'label'
  | 'type'
  | 'fiscalHorsepower'
  | 'electric'
  | 'vehicleId'
  | 'date'
  | 'origin'
  | 'destination'
  | 'purpose'
  | 'distanceKm'
  | 'address'

export interface DescribedError {
  /** French message for the coach. */
  message: string
  /** The form field it concerns, when the API names one. */
  field: ErrorField | null
}

interface Mapping {
  /** Matched against the start of the server message (case-insensitive). */
  starts: string
  message: string
  field?: ErrorField
}

/** English API messages (api/ handlers and the dev mocks) → French. Order matters: first match wins. */
export const API_MESSAGES: readonly Mapping[] = [
  // Auth and profile
  { starts: 'invalid email or password', message: 'E-mail ou mot de passe incorrect.' },
  { starts: 'email already registered', message: 'Cet e-mail est déjà inscrit', field: 'email' },
  { starts: 'email is invalid', message: 'Cet e-mail ne semble pas valide', field: 'email' },
  {
    starts: 'registrationNumber already registered',
    message: 'Ce numéro de licence est déjà inscrit',
    field: 'registrationNumber',
  },
  {
    starts: 'registrationNumber',
    message: '13 chiffres, commençant par 5655006',
    field: 'registrationNumber',
  },
  {
    starts: 'firstName',
    message: 'Indiquez votre prénom (100 caractères max.)',
    field: 'firstName',
  },
  { starts: 'lastName', message: 'Indiquez votre nom (100 caractères max.)', field: 'lastName' },
  { starts: 'password', message: 'Entre 8 et 72 caractères', field: 'password' },
  { starts: 'address', message: 'Vérifiez votre adresse postale', field: 'address' },
  // Vehicles
  {
    starts: 'vehicle is used by trips',
    message:
      'Ce véhicule est utilisé par des trajets : supprimez ces trajets ou changez leur véhicule avant de le supprimer.',
  },
  {
    starts: 'vehicle is used in a year whose reimbursement was waived',
    message:
      'Ce véhicule a des trajets dans une année clôturée (renonciation au remboursement) : seul son libellé peut encore changer.',
  },
  { starts: 'vehicle not found', message: 'Ce véhicule n’existe plus.' },
  { starts: 'label', message: 'Indiquez un libellé (100 caractères max.)', field: 'label' },
  { starts: 'type must be', message: 'Choisissez le type de véhicule', field: 'type' },
  {
    starts: 'fiscalHorsepower',
    message: 'Indiquez la puissance fiscale (CV)',
    field: 'fiscalHorsepower',
  },
  { starts: 'electric', message: 'Indiquez si le véhicule est électrique', field: 'electric' },
  // Trips
  {
    starts: 'vehicleId must be one of your vehicles',
    message: 'Choisissez un de vos véhicules',
    field: 'vehicleId',
  },
  { starts: 'vehicleId', message: 'Choisissez un véhicule', field: 'vehicleId' },
  { starts: 'date', message: 'Indiquez une date valide', field: 'date' },
  { starts: 'origin', message: 'Indiquez le lieu de départ', field: 'origin' },
  { starts: 'destination', message: 'Indiquez le lieu d’arrivée', field: 'destination' },
  { starts: 'purpose', message: 'Indiquez le motif du trajet', field: 'purpose' },
  {
    starts: 'distanceKm',
    message: 'Indiquez une distance entre 0 et 100 000 km',
    field: 'distanceKm',
  },
  { starts: 'trip not found', message: 'Ce trajet n’existe plus.' },
  {
    starts: "this year's reimbursement was waived",
    message:
      'Année clôturée : vous avez renoncé au remboursement, ses trajets ne peuvent plus changer.',
  },
  // Waivers and receipts
  {
    starts: 'set your postal address',
    message:
      'Renseignez d’abord votre adresse postale dans votre profil : elle figure sur le reçu fiscal.',
  },
  {
    starts: 'no mileage to waive',
    message: 'Aucun kilomètre enregistré cette année : rien à déclarer.',
  },
  {
    starts: 'reimbursement for this year is already waived',
    message: 'Vous avez déjà renoncé au remboursement pour cette année.',
  },
  {
    starts: 'a tax receipt was already issued for this year',
    message:
      'Le reçu fiscal de cette année est déjà émis : la renonciation ne peut plus être annulée.',
  },
  {
    starts: 'no waiver for this year',
    message: 'Aucune renonciation enregistrée pour cette année.',
  },
  {
    starts: 'this coach has not waived reimbursement',
    message: 'Ce coach n’a pas renoncé au remboursement pour cette année.',
  },
  {
    starts: 'a receipt was already issued for this coach',
    message: 'Le reçu de ce coach est déjà émis pour cette année.',
  },
  {
    starts: 'association details are not configured',
    message:
      'Les informations de l’association ne sont pas configurées sur le serveur : contactez l’administrateur.',
  },
  { starts: 'receipt not found', message: 'Ce reçu est introuvable.' },
  {
    starts: 'year must be a past or current year',
    message: 'Choisissez une année passée ou en cours.',
  },
  { starts: 'invalid year', message: 'Année invalide.' },
  { starts: 'year must be', message: 'Année invalide.' },
  { starts: 'president only', message: 'Action réservée au président.' },
  { starts: 'format must be', message: 'Format d’export inconnu.' },
]

export const GENERIC_ERROR = 'Une erreur est survenue. Réessayez dans un instant.'
export const NETWORK_ERROR = 'Pas de connexion : réessayez quand le réseau revient.'

type ErrorLike = Pick<ApiRequestError, 'status' | 'serverMessage' | 'message'> & {
  kind?: string
}

function asApiError(e: unknown): ErrorLike | null {
  if (!(e instanceof Error) || e.name !== 'ApiRequestError') return null
  return e as unknown as ErrorLike
}

/** French text already (e.g. the trips store's "Année 2025 clôturée…"): shown as is. */
function looksFrench(text: string): boolean {
  return /[àâçéèêëîïôûùüœ’]/i.test(text) || /^Année\s/.test(text)
}

/** Turns any error thrown by the API layer or a store into a French message (+ its field). */
export function describeError(e: unknown, fallback: string = GENERIC_ERROR): DescribedError {
  const api = asApiError(e)
  if (!api) return { message: fallback, field: null }
  if (api.kind === 'network' || api.kind === 'timeout')
    return { message: NETWORK_ERROR, field: null }
  if (api.kind === 'canceled') return { message: fallback, field: null }

  const raw = (api.serverMessage ?? '').trim()
  if (raw) {
    const lower = raw.toLowerCase()
    const hit = API_MESSAGES.find((m) => lower.startsWith(m.starts.toLowerCase()))
    if (hit) return { message: hit.message, field: hit.field ?? null }
    if (looksFrench(raw)) return { message: raw, field: null }
  }

  switch (api.status) {
    case 401:
      return { message: 'Session expirée : reconnectez-vous.', field: null }
    case 403:
      return { message: 'Action réservée au président.', field: null }
    case 404:
      return { message: 'Élément introuvable : il a peut-être été supprimé.', field: null }
    case 409:
      return {
        message: 'Action impossible : les données ont changé. Rechargez la page.',
        field: null,
      }
    case 400:
      return { message: 'Vérifiez les informations saisies.', field: null }
  }
  if (api.status != null && api.status >= 500) {
    return { message: 'Le serveur rencontre un problème. Réessayez plus tard.', field: null }
  }
  return { message: fallback, field: null }
}

/** Shortcut: the French message only. */
export function errorMessage(e: unknown, fallback?: string): string {
  return describeError(e, fallback).message
}
