// FALLBACK ONLY. A copy of the barème in api/internal/rates/rates.go (version fromYear 2022),
// for offline previews and the mock layer. The real values come from `GET /rates?year=`:
// never read this in components when the API answered, and update it when rates.go changes.
import type { Band, Bareme, Tier } from '@/types'

function carTiers(a: number, b: number, c: number, d: number): Tier[] {
  return [
    { upToKm: 5000, coef: a, constant: 0 },
    { upToKm: 20000, coef: b, constant: c },
    { coef: d, constant: 0 },
  ]
}

function twoWheelTiers(a: number, b: number, c: number, d: number): Tier[] {
  return [
    { upToKm: 3000, coef: a, constant: 0 },
    { upToKm: 6000, coef: b, constant: c },
    { coef: d, constant: 0 },
  ]
}

const car: Band[] = [
  { maxHp: 3, tiers: carTiers(0.529, 0.316, 1065, 0.37) },
  { minHp: 4, maxHp: 4, tiers: carTiers(0.606, 0.34, 1330, 0.407) },
  { minHp: 5, maxHp: 5, tiers: carTiers(0.636, 0.357, 1395, 0.427) },
  { minHp: 6, maxHp: 6, tiers: carTiers(0.665, 0.374, 1457, 0.447) },
  { minHp: 7, tiers: carTiers(0.697, 0.394, 1515, 0.47) },
]

const motorcycle: Band[] = [
  { maxHp: 2, tiers: twoWheelTiers(0.395, 0.099, 891, 0.248) },
  { minHp: 3, maxHp: 5, tiers: twoWheelTiers(0.468, 0.082, 1158, 0.275) },
  { minHp: 6, tiers: twoWheelTiers(0.606, 0.079, 1583, 0.343) },
]

const moped: Band[] = [{ tiers: twoWheelTiers(0.315, 0.079, 711, 0.198) }]

/** Fallback barème (arrêté du 27 mars 2023). Prefer the `/rates` response. */
export const FALLBACK_BAREME: Bareme = {
  fromYear: 2022,
  source:
    'Arrêté du 27 mars 2023 (barème des salariés, service-public.gouv.fr F1132, vérifié le 05/11/2024)',
  electricIncrease: 0.2,
  byType: { car, motorcycle, moped },
}
