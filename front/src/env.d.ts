/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Same-origin API prefix, always `/api` (proxied to the Go API; see README). */
  readonly VITE_API_BASE_URL: string
  /** `"true"` serves the API from the MSW mock layer instead of the Go API. */
  readonly VITE_USE_MOCKS: 'true' | 'false'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
