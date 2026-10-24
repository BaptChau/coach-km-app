// `/summary` for a year: the authoritative € totals (issue #9). The trips store calls
// `scheduleRefresh()` after each mutation the server accepted (debounced).
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { isApiRequestError, summary as summaryApi, type ApiRequestError } from '@/api'
import type { Summary } from '@/types'
import { useUiStore } from './ui'

/** Debounce of the refetch after trip mutations, in ms. */
export const SUMMARY_REFRESH_DELAY_MS = 400

export const useSummaryStore = defineStore(
  'summary',
  () => {
    const data = ref<Summary | null>(null)
    const loading = ref(false)
    const error = ref<ApiRequestError | null>(null)

    let seq = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    /** Loads a year (default: the selected one). Network errors keep the cached data. */
    async function load(year: number = useUiStore().year): Promise<Summary | null> {
      const ticket = ++seq
      loading.value = true
      error.value = null
      try {
        const res = await summaryApi.get(year)
        if (ticket === seq) data.value = res
        return res
      } catch (e) {
        if (ticket === seq && isApiRequestError(e)) error.value = e
        if (isApiRequestError(e) && e.isNetworkError) return data.value
        throw e
      } finally {
        if (ticket === seq) loading.value = false
      }
    }

    /** Refetches the shown year after `delay` ms; calls within the delay collapse into one. */
    function scheduleRefresh(delay: number = SUMMARY_REFRESH_DELAY_MS): void {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        load(data.value?.year ?? useUiStore().year).catch(() => {})
      }, delay)
    }

    function reset(): void {
      if (timer) clearTimeout(timer)
      timer = null
      seq++
      data.value = null
      loading.value = false
      error.value = null
    }

    return { data, loading, error, load, scheduleRefresh, reset }
  },
  { persist: { key: 'coach-km:summary', pick: ['data'] } },
)
