// The MSW service worker for the browser (dev only, loaded by `enableMocks`).
import { setupWorker } from 'msw/browser'

import { handlers } from './handlers'

export const worker = setupWorker(...handlers)
