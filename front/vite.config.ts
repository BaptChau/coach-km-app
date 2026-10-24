/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { VitePWA } from 'vite-plugin-pwa'
import { MDI_ICONS } from './src/plugins/mdi-icons.ts'
import { API_CACHE, ASSETS_CACHE } from './src/plugins/pwa-cache.ts'

// The Go API sends no CORS headers, so the front always calls a same-origin prefix
// (VITE_API_BASE_URL=/api). In dev and preview, Vite forwards /api/* to the API and
// strips the prefix: /api/trips -> http://localhost:3000/trips.
// In production, a reverse proxy must do the same (see README.md).
const API_PREFIX = '/api'

function apiProxy(target: string): Record<string, ProxyOptions> {
  return {
    [API_PREFIX]: {
      target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api(?=\/|$)/, '') || '/',
    },
  }
}

const SRC_DIR = fileURLToPath(new URL('./src', import.meta.url))

/** The icon set itself: its comments mention `mdi-xxx` names that are not icons. */
const ICON_SET_FILES = [
  join(SRC_DIR, 'plugins', 'mdi-icons.ts'),
  join(SRC_DIR, 'plugins', 'icons.ts'),
]

/** Every `mdi-*` icon name written in src/ (specs, test helpers and the icon set excluded). */
function usedMdiIcons(dir = SRC_DIR, found = new Map<string, string>()): Map<string, string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (path !== join(SRC_DIR, 'test')) usedMdiIcons(path, found)
    } else if (
      /\.(vue|ts)$/.test(entry.name) &&
      !/\.(spec|test)\.ts$/.test(entry.name) &&
      !ICON_SET_FILES.includes(path)
    ) {
      for (const [name] of readFileSync(path, 'utf8').matchAll(/\bmdi-[a-z0-9]+(?:-[a-z0-9]+)*/g)) {
        if (!found.has(name)) found.set(name, relative(SRC_DIR, path))
      }
    }
  }
  return found
}

/**
 * Fails the build and the test run (warns in dev) when an `mdi-*` icon used in src/ is
 * missing from src/plugins/mdi-icons.ts, where the SVG icon set resolves names (issue #12).
 */
function mdiIconCheck(): Plugin {
  let strict = true
  return {
    name: 'coach-km:mdi-icon-check',
    configResolved(config) {
      strict = config.command === 'build' || !!process.env.VITEST
    },
    buildStart() {
      const missing = [...usedMdiIcons()].filter(([name]) => !(name in MDI_ICONS))
      if (missing.length === 0) return
      const list = missing.map(([name, file]) => `${name} (src/${file})`).join(', ')
      const message = `Icons missing from src/plugins/mdi-icons.ts: ${list}`
      if (strict) this.error(message)
      else this.warn(message)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy = apiProxy(env.API_PROXY_TARGET || 'http://localhost:3000')

  return {
    plugins: [
      vue(),
      vuetify({
        autoImport: true,
        // Unit tests do not need Vuetify's SASS (and jsdom cannot load it).
        styles: process.env.VITEST ? 'none' : { configFile: 'src/styles/settings.scss' },
      }),
      mdiIconCheck(),
      VitePWA({
        registerType: 'autoUpdate',
        // Registered from src/plugins/pwa.ts (update flow), not by an injected script.
        injectRegister: false,
        includeAssets: ['favicon.svg', 'icons/favicon-32.png', 'icons/apple-touch-icon-180.png'],
        manifest: {
          id: '/',
          name: 'Coach KM : frais kilométriques',
          short_name: 'Coach KM',
          description:
            "Notez les kilomètres parcourus pour votre association, suivez le total de l'année en euros et exportez votre récapitulatif fiscal.",
          lang: 'fr',
          dir: 'ltr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          theme_color: '#1E5AA8',
          background_color: '#F6F7F9',
          categories: ['finance', 'productivity', 'sports'],
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          shortcuts: [
            {
              name: 'Ajouter un trajet',
              short_name: 'Ajouter',
              description: 'Noter un nouveau trajet',
              url: '/trajets?ajouter=1',
              icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
            },
          ],
        },
        workbox: {
          // App shell, cache-first (precache): every built JS/CSS/HTML file; the icons and the
          // manifest come from includeAssets and the manifest.
          globPatterns: ['**/*.{js,css,html}'],
          // The MSW worker (public/, dev mocks only) must never be precached or served by this SW.
          globIgnores: ['**/mockServiceWorker.js'],
          cleanupOutdatedCaches: true,
          // autoUpdate: the new SW activates at once and controls open pages (see src/plugins/pwa.ts).
          skipWaiting: true,
          clientsClaim: true,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/mockServiceWorker\.js$/],
          // These functions are serialised into sw.js: they must not use outer variables.
          runtimeCaching: [
            {
              // API GETs: network first (fresh data), the cache only when offline or slow.
              // File downloads (export, receipts) and auth calls are never cached, nor are
              // requests without a token.
              urlPattern: ({ url, request, sameOrigin }) =>
                sameOrigin &&
                request.method === 'GET' &&
                url.pathname.startsWith('/api/') &&
                !/^\/api\/(export|receipts|auth)(\/|$)/.test(url.pathname) &&
                request.headers.has('Authorization'),
              handler: 'NetworkFirst',
              method: 'GET',
              options: {
                cacheName: API_CACHE,
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 80, maxAgeSeconds: 7 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [200] },
                plugins: [
                  {
                    // Cache key = URL + a hash of the Authorization header: a response is only
                    // ever served back to the session that fetched it. Logout also deletes
                    // this cache (src/plugins/pwa-cache.ts).
                    cacheKeyWillBeUsed: async ({ request }) => {
                      const auth = request.headers.get('Authorization') ?? ''
                      const digest = await crypto.subtle.digest(
                        'SHA-256',
                        new TextEncoder().encode(auth),
                      )
                      const session = Array.from(new Uint8Array(digest).slice(0, 12), (b) =>
                        b.toString(16).padStart(2, '0'),
                      ).join('')
                      const key = new URL(request.url)
                      key.searchParams.set('__sw_session', session)
                      return key.href
                    },
                  },
                ],
              },
            },
            {
              // Static files outside the precache, and fonts from any origin.
              urlPattern: ({ url, request, sameOrigin }) =>
                request.destination === 'font' ||
                (sameOrigin &&
                  !url.pathname.startsWith('/api/') &&
                  ['style', 'script', 'image'].includes(request.destination)),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: ASSETS_CACHE,
                expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy,
    },
    preview: {
      port: 4173,
      proxy,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.{test,spec}.ts'],
      setupFiles: ['src/test/setup.ts'],
      css: false,
      server: {
        deps: {
          inline: ['vuetify'],
        },
      },
    },
  }
})
