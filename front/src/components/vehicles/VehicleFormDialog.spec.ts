// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import * as api from '@/api'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { useVehiclesStore } from '@/stores/vehicles'
import { httpError, vehicle } from '@/test/api-mock'
import { freshPinia, mountInApp, signIn, testRouter } from '@/test/app-test'
import type { Vehicle } from '@/types'
import VehicleFormDialog from './VehicleFormDialog.vue'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

const body = () => new DOMWrapper(document.body)
const input = (id: string) => body().find(`[data-testid="${id}"] input`)

async function render(edit: Vehicle | null = null) {
  const pinia = freshPinia()
  signIn()
  if (edit) useVehiclesStore().items = [edit]
  const router = testRouter()
  await router.push('/vehicules')
  const state = reactive({
    modelValue: true,
    vehicle: edit,
    'onUpdate:modelValue': (v: boolean) => (state.modelValue = v),
  })
  const wrapper = mountInApp(VehicleFormDialog, pinia, router, { props: state, attach: true })
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
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('VehicleFormDialog', () => {
  it('hides the CV field for a moped and sends fiscalHorsepower null', async () => {
    vi.mocked(api.vehicles.create).mockImplementation(async (i) => ({ ...vehicle, ...i, id: 5 }))
    const { wrapper, state } = await render()
    mounted = wrapper
    expect(input('vehicle-cv').exists()).toBe(true)
    expect(body().text()).toContain('Case P.6 de la carte grise')
    expect(body().text()).toContain('+20 % sur le barème')

    await body().find('[data-testid="type-moped"]').trigger('click')
    expect(input('vehicle-cv').exists()).toBe(false)

    await input('vehicle-label').setValue('Scooter')
    await submit()
    expect(api.vehicles.create).toHaveBeenCalledWith({
      label: 'Scooter',
      type: 'moped',
      fiscalHorsepower: null,
      electric: false,
    })
    expect(state.modelValue).toBe(false)
  })

  it('sends a car with its CV and the electric flag', async () => {
    vi.mocked(api.vehicles.create).mockImplementation(async (i) => ({ ...vehicle, ...i, id: 6 }))
    const { wrapper } = await render()
    mounted = wrapper
    await input('vehicle-label').setValue('Zoé')
    await input('vehicle-cv').setValue('4')
    await input('vehicle-electric').setValue(true)
    await submit()
    expect(api.vehicles.create).toHaveBeenCalledWith({
      label: 'Zoé',
      type: 'car',
      fiscalHorsepower: 4,
      electric: true,
    })
  })

  it('asks for the CV of a car', async () => {
    const { wrapper } = await render()
    mounted = wrapper
    await input('vehicle-label').setValue('Clio')
    await submit()
    expect(body().text()).toContain('Indiquez la puissance fiscale (CV)')
    expect(api.vehicles.create).not.toHaveBeenCalled()
  })

  it('patches only what changed and explains the waived-year 409 in French', async () => {
    vi.mocked(api.vehicles.update).mockRejectedValue(
      httpError(
        409,
        'vehicle is used in a year whose reimbursement was waived; only its label can change',
      ),
    )
    const { wrapper, state } = await render(vehicle)
    mounted = wrapper
    expect((input('vehicle-label').element as HTMLInputElement).value).toBe('Clio')
    await input('vehicle-cv').setValue('6')
    await submit()
    expect(api.vehicles.update).toHaveBeenCalledWith(1, { fiscalHorsepower: 6 })
    expect(body().find('[data-testid="vehicle-error"]').text()).toContain(
      'seul son libellé peut encore changer',
    )
    expect(state.modelValue).toBe(true)
  })
})
