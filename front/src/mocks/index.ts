// MSW mock layer enabled by VITE_USE_MOCKS (issue #8).
//
// `main.ts` awaits `enableMocks()` before mounting the app. The worker module is loaded
// with a dynamic import behind `import.meta.env.DEV`, so MSW never reaches the production
// bundle, even if VITE_USE_MOCKS were set to true there.
import { config } from '@/config'

/**
 * Starts the MSW worker when `config.useMocks` is true (dev only). Resolves once the
 * worker intercepts requests; does nothing otherwise. Requests outside the API prefix
 * (Vite modules, assets) are passed through untouched.
 */
export async function enableMocks(): Promise<void> {
  if (!import.meta.env.DEV || !config.useMocks) return

  const [{ worker }, { resetMockDb }] = await Promise.all([import('./browser'), import('./db')])
  await worker.start({
    // MSW 3 name of v2's `onUnhandledRequest`: non-API requests go to the network silently.
    onUnhandledFrame: 'bypass',
    quiet: true,
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  })
  // Handy from the devtools console: `__coachKmMocks.reset()` reloads the seed.
  Object.assign(globalThis, { __coachKmMocks: { reset: resetMockDb } })
}
