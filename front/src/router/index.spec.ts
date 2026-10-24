// Load the mocked `@/api` first: `@/test/api-mock` imports it too (circular otherwise).
import '@/api'
import { freshPinia, presidentUser, signIn, testRouter } from '@/test/app-test'
import { safeRedirect } from '.'

vi.mock('@/api', async (orig) => (await import('@/test/api-mock')).mockApi(await orig()))

beforeEach(() => {
  localStorage.clear()
  freshPinia()
})

describe('auth guard', () => {
  it('sends an unauthenticated user to /login with ?redirect', async () => {
    const router = testRouter()
    await router.push('/trajets?x=1')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/trajets?x=1')
  })

  it('does not add ?redirect for Accueil', async () => {
    const router = testRouter()
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/login')
  })

  it('lets anyone reach the public pages when signed out', async () => {
    const router = testRouter()
    await router.push('/register')
    expect(router.currentRoute.value.name).toBe('register')
  })

  it('keeps a signed-in user away from /login and /register', async () => {
    signIn()
    const router = testRouter()
    await router.push('/login')
    expect(router.currentRoute.value.fullPath).toBe('/')
    await router.push('/register?redirect=/vehicules')
    expect(router.currentRoute.value.fullPath).toBe('/vehicules')
  })

  it('redirects a coach away from /admin', async () => {
    signIn()
    const router = testRouter()
    await router.push('/trajets')
    await router.push('/admin')
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('lets the president reach /admin', async () => {
    signIn(presidentUser)
    const router = testRouter()
    await router.push('/admin')
    expect(router.currentRoute.value.name).toBe('admin')
  })

  it('redirects unknown paths to Accueil and sets the document title', async () => {
    signIn()
    const router = testRouter()
    await router.push('/nope/nothing')
    expect(router.currentRoute.value.name).toBe('home')
    expect(document.title).toBe('Accueil · Coach KM')
    await router.push('/export')
    expect(router.currentRoute.value.meta).toMatchObject({ perYear: true, nav: 'more' })
    expect(document.title).toBe('Export & abandon de frais · Coach KM')
  })
})

describe('safeRedirect', () => {
  it.each([
    [undefined, '/'],
    [null, '/'],
    ['/trajets?x=1', '/trajets?x=1'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/login', '/'],
    ['/login?redirect=/x', '/'],
    ['/loginx', '/loginx'],
  ])('%s → %s', (value, expected) => {
    expect(safeRedirect(value)).toBe(expected)
  })

  it('takes the first value of a repeated query param', () => {
    expect(safeRedirect(['/profil', '/admin'])).toBe('/profil')
  })
})
