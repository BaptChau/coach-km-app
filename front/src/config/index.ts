/**
 * Runtime configuration read from the Vite env (`.env.development` / `.env.production`).
 * Import this module instead of reading `import.meta.env` directly.
 */
export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
} as const

export type AppConfig = typeof config
