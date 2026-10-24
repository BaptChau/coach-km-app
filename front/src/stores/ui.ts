// UI state shared by every screen: the selected year and the snackbar queue (issue #9).
// The layout shell (#10) renders `current` in a single <v-snackbar> and calls `dismiss`.
import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'

export interface SnackAction {
  label: string
  handler: () => void | Promise<void>
}

export type SnackColor = 'success' | 'info' | 'warning' | 'error'

export interface NotifyOptions {
  action?: SnackAction
  color?: SnackColor
  /** ms before the snackbar hides itself; -1 keeps it open. Default 4000 (6000 with an action). */
  timeout?: number
}

export interface Snack {
  id: number
  message: string
  color: SnackColor | undefined
  timeout: number
  action: SnackAction | undefined
}

let snackSeq = 0

export const useUiStore = defineStore(
  'ui',
  () => {
    /** The year shown by every per-year screen (trips, summary, export). Persisted. */
    const year = ref(new Date().getFullYear())
    const snackbars = ref<Snack[]>([])

    /** The snackbar to show now (first in the queue), or null. */
    const current = computed(() => snackbars.value[0] ?? null)

    function setYear(value: number): void {
      year.value = value
    }

    /** Queues a snackbar message; returns its id (for `dismiss`). */
    function notify(message: string, options: NotifyOptions = {}): number {
      const id = ++snackSeq
      snackbars.value.push({
        id,
        message,
        color: options.color,
        timeout: options.timeout ?? (options.action ? 6000 : 4000),
        action: options.action ? markRaw({ ...options.action }) : undefined,
      })
      return id
    }

    /** Removes a snackbar (the current one by default). */
    function dismiss(id?: number): void {
      const target = id ?? current.value?.id
      snackbars.value = snackbars.value.filter((s) => s.id !== target)
    }

    /** Runs a snackbar's action (e.g. "Annuler"), after dismissing it. */
    async function runAction(id: number): Promise<void> {
      const snack = snackbars.value.find((s) => s.id === id)
      dismiss(id)
      await snack?.action?.handler()
    }

    function clearNotifications(): void {
      snackbars.value = []
    }

    return { year, snackbars, current, setYear, notify, dismiss, runAction, clearNotifications }
  },
  { persist: { key: 'coach-km:ui', pick: ['year'] } },
)
