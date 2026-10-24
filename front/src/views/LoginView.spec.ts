// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import * as api from '@/api'
import { flushPromises } from '@vue/test-utils'
import { useTripsStore } from '@/stores/trips'
import { httpError } from '@/test/api-mock'
import { coachUser, freshPinia, mountInApp, testRouter } from '@/test/app-test'
import LoginView from './LoginView.vue'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

async function render(path: string) {
  const pinia = freshPinia()
  const router = testRouter()
  await router.push(path)
  return { wrapper: mountInApp(LoginView, pinia, router), router }
}

async function fillAndSubmit(wrapper: Awaited<ReturnType<typeof render>>['wrapper']) {
  await wrapper.find('input[type="email"]').setValue('coach@club.fr')
  await wrapper.find('input[autocomplete="current-password"]').setValue('password1')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('LoginView', () => {
  it('logs in, flushes the offline queue and goes to ?redirect', async () => {
    vi.mocked(api.auth.login).mockResolvedValue({ token: 'jwt', coach: coachUser })
    const { wrapper, router } = await render('/trajets')
    expect(router.currentRoute.value.fullPath).toBe('/login?redirect=/trajets')
    const flush = vi
      .spyOn(useTripsStore(), 'flushQueue')
      .mockResolvedValue({ sent: 0, dropped: 0, remaining: 0 })

    await fillAndSubmit(wrapper)

    expect(api.auth.login).toHaveBeenCalledWith({ email: 'coach@club.fr', password: 'password1' })
    expect(flush).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/trajets'))
  })

  it('goes to Accueil without ?redirect', async () => {
    vi.mocked(api.auth.login).mockResolvedValue({ token: 'jwt', coach: coachUser })
    const { wrapper, router } = await render('/login')
    await fillAndSubmit(wrapper)
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/'))
  })

  it('stays on the page with a French message on bad credentials', async () => {
    vi.mocked(api.auth.login).mockRejectedValue(httpError(401, 'invalid email or password'))
    const { wrapper, router } = await render('/login')
    await fillAndSubmit(wrapper)
    expect(router.currentRoute.value.name).toBe('login')
    expect(wrapper.find('[data-testid="login-error"]').text()).toContain(
      'E-mail ou mot de passe incorrect',
    )
    // The form is not cleared.
    expect((wrapper.find('input[type="email"]').element as HTMLInputElement).value).toBe(
      'coach@club.fr',
    )
  })
})
