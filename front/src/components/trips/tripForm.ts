// Pure helpers of the trip form.
import { billedKm, formatDecimal, formatKm } from '@/domain'

/** Purposes offered as one-tap suggestions (UX.md section 5). */
export const PURPOSE_SUGGESTIONS = ['Match', 'Entraînement', 'Tournoi', 'Réunion'] as const

export const MAX_DISTANCE_KM = 100_000

/** "Km retenus : 2 × 32,5 = 65 km" (round trip) or "Km retenus : 32,5 km". */
export function kmLine(distanceKm: number, roundTrip: boolean): string {
  const total = formatKm(billedKm(distanceKm, roundTrip))
  return roundTrip
    ? `Km retenus : 2 × ${formatDecimal(distanceKm)} = ${total}`
    : `Km retenus : ${total}`
}
