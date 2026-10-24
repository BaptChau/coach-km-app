// Seed data for the mock API: a coach and the president of a club in Bar-le-Duc (Meuse),
// with trips over the current and the previous year. The previous year is waived and has
// an issued tax receipt, so the waiver and admin screens have data.
//
// Accounts (password `password1` for both):
//   coach@club.fr      Jeanne Dupont  5655006101030  role coach
//   president@club.fr  Marc Lefèvre   5655006101031  role president
import { billedKm } from '@/domain'

import type { MockDb, MockReceipt, MockTrip, MockVehicle, MockWaiver, MockUser } from './db'
import { valueYear } from './valuation'

/** Bump when the seed changes: stored snapshots of an older version are dropped. */
export const SEED_VERSION = 1

export const SEED_PASSWORD = 'password1'
export const SEED_COACH_EMAIL = 'coach@club.fr'
export const SEED_PRESIDENT_EMAIL = 'president@club.fr'

/** [month 1-12, day, origin, destination, purpose, vehicle id, one-way km, round trip] */
type TripRow = [number, number, string, string, string, number, number, boolean]

const COACH = 1
const PRESIDENT = 2
const CLIO = 1
const MOTO = 2
const PEUGEOT = 3

const BAR = 'Bar-le-Duc'

// Jeanne Dupont, current year.
const coachCurrentYear: TripRow[] = [
  [1, 13, BAR, 'Verdun', 'Match U15 contre l’ES Verdun', CLIO, 56, true],
  [1, 27, BAR, 'Saint-Dizier', 'Entraînement commun U15', CLIO, 25, true],
  [2, 8, BAR, 'Commercy', 'Match U15 à Commercy', CLIO, 38, true],
  [2, 21, BAR, 'Ligny-en-Barrois', 'Entraînement délocalisé', MOTO, 16.5, true],
  [3, 15, BAR, 'Châlons-en-Champagne', 'Tournoi régional U15', CLIO, 85, true],
  [3, 29, BAR, 'Revigny-sur-Ornain', 'Match amical U13', MOTO, 17, true],
  [4, 12, BAR, 'Vitry-le-François', 'Match U15 à Vitry', CLIO, 52, true],
  [5, 3, BAR, 'Reims', 'Stage de la Ligue Grand Est', CLIO, 125, true],
  [5, 24, BAR, 'Saint-Mihiel', 'Match U15 à Saint-Mihiel', CLIO, 37, true],
  [6, 14, BAR, 'Épernay', 'Tournoi de fin de saison', CLIO, 115, true],
  [6, 28, 'Verdun', BAR, 'Retour du stage départemental', CLIO, 56, false],
  [9, 6, BAR, 'Sainte-Menehould', 'Reprise : match amical U15', CLIO, 50, true],
  [9, 20, BAR, 'Ligny-en-Barrois', 'Entraînement délocalisé', MOTO, 16.5, true],
  [10, 4, BAR, 'Verdun', 'Championnat U15, journée 2', CLIO, 56, true],
  [10, 18, BAR, 'Commercy', 'Réunion du comité départemental', MOTO, 38, true],
]

// Jeanne Dupont, previous year (waived, receipt issued).
const coachPreviousYear: TripRow[] = [
  [1, 21, BAR, 'Verdun', 'Match U15 contre l’ES Verdun', CLIO, 56, true],
  [2, 11, BAR, 'Saint-Dizier', 'Entraînement commun U15', CLIO, 25, true],
  [3, 9, BAR, 'Châlons-en-Champagne', 'Tournoi régional U15', CLIO, 85, true],
  [4, 6, BAR, 'Revigny-sur-Ornain', 'Match amical U13', MOTO, 17, true],
  [5, 18, BAR, 'Reims', 'Stage de la Ligue Grand Est', CLIO, 125, true],
  [6, 8, BAR, 'Épernay', 'Tournoi de fin de saison', CLIO, 115, true],
  [9, 14, BAR, 'Vitry-le-François', 'Match U15 à Vitry', CLIO, 52, true],
  [10, 5, BAR, 'Commercy', 'Match U15 à Commercy', CLIO, 38, true],
  [11, 16, BAR, 'Saint-Mihiel', 'Match U15 à Saint-Mihiel', MOTO, 37, true],
  [12, 7, BAR, 'Sainte-Menehould', 'Tournoi de Noël', CLIO, 50, true],
]

// Marc Lefèvre, current year.
const presidentCurrentYear: TripRow[] = [
  [2, 2, BAR, 'Verdun', 'Assemblée générale du district', PEUGEOT, 56, true],
  [4, 19, BAR, 'Nancy', 'Réunion de la Ligue Grand Est', PEUGEOT, 83, true],
  [6, 21, BAR, 'Châlons-en-Champagne', 'Tournoi régional : encadrement', PEUGEOT, 85, true],
  [9, 13, BAR, 'Saint-Dizier', 'Rencontre avec les partenaires', PEUGEOT, 25, true],
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * Builds the trips of one year. In the current year, a row dated after today is moved
 * back into the months already past, so the seed never contains future trips.
 */
function tripsOf(
  rows: TripRow[],
  userId: number,
  year: number,
  today: Date,
  firstId: number,
): MockTrip[] {
  const isCurrent = year === today.getFullYear()
  const curMonth = today.getMonth() + 1
  return rows.map(([month, day, origin, destination, purpose, vehicleId, km, roundTrip], i) => {
    let m = month
    let d = day
    if (isCurrent && m > curMonth) m = ((m - 1) % curMonth) + 1
    if (isCurrent && m === curMonth) d = Math.min(d, today.getDate())
    const date = isoDate(year, m, d)
    return {
      id: firstId + i,
      userId,
      clientId: null,
      date,
      origin,
      destination,
      purpose,
      vehicleId,
      distanceKm: km,
      roundTrip,
      billedKm: billedKm(km, roundTrip),
      createdAt: `${date}T19:30:00Z`,
    }
  })
}

/** A fresh copy of the seed, relative to `today` (the current and the previous year). */
export function seedDb(today: Date = new Date()): MockDb {
  const year = today.getFullYear()
  const prev = year - 1
  const created = `${prev - 1}-09-01T10:00:00Z`

  const users: MockUser[] = [
    {
      id: COACH,
      email: SEED_COACH_EMAIL,
      password: SEED_PASSWORD,
      registrationNumber: '5655006101030',
      firstName: 'Jeanne',
      lastName: 'Dupont',
      role: 'coach',
      address: { line: '12 rue de la Rochelle', postalCode: '55000', city: 'Bar-le-Duc' },
      createdAt: created,
    },
    {
      id: PRESIDENT,
      email: SEED_PRESIDENT_EMAIL,
      password: SEED_PASSWORD,
      registrationNumber: '5655006101031',
      firstName: 'Marc',
      lastName: 'Lefèvre',
      role: 'president',
      address: { line: '3 place Saint-Pierre', postalCode: '55000', city: 'Bar-le-Duc' },
      createdAt: created,
    },
  ]

  const vehicles: MockVehicle[] = [
    {
      id: CLIO,
      userId: COACH,
      label: 'Clio',
      type: 'car',
      fiscalHorsepower: 5,
      electric: false,
      createdAt: created,
    },
    {
      id: MOTO,
      userId: COACH,
      label: 'Moto électrique',
      type: 'motorcycle',
      fiscalHorsepower: 4,
      electric: true,
      createdAt: created,
    },
    {
      id: PEUGEOT,
      userId: PRESIDENT,
      label: 'Peugeot 308',
      type: 'car',
      fiscalHorsepower: 6,
      electric: false,
      createdAt: created,
    },
  ]

  const trips: MockTrip[] = []
  for (const [rows, userId, y] of [
    [coachPreviousYear, COACH, prev],
    [coachCurrentYear, COACH, year],
    [presidentCurrentYear, PRESIDENT, year],
  ] as const) {
    trips.push(...tripsOf(rows, userId, y, today, trips.length + 1))
  }

  const db: MockDb = { version: SEED_VERSION, users, vehicles, trips, waivers: [], receipts: [] }

  // The previous year: waived in January, receipt issued by the president a week later.
  const valuation = valueYear(db, COACH, prev)
  const waiver: MockWaiver = {
    userId: COACH,
    year: prev,
    km: valuation.totalKm,
    amountCents: valuation.totalCents,
    waivedAt: `${year}-01-10T18:00:00Z`,
  }
  const receipt: MockReceipt = {
    id: 1,
    seq: 1,
    year: prev,
    userId: COACH,
    amountCents: waiver.amountCents,
    waivedAt: waiver.waivedAt,
    issuedAt: `${year}-01-17T09:00:00Z`,
    issuedBy: PRESIDENT,
  }
  db.waivers.push(waiver)
  db.receipts.push(receipt)
  return db
}
