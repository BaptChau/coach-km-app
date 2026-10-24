#!/usr/bin/env node
// Fills a development API with dummy data, through the API itself (nothing in
// api/ is touched). Safe to run again: accounts, vehicles, trips, waivers and
// receipts that already exist are reused, never duplicated.
//
//   node scripts/seed-dev.mjs                 # Docker stack (http://localhost:$HTTP_PORT/api)
//   node scripts/seed-dev.mjs --target local  # `go run ./cmd/server` on http://localhost:3000
//
// Options (environment):
//   SEED_API_URL  base URL of the API, overrides the target's default
//   HTTP_PORT     port of the Docker stack (default 8080, read from .env too)
//   DB_PATH       database of the local API, for the president role (default api/dev.db)
//
// Never point this at production: it creates accounts with a known password.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PASSWORD = 'password1'

// ---- Data ------------------------------------------------------------------
// The coach and the president are the same as the front's mock API
// (front/src/mocks/seed.ts), so both backends show the same screens.

const BAR = 'Bar-le-Duc'

/** [month, day, origin, destination, purpose, vehicle label, one-way km, round trip] */
const ACCOUNTS = [
  {
    email: 'coach@club.fr',
    registrationNumber: '5655006101030',
    firstName: 'Jeanne',
    lastName: 'Dupont',
    address: { line: '12 rue de la Rochelle', postalCode: '55000', city: BAR },
    vehicles: [
      { label: 'Clio', type: 'car', fiscalHorsepower: 5, electric: false },
      { label: 'Moto électrique', type: 'motorcycle', fiscalHorsepower: 4, electric: true },
    ],
    // Previous year: waived, and the president issues the receipt (status "Émis").
    waivePrevious: true,
    receipt: true,
    current: [
      [1, 13, BAR, 'Verdun', 'Match U15 contre l’ES Verdun', 'Clio', 56, true],
      [1, 27, BAR, 'Saint-Dizier', 'Entraînement commun U15', 'Clio', 25, true],
      [2, 8, BAR, 'Commercy', 'Match U15 à Commercy', 'Clio', 38, true],
      [2, 21, BAR, 'Ligny-en-Barrois', 'Entraînement délocalisé', 'Moto électrique', 16.5, true],
      [3, 15, BAR, 'Châlons-en-Champagne', 'Tournoi régional U15', 'Clio', 85, true],
      [3, 29, BAR, 'Revigny-sur-Ornain', 'Match amical U13', 'Moto électrique', 17, true],
      [4, 12, BAR, 'Vitry-le-François', 'Match U15 à Vitry', 'Clio', 52, true],
      [5, 3, BAR, 'Reims', 'Stage de la Ligue Grand Est', 'Clio', 125, true],
      [5, 24, BAR, 'Saint-Mihiel', 'Match U15 à Saint-Mihiel', 'Clio', 37, true],
      [6, 14, BAR, 'Épernay', 'Tournoi de fin de saison', 'Clio', 115, true],
      [6, 28, 'Verdun', BAR, 'Retour du stage départemental', 'Clio', 56, false],
      [9, 6, BAR, 'Sainte-Menehould', 'Reprise : match amical U15', 'Clio', 50, true],
      [9, 20, BAR, 'Ligny-en-Barrois', 'Entraînement délocalisé', 'Moto électrique', 16.5, true],
      [10, 4, BAR, 'Verdun', 'Championnat U15, journée 2', 'Clio', 56, true],
      [10, 18, BAR, 'Commercy', 'Réunion du comité départemental', 'Moto électrique', 38, true],
    ],
    previous: [
      [1, 21, BAR, 'Verdun', 'Match U15 contre l’ES Verdun', 'Clio', 56, true],
      [2, 11, BAR, 'Saint-Dizier', 'Entraînement commun U15', 'Clio', 25, true],
      [3, 9, BAR, 'Châlons-en-Champagne', 'Tournoi régional U15', 'Clio', 85, true],
      [4, 6, BAR, 'Revigny-sur-Ornain', 'Match amical U13', 'Moto électrique', 17, true],
      [5, 18, BAR, 'Reims', 'Stage de la Ligue Grand Est', 'Clio', 125, true],
      [6, 8, BAR, 'Épernay', 'Tournoi de fin de saison', 'Clio', 115, true],
      [9, 14, BAR, 'Vitry-le-François', 'Match U15 à Vitry', 'Clio', 52, true],
      [10, 5, BAR, 'Commercy', 'Match U15 à Commercy', 'Clio', 38, true],
      [11, 16, BAR, 'Saint-Mihiel', 'Match U15 à Saint-Mihiel', 'Moto électrique', 37, true],
      [12, 7, BAR, 'Sainte-Menehould', 'Tournoi de Noël', 'Clio', 50, true],
    ],
  },
  {
    email: 'president@club.fr',
    registrationNumber: '5655006101031',
    firstName: 'Marc',
    lastName: 'Lefèvre',
    president: true,
    address: { line: '3 place Saint-Pierre', postalCode: '55000', city: BAR },
    vehicles: [{ label: 'Peugeot 308', type: 'car', fiscalHorsepower: 6, electric: false }],
    current: [
      [2, 2, BAR, 'Verdun', 'Assemblée générale du district', 'Peugeot 308', 56, true],
      [4, 19, BAR, 'Nancy', 'Réunion de la Ligue Grand Est', 'Peugeot 308', 83, true],
      [6, 21, BAR, 'Châlons-en-Champagne', 'Tournoi régional : encadrement', 'Peugeot 308', 85, true],
      [9, 13, BAR, 'Saint-Dizier', 'Rencontre avec les partenaires', 'Peugeot 308', 25, true],
    ],
    previous: [],
  },
  {
    // Previous year waived, no receipt yet: "À émettre" in the admin screen.
    email: 'paul.martin@club.fr',
    registrationNumber: '5655006101032',
    firstName: 'Paul',
    lastName: 'Martin',
    address: { line: '8 rue du Port', postalCode: '55300', city: 'Saint-Mihiel' },
    vehicles: [
      { label: 'Kangoo', type: 'car', fiscalHorsepower: 4, electric: false },
      { label: 'Scooter', type: 'moped', fiscalHorsepower: null, electric: false },
    ],
    waivePrevious: true,
    current: [
      [1, 20, 'Saint-Mihiel', 'Bar-le-Duc', 'Entraînement seniors', 'Kangoo', 37, true],
      [3, 8, 'Saint-Mihiel', 'Commercy', 'Match seniors à Commercy', 'Kangoo', 18, true],
      [5, 17, 'Saint-Mihiel', 'Verdun', 'Match seniors à Verdun', 'Kangoo', 35, true],
      [9, 27, 'Saint-Mihiel', 'Chauvoncourt', 'Tournoi local : installation', 'Scooter', 3, true],
    ],
    previous: [
      [2, 4, 'Saint-Mihiel', 'Bar-le-Duc', 'Entraînement seniors', 'Kangoo', 37, true],
      [4, 15, 'Saint-Mihiel', 'Toul', 'Match seniors à Toul', 'Kangoo', 42, true],
      [10, 10, 'Saint-Mihiel', 'Commercy', 'Match seniors à Commercy', 'Scooter', 18, true],
    ],
  },
  {
    // Trips but no waiver: "Sans renonciation". No address yet, so the export
    // screen asks for it before the waiver.
    email: 'sophie.bernard@club.fr',
    registrationNumber: '5655006101033',
    firstName: 'Sophie',
    lastName: 'Bernard',
    vehicles: [{ label: 'Zoé', type: 'car', fiscalHorsepower: 3, electric: true }],
    current: [
      [2, 15, 'Ligny-en-Barrois', 'Bar-le-Duc', 'Entraînement U11', 'Zoé', 16, true],
      [4, 5, 'Ligny-en-Barrois', 'Saint-Dizier', 'Plateau U11', 'Zoé', 30, true],
      [10, 3, 'Ligny-en-Barrois', 'Bar-le-Duc', 'Entraînement U11', 'Zoé', 16, true],
    ],
    previous: [
      [11, 22, 'Ligny-en-Barrois', 'Vitry-le-François', 'Plateau U11', 'Zoé', 45, true],
    ],
  },
]

// ---- Options ---------------------------------------------------------------

const target = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : 'docker'
if (!['docker', 'local'].includes(target)) {
  fail(`unknown --target "${target}" (docker or local)`)
}

function dotenv(key) {
  const file = join(ROOT, '.env')
  if (!existsSync(file)) return undefined
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`))
  return line?.slice(key.length + 1).trim() || undefined
}

const API =
  process.env.SEED_API_URL ??
  (target === 'docker'
    ? `http://localhost:${process.env.HTTP_PORT ?? dotenv('HTTP_PORT') ?? 8080}/api`
    : 'http://localhost:3000')

// ---- HTTP ------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class HttpError extends Error {
  constructor(status, message) {
    super(`${status} ${message}`)
    this.status = status
  }
}

/** JSON request; waits and retries on 429 (nginx rate limits login to 10/min). */
async function api(method, path, { token, body } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetch(API + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (err) {
      fail(`cannot reach the API at ${API} (${err.cause?.code ?? err.message}). Is it running?`)
    }
    if (res.status === 429 && attempt < 20) {
      if (attempt === 0) process.stdout.write(' (rate limited, waiting)')
      await sleep(path.startsWith('/auth/') ? 7000 : 1000)
      continue
    }
    const text = await res.text()
    const data = text ? JSON.parse(text) : null
    if (!res.ok) throw new HttpError(res.status, data?.error ?? res.statusText)
    return { status: res.status, data }
  }
}

// ---- Steps -----------------------------------------------------------------

async function signIn(a) {
  try {
    const { data } = await api('POST', '/auth/login', {
      body: { email: a.email, password: PASSWORD },
    })
    return { ...data, created: false }
  } catch (err) {
    if (err.status !== 401) throw err
  }
  const { data } = await api('POST', '/auth/register', {
    body: {
      email: a.email,
      registrationNumber: a.registrationNumber,
      firstName: a.firstName,
      lastName: a.lastName,
      password: PASSWORD,
    },
  })
  return { ...data, created: true }
}

async function ensureVehicles(token, wanted) {
  const { data: existing } = await api('GET', '/vehicles', { token })
  const byLabel = new Map(existing.map((v) => [v.label, v]))
  for (const v of wanted) {
    if (!byLabel.has(v.label)) {
      const { data } = await api('POST', '/vehicles', { token, body: v })
      byLabel.set(v.label, data)
    }
  }
  return byLabel
}

/** Trips dated after today are moved back into past months, as in the mock seed. */
function dateOf(year, month, day, today) {
  let m = month
  let d = day
  if (year === today.getFullYear()) {
    const cur = today.getMonth() + 1
    if (m > cur) m = ((m - 1) % cur) + 1
    if (m === cur) d = Math.min(d, today.getDate())
  }
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Creates the trips of one year; a fixed clientId per row makes reruns no-ops. */
async function seedTrips(token, a, rows, year, vehicles, today) {
  let created = 0
  for (const [i, [month, day, origin, destination, purpose, label, km, roundTrip]] of rows.entries()) {
    const { status } = await api('POST', '/trips', {
      token,
      body: {
        clientId: `seed-${a.registrationNumber}-${year}-${i}`,
        date: dateOf(year, month, day, today),
        origin,
        destination,
        purpose,
        vehicleId: vehicles.get(label).id,
        distanceKm: km,
        roundTrip,
      },
    })
    if (status === 201) created++
  }
  return created
}

function promoteToPresident(email) {
  const args =
    target === 'docker'
      ? ['docker', ['compose', 'exec', '-T', 'api', '/app/admin', 'set-role', email, 'president'], ROOT]
      : [
          'go',
          ['run', './cmd/admin', 'set-role', email, 'president'],
          join(ROOT, 'api'),
          { DB_PATH: process.env.DB_PATH ?? './dev.db' },
        ]
  const [cmd, argv, cwd, env] = args
  try {
    execFileSync(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' })
    return true
  } catch (err) {
    warn(`could not set the president role (${String(err.stderr || err.message).trim()})`)
    warn(`run it yourself: ${cmd} ${argv.join(' ')}`)
    return false
  }
}

// ---- Main ------------------------------------------------------------------

function log(msg) {
  process.stdout.write(msg)
}
function warn(msg) {
  console.warn(`  ! ${msg}`)
}
function fail(msg) {
  console.error(`seed-dev: ${msg}`)
  process.exit(1)
}

const today = new Date()
const year = today.getFullYear()
const prev = year - 1
const tokens = new Map()

console.log(`Seeding ${API} (target: ${target})`)

for (const a of ACCOUNTS) {
  log(`- ${a.firstName} ${a.lastName} <${a.email}>`)
  const { token, coach, created } = await signIn(a)
  tokens.set(a.email, { token, coach })
  if (a.address) await api('PATCH', '/auth/me', { token, body: { address: a.address } })
  const vehicles = await ensureVehicles(token, a.vehicles)

  const { data: waivers } = await api('GET', '/waivers', { token })
  const waived = new Set(waivers.map((w) => w.year))
  let trips = await seedTrips(token, a, a.current, year, vehicles, today)
  // A waived year is locked: its trips are already there from an earlier run.
  if (!waived.has(prev)) trips += await seedTrips(token, a, a.previous, prev, vehicles, today)
  if (a.waivePrevious && !waived.has(prev)) await api('POST', '/waivers', { token, body: { year: prev } })

  log(`${created ? ' created' : ' exists'}, ${trips} new trip(s)\n`)
}

const president = ACCOUNTS.find((a) => a.president)
if (promoteToPresident(president.email)) {
  // The role is read from the database on each request: the token stays valid.
  const { token } = tokens.get(president.email)
  for (const a of ACCOUNTS.filter((x) => x.receipt)) {
    const coachId = tokens.get(a.email).coach.id
    try {
      await api('POST', '/admin/receipts', { token, body: { coachId, year: prev } })
      console.log(`- receipt issued for ${a.firstName} ${a.lastName} (${prev})`)
    } catch (err) {
      if (err.status === 409) console.log(`- receipt for ${a.firstName} ${a.lastName} (${prev}) already issued`)
      else if (err.status === 503)
        warn('receipt not issued: set the ASSOCIATION_* variables (ASSOCIATION_OBJECT included) and rerun')
      else throw err
    }
  }
}

console.log(`\nDone. Every account uses the password "${PASSWORD}":`)
for (const a of ACCOUNTS) {
  console.log(`  ${a.email.padEnd(24)} ${a.president ? 'president' : 'coach'}`)
}
