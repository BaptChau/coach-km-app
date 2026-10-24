// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import * as api from '@/api'
import { flushPromises } from '@vue/test-utils'
import { useUiStore } from '@/stores/ui'
import { networkError, vehicle } from '@/test/api-mock'
import { freshPinia, mountInApp, signIn, testRouter } from '@/test/app-test'
import type { MonthTotal, Summary, Trip, Waiver } from '@/types'
import HomeView from './HomeView.vue'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

// A past year: no "current month" highlight, and the export nudge applies.
const YEAR = 2025

function months(values: Partial<Record<number, [km: number, amount: number]>>): MonthTotal[] {
  return Array.from({ length: 12 }, (_, i) => {
    const [km, amount] = values[i + 1] ?? [0, 0]
    return { month: i + 1, km, amount }
  })
}

const summary: Summary = {
  year: YEAR,
  baremeSource: 'Barème 2025 (API)',
  totalKm: 1200,
  totalAmount: 763.2,
  byMonth: months({ 3: [300, 190.8], 4: [900, 572.4] }),
  byVehicle: [
    {
      vehicleId: 1,
      label: 'Clio',
      type: 'car',
      fiscalHorsepower: 5,
      electric: false,
      km: 1200,
      amount: 763.2,
    },
  ],
}

const emptySummary: Summary = {
  ...summary,
  totalKm: 0,
  totalAmount: 0,
  byMonth: months({}),
  byVehicle: [],
}

function trip(id: number, date: string): Trip {
  return {
    id,
    clientId: null,
    date,
    origin: 'Lyon',
    destination: `Ville ${id}`,
    purpose: 'Match',
    vehicleId: 1,
    distanceKm: 100,
    roundTrip: true,
    billedKm: 200,
    createdAt: `${date}T10:00:00Z`,
  }
}

async function render(data: Summary, trips: Trip[], waivers: Waiver[] = []) {
  const pinia = freshPinia()
  signIn()
  useUiStore().year = YEAR
  vi.mocked(api.summary.get).mockResolvedValue(data)
  vi.mocked(api.trips.listByYear).mockResolvedValue(trips)
  vi.mocked(api.waivers.list).mockResolvedValue(waivers)
  vi.mocked(api.vehicles.list).mockResolvedValue([vehicle])
  vi.mocked(api.rates.get).mockRejectedValue(networkError())
  const router = testRouter()
  await router.push('/')
  const wrapper = mountInApp(HomeView, pinia, router)
  await flushPromises()
  return wrapper
}

let mounted: { unmount: () => void } | null = null
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('HomeView', () => {
  it('shows the year’s amount and km in the hero, from /summary', async () => {
    const wrapper = (mounted = await render(summary, []))
    expect(api.summary.get).toHaveBeenCalledWith(YEAR)
    expect(wrapper.find('[data-testid="hero"]').text()).toContain(`Vos frais kilométriques ${YEAR}`)
    expect(wrapper.find('[data-testid="hero-amount"]').text()).toMatch(/^763,20\s€$/)
    expect(wrapper.find('[data-testid="hero-km"]').text()).toMatch(/^1\s200\skm$/)
    expect(wrapper.find('[data-testid="by-vehicle"]').text()).toContain('Clio')
    expect(wrapper.find('[data-testid="export-cta"]').exists()).toBe(true)
  })

  it('draws one bar per month, scaled on the busiest month, with a French label', async () => {
    const wrapper = (mounted = await render(summary, []))
    const bars = wrapper.findAll('[data-testid="chart-bar"]')
    expect(bars).toHaveLength(12)
    const heights = bars.map((b) => (b.find('.chart__bar').element as HTMLElement).style.height)
    expect(heights[3]).toBe('100%') // April, the busiest
    expect(parseFloat(heights[2]!)).toBeCloseTo(33.33, 1) // March: 300 / 900
    expect(heights[0]).toBe('0%')
    expect(bars[3]!.attributes('aria-label')).toMatch(/^avril : 900\skm, 572,40\s€$/)

    // No month is shown until one is tapped (past year).
    const details = wrapper.find('[data-testid="chart-details"]')
    expect(details.text()).toContain('Touchez un mois')
    await bars[2]!.trigger('click')
    expect(bars[2]!.attributes('aria-pressed')).toBe('true')
    expect(details.text()).toMatch(/mars\s*·\s*300\skm\s*·\s*190,80\s€/)
    await bars[2]!.trigger('click')
    expect(details.text()).toContain('Touchez un mois')
  })

  it('offers the same data as an accessible table', async () => {
    const wrapper = (mounted = await render(summary, []))
    const table = wrapper.find('table')
    expect(table.find('caption').text()).toMatch(/Kilomètres et montants par mois en\s+2025/)
    expect(table.findAll('thead th').map((th) => th.attributes('scope'))).toEqual([
      'col',
      'col',
      'col',
    ])
    const rows = table.findAll('tbody tr')
    expect(rows).toHaveLength(12)
    const april = rows[3]!
    expect(april.find('th[scope="row"]').text()).toBe('avril')
    expect(april.findAll('td').map((td) => td.text())).toEqual([
      expect.stringMatching(/^900\skm$/),
      expect.stringMatching(/^572,40\s€$/),
    ])
    expect(rows[0]!.findAll('td').map((td) => td.text())).toEqual([
      expect.stringMatching(/^0\skm$/),
      expect.stringMatching(/^0,00\s€$/),
    ])
  })

  it('lists the last three trips, newest first', async () => {
    const trips = [
      trip(1, '2025-01-10'),
      trip(2, '2025-04-02'),
      trip(3, '2025-03-15'),
      trip(4, '2025-02-01'),
    ]
    const wrapper = (mounted = await render(summary, trips))
    const text = wrapper.find('[data-testid="last-trips"]').text()
    expect(text).toContain('Ville 2')
    expect(text).toContain('Ville 3')
    expect(text).toContain('Ville 4')
    expect(text).not.toContain('Ville 1')
    expect(text.indexOf('Ville 2')).toBeLessThan(text.indexOf('Ville 3'))
  })

  it('an empty year: zero amount, flat chart, empty state, no export nudge', async () => {
    const wrapper = (mounted = await render(emptySummary, []))
    expect(wrapper.find('[data-testid="hero-amount"]').text()).toMatch(/^0,00\s€$/)
    expect(wrapper.find('[data-testid="hero-km"]').text()).toMatch(/^0\skm$/)
    const heights = wrapper
      .findAll('.chart__bar')
      .map((b) => (b.element as HTMLElement).style.height)
    expect(heights).toEqual(Array(12).fill('0%'))
    expect(wrapper.text()).toContain(`Aucun trajet en ${YEAR}.`)
    expect(wrapper.text()).toContain('Ajouter un trajet')
    expect(wrapper.find('[data-testid="last-trips"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="by-vehicle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="export-cta"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="fab"]').exists()).toBe(true)
  })

  it('a waived year: no FAB and no export nudge', async () => {
    const waiver: Waiver = {
      year: YEAR,
      km: 1200,
      amount: 763.2,
      waivedAt: '2026-01-05T00:00:00Z',
      receipt: null,
    }
    const wrapper = (mounted = await render(summary, [trip(1, '2025-04-02')], [waiver]))
    expect(wrapper.find('[data-testid="fab"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="export-cta"]').exists()).toBe(false)
  })
})
