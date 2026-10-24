// Vitest config: the app's Vite config (plugins, aliases and its `test:` block: jsdom,
// setup file…) plus coverage. Kept apart so test tooling never has to edit vite.config.ts.
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      // Component specs mount Vuetify in jsdom: give them room on a busy CI runner.
      testTimeout: 20_000,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'json-summary'],
        include: ['src/**/*.{ts,vue}'],
        exclude: [
          'src/**/*.spec.ts',
          'src/test/**',
          'src/main.ts',
          'src/env.d.ts',
          // Browser-only dev bootstrap of the MSW service worker, never runs under Node.
          'src/mocks/browser.ts',
          'src/mocks/index.ts',
          // Type-only modules and re-export barrels.
          'src/types/**',
          'src/api/index.ts',
          'src/composables/index.ts',
          'src/domain/index.ts',
          'src/stores/index.ts',
          'src/mocks/handlers/index.ts',
        ],
        // Floors a little under the current numbers (issue #13): they catch a real drop in
        // coverage without failing on noise. Raise them when coverage goes up. Files matched
        // by a glob below are checked against it only, the global floor covers the rest.
        thresholds: {
          lines: 82,
          statements: 80,
          functions: 75,
          branches: 72,
          'src/domain/**': { lines: 90, statements: 88, functions: 100, branches: 80 },
          'src/stores/**': { lines: 90, statements: 88, functions: 90, branches: 76 },
          'src/api/**': { lines: 95, statements: 95, functions: 95, branches: 85 },
        },
      },
    },
  }),
)
