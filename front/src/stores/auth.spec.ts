import { createPinia, setActivePinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp, nextTick } from 'vue'
import * as api from '@/api'
import { tripInput } from '@/test/api-mock'
import type { Coach } from '@/types'
import { useAuthStore, useTripsStore, useVehiclesStore } from '.'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

const coach: Coach = {
  id: 7,
  email: 'a@b.fr',
  registrationNumber: '5655006000001',
  firstName: 'Ana',
  lastName: 'Bo',
  role: 'coach',
  address: { line: '', postalCode: '', city: '' },
  createdAt: '2026-01-01T00:00:00Z',
}

function freshPinia() {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  createApp({}).use(pinia) // plugins run once the pinia is installed in an app
  setActivePinia(pinia)
  return pinia
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  freshPinia()
})

describe('auth store', () => {
  it('login stores and persists the session and wires the token provider', async () => {
    vi.mocked(api.auth.login).mockResolvedValue({ token: 'jwt-1', coach })
    const auth = useAuthStore()
    const provider = vi.mocked(api.setTokenProvider).mock.calls.at(-1)?.[0]
    expect(provider?.()).toBeNull()

    await auth.login({ email: 'a@b.fr', password: 'secret' })

    expect(auth.isAuthenticated).toBe(true)
    expect(provider?.()).toBe('jwt-1')
    expect(JSON.parse(localStorage.getItem('coach-km:auth') ?? '{}')).toMatchObject({
      token: 'jwt-1',
      coach: { id: 7 },
    })

    // A reload (new pinia) restores the session from storage.
    freshPinia()
    const reloaded = useAuthStore()
    expect(reloaded.token).toBe('jwt-1')
    expect(reloaded.coach?.email).toBe('a@b.fr')
  })

  it('exposes role and address getters', async () => {
    vi.mocked(api.auth.register).mockResolvedValue({
      token: 't',
      coach: { ...coach, role: 'president' },
    })
    const auth = useAuthStore()
    await auth.register({
      email: 'a@b.fr',
      registrationNumber: '5655006000001',
      firstName: 'Ana',
      lastName: 'Bo',
      password: 'secret123',
    })
    expect(auth.isPresident).toBe(true)
    expect(auth.hasAddress).toBe(false)

    vi.mocked(api.auth.updateMe).mockResolvedValue({
      ...coach,
      address: { line: '1 rue A', postalCode: '69001', city: 'Lyon' },
    })
    await auth.updateProfile({ address: { line: '1 rue A', postalCode: '69001', city: 'Lyon' } })
    expect(auth.hasAddress).toBe(true)
  })

  it('a 401 logs out but keeps the offline queue', async () => {
    vi.mocked(api.auth.login).mockResolvedValue({ token: 'jwt-1', coach })
    const auth = useAuthStore()
    await auth.login({ email: 'a@b.fr', password: 'x' })
    const trips = useTripsStore()
    vi.mocked(api.trips.create).mockRejectedValue(new api.ApiRequestError('network', null, 'x'))
    await trips.loadYear(2026)
    await trips.create(tripInput)
    expect(trips.pendingCount).toBe(1)

    const handler = vi.mocked(api.onUnauthorized).mock.calls.at(-1)?.[0]
    handler?.()

    expect(auth.isAuthenticated).toBe(false)
    expect(auth.coach).toBeNull()
    expect(trips.items).toEqual([])
    expect(trips.queue).toHaveLength(1)
  })

  it('logout resets the other stores and clears the coach queue', async () => {
    vi.mocked(api.auth.login).mockResolvedValue({ token: 'jwt-1', coach })
    const auth = useAuthStore()
    await auth.login({ email: 'a@b.fr', password: 'x' })
    const vehicles = useVehiclesStore()
    vehicles.markUsed(1)
    const trips = useTripsStore()
    vi.mocked(api.trips.create).mockRejectedValue(new api.ApiRequestError('network', null, 'x'))
    await trips.create(tripInput)

    auth.logout()
    await nextTick()

    expect(trips.queue).toHaveLength(0)
    expect(vehicles.lastVehicleId).toBeNull()
    expect(JSON.parse(localStorage.getItem('coach-km:auth') ?? '{}')).toMatchObject({
      token: null,
    })
  })
})
