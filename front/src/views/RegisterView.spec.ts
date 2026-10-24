// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import * as api from '@/api'
import { flushPromises } from '@vue/test-utils'
import { useTripsStore } from '@/stores/trips'
import { httpError, networkError } from '@/test/api-mock'
import { coachUser, freshPinia, mountInApp, testRouter, ROUTE_WAIT } from '@/test/app-test'
import RegisterView from './RegisterView.vue'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

async function render(path = '/register') {
  const pinia = freshPinia()
  const router = testRouter()
  await router.push(path)
  return { wrapper: mountInApp(RegisterView, pinia, router), router }
}

type Wrapper = Awaited<ReturnType<typeof render>>['wrapper']

async function fillAndSubmit(wrapper: Wrapper, licence: string) {
  await wrapper.find('input[type="email"]').setValue(' coach@club.fr ')
  await wrapper.find('input[inputmode="numeric"]').setValue(licence)
  await wrapper.find('input[autocomplete="given-name"]').setValue('Camille')
  await wrapper.find('input[autocomplete="family-name"]').setValue('Martin')
  await wrapper.find('input[autocomplete="new-password"]').setValue('motdepasse')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

/** The text of the field (label, input, messages) whose label is `label`. */
function fieldText(wrapper: Wrapper, label: string): string {
  const field = wrapper.findAll('.v-input').find((f) => f.find('label').text() === label)
  if (!field) throw new Error(`no field "${label}"`)
  return field.text()
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

describe('RegisterView', () => {
  it('accepts a licence number typed with spaces and sends it without them', async () => {
    vi.mocked(api.auth.register).mockResolvedValue({ token: 'jwt', coach: coachUser })
    const { wrapper, router } = await render('/register?redirect=/trajets')
    mounted = wrapper
    const flush = vi
      .spyOn(useTripsStore(), 'flushQueue')
      .mockResolvedValue({ sent: 0, dropped: 0, remaining: 0 })

    await fillAndSubmit(wrapper, '5655 006 000 001')

    expect(api.auth.register).toHaveBeenCalledWith({
      email: 'coach@club.fr',
      registrationNumber: '5655006000001',
      firstName: 'Camille',
      lastName: 'Martin',
      password: 'motdepasse',
    })
    expect(flush).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/trajets'), ROUTE_WAIT)
  })

  it('refuses a malformed licence number without calling the API', async () => {
    const { wrapper } = await render()
    mounted = wrapper
    await fillAndSubmit(wrapper, '1234')
    expect(api.auth.register).not.toHaveBeenCalled()
    expect(fieldText(wrapper, 'Numéro de licence')).toContain('13 chiffres, commençant par 5655006')
  })

  it('shows the 409 under the licence field and keeps the form', async () => {
    vi.mocked(api.auth.register).mockRejectedValue(
      httpError(409, 'registrationNumber already registered'),
    )
    const { wrapper, router } = await render()
    mounted = wrapper
    await fillAndSubmit(wrapper, '5655006000001')

    expect(router.currentRoute.value.name).toBe('register')
    expect(fieldText(wrapper, 'Numéro de licence')).toContain(
      'Ce numéro de licence est déjà inscrit',
    )
    expect(fieldText(wrapper, 'E-mail')).not.toContain('déjà inscrit')
    expect(wrapper.find('.v-alert').exists()).toBe(false)
    expect((wrapper.find('input[inputmode="numeric"]').element as HTMLInputElement).value).toBe(
      '5655006000001',
    )

    // Typing again clears the server message.
    await wrapper.find('input[inputmode="numeric"]').setValue('5655006000002')
    expect(fieldText(wrapper, 'Numéro de licence')).not.toContain('déjà inscrit')
  })

  it('shows a duplicate e-mail under the e-mail field', async () => {
    vi.mocked(api.auth.register).mockRejectedValue(httpError(409, 'email already registered'))
    const { wrapper } = await render()
    mounted = wrapper
    await fillAndSubmit(wrapper, '5655006000001')
    expect(fieldText(wrapper, 'E-mail')).toContain('Cet e-mail est déjà inscrit')
  })

  it('shows a network failure as a form-level alert', async () => {
    vi.mocked(api.auth.register).mockRejectedValue(networkError())
    const { wrapper } = await render()
    mounted = wrapper
    await fillAndSubmit(wrapper, '5655006000001')
    expect(wrapper.find('.v-alert').text()).toContain('vérifiez votre réseau')
  })
})
