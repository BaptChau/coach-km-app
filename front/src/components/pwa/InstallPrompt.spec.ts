import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { VApp } from 'vuetify/components'
import { buildVuetify } from '@/plugins/vuetify'
import InstallPrompt from './InstallPrompt.vue'

const Empty = { render: () => null }

async function setup(): Promise<{ router: Router; wrapper: ReturnType<typeof mount> }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Empty },
      { path: '/trajets', component: Empty },
    ],
  })
  await router.push('/')
  const Host = { render: () => h(VApp, () => h(InstallPrompt)) }
  const wrapper = mount(Host, { global: { plugins: [router, buildVuetify()] } })
  return { router, wrapper }
}

function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  })
  window.dispatchEvent(event)
  return event
}

const card = (w: ReturnType<typeof mount>) => w.find('[data-testid="install-prompt"]')

describe('InstallPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('waits for the delay and the next navigation, then installs', async () => {
    const { router, wrapper } = await setup()
    const event = fireBeforeInstallPrompt()
    expect(event.defaultPrevented).toBe(true)

    await router.push('/trajets')
    expect(card(wrapper).exists()).toBe(false)

    vi.advanceTimersByTime(30_000)
    await router.push('/')
    await flushPromises()
    expect(card(wrapper).exists()).toBe(true)
    expect(card(wrapper).text()).toContain("Installer l'application sur l'écran d'accueil")

    await wrapper.find('[data-testid="install-accept"]').trigger('click')
    await flushPromises()
    expect(event.prompt).toHaveBeenCalledOnce()
    expect(card(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('remembers "Plus tard" for 30 days', async () => {
    const { router, wrapper } = await setup()
    fireBeforeInstallPrompt()
    vi.advanceTimersByTime(30_000)
    await router.push('/trajets')
    await flushPromises()
    await wrapper.find('[data-testid="install-dismiss"]').trigger('click')
    expect(card(wrapper).exists()).toBe(false)
    expect(Number(localStorage.getItem('coach-km:install-dismissed-at'))).toBeGreaterThan(0)
    wrapper.unmount()

    const again = await setup()
    fireBeforeInstallPrompt()
    vi.advanceTimersByTime(30_000)
    await again.router.push('/trajets')
    await flushPromises()
    expect(card(again.wrapper).exists()).toBe(false)
    again.wrapper.unmount()
  })

  it('shows the share-sheet hint once on iOS Safari', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    )
    const { router, wrapper } = await setup()
    vi.advanceTimersByTime(30_000)
    await router.push('/trajets')
    await flushPromises()
    expect(wrapper.find('[data-testid="install-ios-hint"]').text()).toContain(
      "Sur l'écran d'accueil",
    )
    await wrapper.find('[data-testid="install-dismiss"]').trigger('click')
    expect(localStorage.getItem('coach-km:ios-install-hint-shown')).toBe('1')
    wrapper.unmount()
  })

  it('stays hidden when the app runs standalone', async () => {
    const original = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      ...original(query),
      addEventListener: () => {},
      removeEventListener: () => {},
      matches: query.includes('standalone'),
    }))
    const { router, wrapper } = await setup()
    fireBeforeInstallPrompt()
    vi.advanceTimersByTime(30_000)
    await router.push('/trajets')
    await flushPromises()
    expect(card(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })
})
