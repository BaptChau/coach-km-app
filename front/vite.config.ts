/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { VitePWA } from 'vite-plugin-pwa'

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
      VitePWA({
        // Minimal setup; the manifest, icons and offline strategy are polished in issue #12.
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: {
          name: 'Coach KM',
          short_name: 'Coach KM',
          description: 'Frais kilométriques des coachs bénévoles',
          lang: 'fr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          theme_color: '#1E5AA8',
          background_color: '#F6F7F9',
          icons: [],
        },
        workbox: {
          navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/mockServiceWorker\.js$/],
          // The MSW worker (public/, dev mocks only) must never be precached or served by this SW.
          globIgnores: ['**/mockServiceWorker.js'],
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
