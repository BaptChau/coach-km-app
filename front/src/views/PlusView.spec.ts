// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import '@/api'
import { useAuthStore } from '@/stores/auth'
import {
  coachUser,
  freshPinia,
  mountInApp,
  presidentUser,
  signIn,
  testRouter,
  ROUTE_WAIT,
} from '@/test/app-test'
import type { Coach } from '@/types'
import PlusView from './PlusView.vue'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

async function render(user: Coach) {
  const pinia = freshPinia()
  signIn(user)
  const router = testRouter()
  await router.push('/plus')
  return { wrapper: mountInApp(PlusView, pinia, router), router }
}

describe('PlusView', () => {
  it('lists Export, Profil and Déconnexion, without Admin, for a coach', async () => {
    const { wrapper } = await render(coachUser)
    const text = wrapper.text()
    expect(text).toContain('Export & abandon de frais')
    expect(text).toContain('Profil')
    expect(text).toContain('Déconnexion')
    expect(text).not.toContain('Admin')
  })

  it('shows Admin to the president', async () => {
    const { wrapper } = await render(presidentUser)
    expect(wrapper.text()).toContain('Admin')
    expect(wrapper.find('a[href="/admin"]').exists()).toBe(true)
  })

  it('Déconnexion clears the session and goes to /login', async () => {
    const { wrapper, router } = await render(coachUser)
    await wrapper.find('[data-testid="logout"]').trigger('click')
    expect(useAuthStore().isAuthenticated).toBe(false)
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/login'), ROUTE_WAIT)
  })
})
