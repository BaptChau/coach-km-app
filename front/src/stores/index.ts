// Pinia stores: auth, vehicles, trips (+ offline queue), summary (issue #9).
export { useAuthStore, type LogoutOptions } from './auth'
export { useUiStore, type Snack, type SnackAction, type SnackColor, type NotifyOptions } from './ui'
export { useVehiclesStore } from './vehicles'
export {
  useTripsStore,
  yearOf,
  isTempId,
  type QueueEntry,
  type QueuedCreate,
  type QueuedUpdate,
  type QueuedRemove,
  type FlushResult,
  type MonthGroup,
} from './trips'
export { useSummaryStore, SUMMARY_REFRESH_DELAY_MS } from './summary'
export { useRatesStore } from './rates'
export { useWaiversStore } from './waivers'
export { useAdminStore } from './admin'
