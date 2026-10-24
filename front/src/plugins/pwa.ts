// Service worker registration and update flow (issue #12).
//
// `registerType: 'autoUpdate'`: a new service worker installs, skips waiting and takes
// control in the background. The page that is open still runs the previous version, so it
// must reload at some point. vite-plugin-pwa's default reloads at once, which would wipe a
// trip form being filled in. Instead, the update is applied on the NEXT in-app navigation:
// the router turns it into a full page load of the target URL. Leaving a screen already
// discards its form, so the user loses nothing and sees no prompt. No snackbar either: on a
// small screen it would compete with the "Trajet enregistré / Annuler" snackbar.
//
// A lazy route chunk that fails to load (old hashed file gone after a deploy) also turns
// into a full page load, once per session.
import type { Router } from 'vue-router'

/** How often an open app checks for a new version. */
const UPDATE_CHECK_MS = 60 * 60 * 1000
const CHUNK_RELOAD_KEY = 'coach-km:chunk-reload'

let updatePending = false

/** True once a new version controls the page and the next navigation will reload. */
export function isUpdatePending(): boolean {
  return updatePending
}

function hardNavigate(path: string): void {
  window.location.assign(path)
}

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|Importing a module script failed/i.test(message)
}

/** Router hooks of the update flow. Exported for tests; `setupPwa` installs them. */
export function installUpdateGuards(router: Router): void {
  router.beforeEach((to, from) => {
    // `from.matched` is empty on the first navigation (app start): nothing to reload then.
    if (updatePending && from.matched.length > 0) {
      hardNavigate(to.fullPath)
      return false
    }
  })

  router.onError((error, to) => {
    if (!isChunkLoadError(error)) return
    try {
      if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return
      sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
    } catch {
      return
    }
    hardNavigate(to.fullPath)
  })
}

/** Marks an update as pending (called when the new service worker took control). */
export function markUpdatePending(): void {
  updatePending = true
}

/** Registers the service worker (production builds only) and installs the update flow. */
export async function setupPwa(router: Router): Promise<void> {
  installUpdateGuards(router)
  // Dev serves the MSW worker on the same scope, and tests have no service worker.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  const { registerSW } = await import('virtual:pwa-register')
  registerSW({
    immediate: true,
    onNeedReload: markUpdatePending,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => {
        if (navigator.onLine && document.visibilityState === 'visible') {
          registration.update().catch(() => {})
        }
      }, UPDATE_CHECK_MS)
    },
  })
}
