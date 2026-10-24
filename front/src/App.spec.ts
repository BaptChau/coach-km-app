// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import '@/api'
import { flushPromises, mount } from '@vue/test-utils'

import App from '@/App.vue'
import { buildVuetify, darkTheme, lightTheme } from '@/plugins/vuetify'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { freshPinia, signIn, testRouter } from '@/test/app-test'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

async function render(path: string) {
  const pinia = freshPinia()
  const router = testRouter()
  return {
    pinia,
    router,
    async mountAt() {
      await router.push(path)
      const wrapper = mount(App, { global: { plugins: [pinia, router, buildVuetify()] } })
      await flushPromises()
      return wrapper
    },
  }
}

beforeEach(() => localStorage.clear())

describe('app shell', () => {
  it('uses the UX.md theme tokens', () => {
    expect(lightTheme.colors?.primary).toBe('#1E5AA8')
    expect(lightTheme.colors?.secondary).toBe('#F28C28')
    expect(lightTheme.colors?.background).toBe('#F6F7F9')
    expect(darkTheme.dark).toBe(true)
  })

  it('shows the login page, without navigation, when signed out', async () => {
    const wrapper = await (await render('/')).mountAt()
    expect(wrapper.find('.v-application').exists()).toBe(true)
    expect(wrapper.text()).toContain('Connexion')
    expect(wrapper.find('.v-app-bar').exists()).toBe(false)
    expect(wrapper.find('.v-bottom-navigation').exists()).toBe(false)
  })

  it('renders the shell with the title and the year chip on a per-year screen', async () => {
    const ctx = await render('/trajets')
    signIn()
    useUiStore().setYear(2025)
    const wrapper = await ctx.mountAt()
    expect(wrapper.find('.v-app-bar').text()).toContain('Trajets')
    expect(wrapper.find('[data-testid="year-chip"]').text()).toContain('2025')
  })

  it('sends the user to /login?redirect when the session ends', async () => {
    const ctx = await render('/vehicules')
    signIn()
    const wrapper = await ctx.mountAt()
    expect(wrapper.find('[data-testid="year-chip"]').exists()).toBe(false)

    useAuthStore().logout({ keepQueue: true })
    await vi.waitFor(() =>
      expect(ctx.router.currentRoute.value.fullPath).toBe('/login?redirect=/vehicules'),
    )
  })

  it('shows ui.current in the snackbar host', async () => {
    const ctx = await render('/')
    signIn()
    await ctx.mountAt()
    useUiStore().notify('Trajet enregistré')
    await vi.waitFor(() => expect(document.body.textContent).toContain('Trajet enregistré'))
  })
})
