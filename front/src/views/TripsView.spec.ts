// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import * as api from '@/api'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { useTripsStore } from '@/stores/trips'
import { useUiStore } from '@/stores/ui'
import { networkError, vehicle } from '@/test/api-mock'
import { coachUser, freshPinia, mountInApp, signIn, testRouter } from '@/test/app-test'
import type { Trip, Waiver } from '@/types'
import TripsView from './TripsView.vue'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

const YEAR = 2025

function trip(id: number, date: string, km: number, roundTrip = true): Trip {
  return {
    id,
    clientId: null,
    date,
    origin: 'Lyon',
    destination: `Ville ${id}`,
    purpose: 'Match',
    vehicleId: 1,
    distanceKm: km,
    roundTrip,
    billedKm: roundTrip ? km * 2 : km,
    createdAt: `${date}T10:00:00Z`,
  }
}

const TRIPS = [
  trip(1, '2025-04-12', 10),
  trip(2, '2025-04-20', 5, false),
  trip(3, '2025-03-02', 20),
]

const waiver: Waiver = {
  year: YEAR,
  km: 100,
  amount: 63.6,
  waivedAt: '2026-01-10T10:00:00Z',
  receipt: null,
}

async function render(waivers: Waiver[] = []) {
  const pinia = freshPinia()
  signIn()
  useUiStore().year = YEAR
  vi.mocked(api.trips.listByYear).mockResolvedValue(TRIPS)
  vi.mocked(api.waivers.list).mockResolvedValue(waivers)
  vi.mocked(api.vehicles.list).mockResolvedValue([vehicle])
  vi.mocked(api.summary.get).mockRejectedValue(networkError())
  vi.mocked(api.rates.get).mockRejectedValue(networkError())
  const router = testRouter()
  await router.push('/trajets')
  const wrapper = mountInApp(TripsView, pinia, router, { attach: true })
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
  document.body.innerHTML = ''
})

describe('TripsView', () => {
  it('groups the trips by month, newest first, with the month km', async () => {
    const wrapper = (mounted = await render())
    const headers = wrapper.findAll('[data-testid="month-header"]').map((h) => h.text())
    expect(headers).toHaveLength(2)
    expect(headers[0]).toMatch(/avril 2025\s*25\skm/)
    expect(headers[1]).toMatch(/mars 2025\s*40\skm/)
    const april = wrapper.findAll('[data-testid="month-group"]')[0]!
    const items = april.findAll('[data-testid="trip-item"]')
    expect(items.map((i) => i.text().includes('Ville 2'))).toEqual([true, false])
    expect(items[0]!.find('[data-testid="chip-ar"]').exists()).toBe(false)
    expect(items[1]!.find('[data-testid="chip-ar"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Lyon → Ville 1')
    expect(wrapper.find('[data-testid="fab"]').exists()).toBe(true)
  })

  it('shows the pending chip on a trip waiting for the network', async () => {
    const wrapper = (mounted = await render())
    useTripsStore().queue.push({
      kind: 'update',
      key: 'k1',
      coachId: coachUser.id,
      queuedAt: '2025-04-12T10:00:00Z',
      tripId: 3,
      patch: {},
    })
    await flushPromises()
    const pending = wrapper.findAll('[data-testid="chip-pending"]')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.text()).toBe('En attente de synchronisation')
  })

  it('a waived year is read-only: banner, no FAB, no edit, no delete', async () => {
    const wrapper = (mounted = await render([waiver]))
    expect(wrapper.find('[data-testid="locked-banner"]').text()).toContain(
      'Année 2025 clôturée : vous avez renoncé au remboursement.',
    )
    expect(wrapper.find('[data-testid="fab"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="chip-locked"]')).toHaveLength(3)

    await wrapper.find('[data-testid="trip-item"]').trigger('click')
    await flushPromises()
    expect(new DOMWrapper(document.body).find('form').exists()).toBe(false)

    await wrapper.find('[data-testid="trip-menu"]').trigger('click')
    await flushPromises()
    const body = new DOMWrapper(document.body)
    expect(body.find('[data-testid="trip-repeat"]').exists()).toBe(true)
    expect(body.find('[data-testid="trip-delete"]').exists()).toBe(false)
  })

  it('deletes without a dialog and "Annuler" recreates the trip', async () => {
    vi.mocked(api.trips.remove).mockResolvedValue(undefined)
    vi.mocked(api.trips.create).mockImplementation(async (i) => ({
      ...TRIPS[0]!,
      ...i,
      id: 99,
      clientId: i.clientId ?? null,
    }))
    const wrapper = (mounted = await render())
    await wrapper.find('[data-testid="trip-menu"]').trigger('click')
    await flushPromises()
    await new DOMWrapper(document.body).find('[data-testid="trip-delete"]').trigger('click')
    await flushPromises()
    expect(api.trips.remove).toHaveBeenCalledWith(2)
    const ui = useUiStore()
    expect(ui.current?.message).toBe('Trajet supprimé')
    await ui.runAction(ui.current!.id)
    expect(api.trips.create).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2025-04-20', destination: 'Ville 2', distanceKm: 5 }),
    )
  })

  it('shows an empty state with an action', async () => {
    vi.mocked(api.trips.listByYear).mockResolvedValue([])
    const pinia = freshPinia()
    signIn()
    useUiStore().year = YEAR
    vi.mocked(api.summary.get).mockRejectedValue(networkError())
    vi.mocked(api.rates.get).mockRejectedValue(networkError())
    vi.mocked(api.vehicles.list).mockResolvedValue([vehicle])
    const router = testRouter()
    await router.push('/trajets')
    const wrapper = (mounted = mountInApp(TripsView, pinia, router, { attach: true }))
    await flushPromises()
    expect(wrapper.find('[data-testid="empty-state"]').text()).toContain('Aucun trajet en 2025.')
    expect(wrapper.text()).toContain('Ajouter un trajet')
  })
})
