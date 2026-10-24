// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import * as api from '@/api'
import { flushPromises } from '@vue/test-utils'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { httpError } from '@/test/api-mock'
import { coachUser, freshPinia, mountInApp, signIn, testRouter } from '@/test/app-test'
import type { Coach, ProfilePatch } from '@/types'
import ProfileView from './ProfileView.vue'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

async function render(path = '/profil', user: Coach = coachUser) {
  const pinia = freshPinia()
  signIn(user)
  vi.mocked(api.auth.me).mockResolvedValue(user)
  vi.mocked(api.auth.updateMe).mockImplementation(async (patch: ProfilePatch) => ({
    ...user,
    ...patch,
    address: { ...user.address, ...patch.address },
  }))
  const router = testRouter()
  await router.push(path)
  const wrapper = mountInApp(ProfileView, pinia, router)
  await flushPromises()
  return { wrapper, router }
}

type Wrapper = Awaited<ReturnType<typeof render>>['wrapper']

async function fillAddress(wrapper: Wrapper, line: string, postalCode: string, city: string) {
  await wrapper.find('[data-testid="address-line"] input').setValue(line)
  await wrapper.find('[data-testid="address-postal-code"] input').setValue(postalCode)
  await wrapper.find('[data-testid="address-city"] input').setValue(city)
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

describe('ProfileView', () => {
  it('shows the e-mail and licence number read-only, and prefills the names', async () => {
    const { wrapper } = await render()
    mounted = wrapper
    expect(api.auth.me).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('coach@club.fr')
    expect(wrapper.text()).toContain('5655006000001')
    const values = wrapper.findAll('input').map((i) => (i.element as HTMLInputElement).value)
    expect(values).not.toContain('coach@club.fr')
    expect(values).not.toContain('5655006000001')
    expect(values).toContain('Camille')
    expect(values).toContain('Martin')
  })

  it('saves the address, normalising the postal code', async () => {
    const { wrapper } = await render()
    mounted = wrapper
    await fillAddress(wrapper, ' 1 rue du Stade ', '55 000', 'Bar-le-Duc')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.auth.updateMe).toHaveBeenCalledWith({
      firstName: 'Camille',
      lastName: 'Martin',
      address: { line: '1 rue du Stade', postalCode: '55000', city: 'Bar-le-Duc' },
    })
    expect(useAuthStore().hasAddress).toBe(true)
    expect(useUiStore().current?.message).toBe('Profil enregistré')
  })

  it('coming from Export, requires the address then goes back there', async () => {
    const { wrapper, router } = await render('/profil?retour=export')
    mounted = wrapper
    expect(wrapper.text()).toContain('elle sera imprimée sur votre reçu fiscal')

    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(api.auth.updateMe).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Indiquez le numéro et la rue')

    await fillAddress(wrapper, '1 rue du Stade', '55000', 'Bar-le-Duc')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(api.auth.updateMe).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('export'))
  })

  it('shows an API address error in French and keeps the input', async () => {
    const { wrapper } = await render()
    mounted = wrapper
    vi.mocked(api.auth.updateMe).mockRejectedValue(
      httpError(400, 'address.line must be a string (max 255 characters)'),
    )
    await fillAddress(wrapper, '1 rue du Stade', '55000', 'Bar-le-Duc')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.v-alert').text()).toContain('Vérifiez votre adresse postale')
    expect(
      (wrapper.find('[data-testid="address-line"] input').element as HTMLInputElement).value,
    ).toBe('1 rue du Stade')
  })
})
