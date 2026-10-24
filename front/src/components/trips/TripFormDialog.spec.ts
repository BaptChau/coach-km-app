// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import * as api from '@/api'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { todayIso } from '@/domain'
import { useTripsStore } from '@/stores/trips'
import { useUiStore } from '@/stores/ui'
import { useVehiclesStore } from '@/stores/vehicles'
import { httpError, networkError, serverTrip, tripInput, vehicle } from '@/test/api-mock'
import { freshPinia, mountInApp, signIn, testRouter } from '@/test/app-test'
import type { Trip } from '@/types'
import TripFormDialog from './TripFormDialog.vue'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

const YEAR = new Date().getFullYear()
const moto = { ...vehicle, id: 2, label: 'Moto', type: 'motorcycle' as const, fiscalHorsepower: 3 }

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 50,
    clientId: null,
    date: `${YEAR}-01-10`,
    origin: 'Lyon',
    destination: 'Villeurbanne',
    purpose: 'Entraînement',
    vehicleId: 1,
    distanceKm: 50,
    roundTrip: true,
    billedKm: 100,
    createdAt: `${YEAR}-01-10T10:00:00Z`,
    ...overrides,
  }
}

const body = () => new DOMWrapper(document.body)
const input = (id: string) => body().find(`[data-testid="${id}"] input`)

async function render(
  props: { mode?: 'create' | 'edit' | 'repeat'; trip?: Trip | null } = {},
  setup: { vehicles?: (typeof vehicle)[]; trips?: Trip[] } = {},
) {
  const pinia = freshPinia()
  signIn()
  useVehiclesStore().items = setup.vehicles ?? [vehicle]
  const trips = useTripsStore()
  trips.items = setup.trips ?? [trip()]
  trips.loadedYear = YEAR
  const router = testRouter()
  await router.push('/')
  const state = reactive({
    modelValue: true,
    mode: props.mode ?? 'create',
    trip: props.trip ?? null,
    'onUpdate:modelValue': (v: boolean) => (state.modelValue = v),
  })
  const wrapper = mountInApp(TripFormDialog, pinia, router, { props: state, attach: true })
  await flushPromises()
  return { wrapper, state }
}

async function submit() {
  await body().find('form').trigger('submit')
  await flushPromises()
}

let mounted: { unmount: () => void } | null = null
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(api.rates.get).mockRejectedValue(networkError()) // bundled barème
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('TripFormDialog', () => {
  it('pre-fills today, the last vehicle, the last origin and the round trip', async () => {
    const { wrapper } = await render(
      {},
      { vehicles: [vehicle, moto], trips: [trip({ vehicleId: 2, origin: 'Bron' })] },
    )
    mounted = wrapper
    expect((input('trip-date').element as HTMLInputElement).value).toBe(todayIso())
    expect(body().find('[data-testid="trip-vehicle"]').text()).toContain('Moto')
    expect((input('trip-origin').element as HTMLInputElement).value).toBe('Bron')
    expect((input('trip-destination').element as HTMLInputElement).value).toBe('')
    expect((input('trip-roundtrip').element as HTMLInputElement).checked).toBe(true)
    expect(input('trip-distance').attributes('inputmode')).toBe('decimal')
  })

  it('hides the vehicle select with one vehicle and offers to create one with none', async () => {
    const one = await render()
    mounted = one.wrapper
    expect(body().find('[data-testid="trip-vehicle"]').exists()).toBe(false)
    one.wrapper.unmount()
    document.body.innerHTML = ''

    const none = await render({}, { vehicles: [] })
    mounted = none.wrapper
    expect(body().find('[data-testid="no-vehicle"]').text()).toContain('Ajouter mon véhicule')
  })

  it('accepts a comma and shows the km and € preview lines live', async () => {
    const { wrapper } = await render()
    mounted = wrapper
    await input('trip-distance').setValue('32,5')
    expect(body().find('[data-testid="trip-km-line"]').text()).toMatch(
      /Km retenus : 2 × 32,5 = 65\skm/,
    )
    // Clio 5 CV with 100 km already: amount(165) − amount(100) = 65 × 0,636 = 41,34 €.
    expect(body().find('[data-testid="trip-euro-line"]').text()).toMatch(/≈ \+41,34\s€ sur l’année/)

    await input('trip-roundtrip').setValue(false)
    expect(body().find('[data-testid="trip-km-line"]').text()).toMatch(/Km retenus : 32,5\skm/)
    expect(body().find('[data-testid="trip-euro-line"]').text()).toMatch(/\+20,67\s€/)
  })

  it('validates in French and sends nothing', async () => {
    const { wrapper } = await render()
    mounted = wrapper
    await input('trip-distance').setValue('abc')
    await submit()
    const text = body().text()
    expect(text).toContain('Indiquez le lieu d’arrivée')
    expect(text).toContain('Indiquez le motif')
    expect(text).toContain('Indiquez un nombre de km')
    expect(api.trips.create).not.toHaveBeenCalled()
  })

  it('saves, closes and shows "Trajet enregistré" with an "Annuler" that deletes it', async () => {
    vi.mocked(api.trips.create).mockImplementation(async (i) => serverTrip(i, { id: 777 }))
    vi.mocked(api.trips.remove).mockResolvedValue(undefined)
    const { wrapper, state } = await render()
    mounted = wrapper
    await input('trip-destination').setValue('Bron')
    await body().find('[data-testid="purpose-Match"]').trigger('click')
    await input('trip-distance').setValue('12,5')
    await submit()

    expect(api.trips.create).toHaveBeenCalledWith(
      expect.objectContaining({
        date: todayIso(),
        origin: 'Lyon',
        destination: 'Bron',
        purpose: 'Match',
        vehicleId: 1,
        distanceKm: 12.5,
        roundTrip: true,
      }),
    )
    expect(state.modelValue).toBe(false)
    const ui = useUiStore()
    expect(ui.current?.message).toBe('Trajet enregistré')
    expect(ui.current?.action?.label).toBe('Annuler')
    await ui.runAction(ui.current!.id)
    expect(api.trips.remove).toHaveBeenCalledWith(777)
  })

  it('cannot be submitted twice', async () => {
    let resolve!: (t: Trip) => void
    vi.mocked(api.trips.create).mockReturnValue(new Promise((r) => (resolve = r)))
    const { wrapper } = await render()
    mounted = wrapper
    await input('trip-destination').setValue('Bron')
    await input('trip-distance').setValue('10')
    await body().find('[data-testid="purpose-Match"]').trigger('click')
    await submit()
    await submit()
    expect(api.trips.create).toHaveBeenCalledTimes(1)
    resolve(serverTrip({ ...tripInput, date: todayIso() }))
    await flushPromises()
  })

  it('keeps the form and puts the API error under its field', async () => {
    vi.mocked(api.trips.create).mockRejectedValue(
      httpError(400, 'distanceKm must be > 0 and <= 100000'),
    )
    const { wrapper, state } = await render()
    mounted = wrapper
    await input('trip-destination').setValue('Bron')
    await body().find('[data-testid="purpose-Match"]').trigger('click')
    await input('trip-distance').setValue('12')
    await submit()
    expect(state.modelValue).toBe(true)
    expect(body().find('[data-testid="trip-distance"]').text()).toContain(
      'Indiquez une distance entre 0 et 100 000 km',
    )
    expect((input('trip-destination').element as HTMLInputElement).value).toBe('Bron')
  })

  it('"Refaire" copies everything but the date', async () => {
    const past = trip({ destination: 'Givors', purpose: 'Tournoi', distanceKm: 32.5 })
    const { wrapper } = await render({ mode: 'repeat', trip: past })
    mounted = wrapper
    expect(body().text()).toContain('Refaire le trajet')
    expect((input('trip-date').element as HTMLInputElement).value).toBe(todayIso())
    expect((input('trip-destination').element as HTMLInputElement).value).toBe('Givors')
    expect((input('trip-distance').element as HTMLInputElement).value).toBe('32,5')

    vi.mocked(api.trips.create).mockImplementation(async (i) => serverTrip(i))
    await submit()
    expect(api.trips.create).toHaveBeenCalledWith(
      expect.objectContaining({ date: todayIso(), destination: 'Givors', purpose: 'Tournoi' }),
    )
  })

  it('edits a trip with a PATCH and keeps its date', async () => {
    const t = trip()
    vi.mocked(api.trips.update).mockImplementation(async (_id, p) => ({ ...t, ...p }))
    const { wrapper } = await render({ mode: 'edit', trip: t }, { trips: [t] })
    mounted = wrapper
    expect((input('trip-date').element as HTMLInputElement).value).toBe(t.date)
    await input('trip-distance').setValue('60')
    await submit()
    expect(api.trips.update).toHaveBeenCalledWith(
      50,
      expect.objectContaining({ date: t.date, distanceKm: 60 }),
    )
    expect(useUiStore().current?.message).toBe('Trajet modifié')
  })
})
