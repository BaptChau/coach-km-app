// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import '@/api'
import { freshPinia, mountInApp, signIn, testRouter } from '@/test/app-test'
import BottomNav from './BottomNav.vue'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

async function render(path: string) {
  const pinia = freshPinia()
  signIn()
  const router = testRouter()
  await router.push(path)
  return mountInApp(BottomNav, pinia, router)
}

describe('BottomNav', () => {
  it('renders the 4 tabs with their French labels and links', async () => {
    const wrapper = await render('/trajets')
    const items = wrapper.findAll('.bottom-nav__item')
    expect(items.map((i) => i.text())).toEqual(['Accueil', 'Trajets', 'Véhicules', 'Plus'])
    expect(items.map((i) => i.attributes('href'))).toEqual(['/', '/trajets', '/vehicules', '/plus'])
  })

  it('highlights the tab of the current screen, "Plus" for its sub-screens', async () => {
    const wrapper = await render('/export')
    const active = wrapper.findAll('.bottom-nav__item.v-btn--active')
    expect(active.map((i) => i.text())).toEqual(['Plus'])
    expect(active[0]?.attributes('aria-current')).toBe('page')
  })
})
