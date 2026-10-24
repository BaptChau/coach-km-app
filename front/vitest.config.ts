// Vitest config: the app's Vite config (plugins, aliases and its `test:` block: jsdom,
// setup file…) plus coverage. Kept apart so test tooling never has to edit vite.config.ts.
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
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
      },
    },
  }),
)
