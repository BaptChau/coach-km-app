// Service-worker runtime caches shared between vite.config.ts (Workbox config) and the app.
//
// The API cache keys every GET by the URL plus a hash of the Authorization header (see
// vite.config.ts), so a coach never gets another coach's cached data. On top of that, logout
// deletes the whole API cache: the next coach on a shared phone starts empty, and no data
// of the previous session stays on the device.

export const API_CACHE = 'coach-km-api'
export const ASSETS_CACHE = 'coach-km-assets'

/** Deletes the cached API responses. Never throws (no Cache API, private mode, tests). */
export async function clearApiCache(): Promise<void> {
  try {
    // Typed structurally: vite.config.ts also imports this file, without the DOM lib.
    const storage = (globalThis as { caches?: { delete(name: string): Promise<boolean> } }).caches
    await storage?.delete(API_CACHE)
  } catch {
    // Nothing cached, or storage not available: nothing to clear.
  }
}
