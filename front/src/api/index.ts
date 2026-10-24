// Axios client and typed API wrappers for api/API.md (issue #7).
// Usage: `import { trips, ApiRequestError } from '@/api'` then `trips.create(input)`.
export {
  http,
  setTokenProvider,
  onUnauthorized,
  ApiRequestError,
  isApiRequestError,
  isRetryable,
  toApiRequestError,
  REQUEST_TIMEOUT_MS,
  type ApiErrorKind,
} from './client'
export { saveBlob, filenameFromDisposition, type Download } from './export'

export * as auth from './auth'
export * as vehicles from './vehicles'
export * as trips from './trips'
export * as summary from './summary'
export * as rates from './rates'
export * as exportApi from './export'
export * as waivers from './waivers'
export * as admin from './admin'
