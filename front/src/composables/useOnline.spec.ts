// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import '@/api'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useTripsStore } from '@/stores/trips'
import { freshPinia, signIn } from '@/test/app-test'
import { useOnline, type UseOnlineOptions } from './useOnline'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

function host(options?: UseOnlineOptions) {
  let state!: ReturnType<typeof useOnline>
  const Host = defineComponent({
    setup() {
      state = useOnline(options)
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  return { wrapper, state: () => state }
}

beforeEach(() => {
  localStorage.clear()
  freshPinia()
})

describe('useOnline', () => {
  it('flushes the queue once per `online` event and tracks the state', () => {
    signIn()
    const trips = useTripsStore()
    const flush = vi
      .spyOn(trips, 'flushQueue')
      .mockResolvedValue({ sent: 0, dropped: 0, remaining: 0 })
    const { state, wrapper } = host({ flushOnMount: false })

    window.dispatchEvent(new Event('offline'))
    expect(state().isOnline.value).toBe(false)
    expect(flush).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('online'))
    expect(state().isOnline.value).toBe(true)
    expect(flush).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('flushes at mount when signed in, not when signed out', () => {
    const trips = useTripsStore()
    const flush = vi
      .spyOn(trips, 'flushQueue')
      .mockResolvedValue({ sent: 0, dropped: 0, remaining: 0 })

    host().wrapper.unmount()
    expect(flush).not.toHaveBeenCalled()

    signIn()
    host().wrapper.unmount()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('removes its listeners on unmount', () => {
    signIn()
    const trips = useTripsStore()
    const flush = vi
      .spyOn(trips, 'flushQueue')
      .mockResolvedValue({ sent: 0, dropped: 0, remaining: 0 })
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const { wrapper } = host({ flushOnMount: false })
    const added = add.mock.calls.filter(([type]) => type === 'online' || type === 'offline')
    expect(added).toHaveLength(2)

    wrapper.unmount()
    for (const [type, listener] of added) expect(remove).toHaveBeenCalledWith(type, listener)

    window.dispatchEvent(new Event('online'))
    expect(flush).not.toHaveBeenCalled()
  })
})
