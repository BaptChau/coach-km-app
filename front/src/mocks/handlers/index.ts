// Every mock handler, one file per area of api/API.md. Shared by the browser worker
// (browser.ts) and the Vitest server (msw/node).
import { adminHandlers } from './admin'
import { authHandlers } from './auth'
import { reportHandlers } from './report'
import { tripHandlers } from './trips'
import { vehicleHandlers } from './vehicles'
import { waiverHandlers } from './waivers'

export const handlers = [
  ...authHandlers,
  ...vehicleHandlers,
  ...tripHandlers,
  ...reportHandlers,
  ...waiverHandlers,
  ...adminHandlers,
]
