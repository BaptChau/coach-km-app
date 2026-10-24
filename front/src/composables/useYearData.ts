// Data of the per-year screens (Accueil, Trajets): reloads trips, summary and rates when
// `ui.year` changes, and loads the waivers (locks) and vehicles. Failures keep the cached
// data (offline); the stores already hold their error state.
import { computed, watch } from 'vue'
import { useRatesStore } from '@/stores/rates'
import { useSummaryStore } from '@/stores/summary'
import { useTripsStore } from '@/stores/trips'
import { useUiStore } from '@/stores/ui'
import { useVehiclesStore } from '@/stores/vehicles'
import { useWaiversStore } from '@/stores/waivers'

const ignore = () => {}

export function useYearData() {
  const ui = useUiStore()
  const trips = useTripsStore()
  const summary = useSummaryStore()
  const rates = useRatesStore()
  const waivers = useWaiversStore()
  const vehicles = useVehiclesStore()

  waivers.load().catch(ignore)
  if (!vehicles.loaded) vehicles.load().catch(ignore)

  watch(
    () => ui.year,
    (y) => {
      trips.loadYear(y).catch(ignore)
      summary.load(y).catch(ignore)
      rates.load(y)
    },
    { immediate: true },
  )

  /** The selected year is waived: read-only. */
  const locked = computed(() => trips.isYearLocked(ui.year))
  /** First load of the year's trips (nothing cached for it yet). */
  const tripsLoading = computed(() => trips.loading && trips.loadedYear !== ui.year)
  /** The summary shown is the selected year's. */
  const yearSummary = computed(() =>
    summary.data && summary.data.year === ui.year ? summary.data : null,
  )
  const summaryLoading = computed(() => !yearSummary.value && summary.loading)

  return { locked, tripsLoading, yearSummary, summaryLoading }
}
