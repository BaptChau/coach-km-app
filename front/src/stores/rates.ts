// `/rates` per year, cached, with the bundled barème as fallback (issue #9). Also the live
// "≈ +X € sur l'année" preview of the trip form.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { rates as ratesApi } from '@/api'
import { FALLBACK_BAREME } from '@/config/rates'
import { tripPreviewCents, type RatedVehicle } from '@/domain'
import type { Bareme } from '@/types'
import { useTripsStore, yearOf } from './trips'
import { useUiStore } from './ui'

export const useRatesStore = defineStore(
  'rates',
  () => {
    const byYear = ref<Record<number, Bareme>>({})
    /** Years whose barème is the bundled fallback (the API failed): `load` retries them. */
    const fallbackYears = ref<number[]>([])
    const inflight = new Map<number, Promise<Bareme>>()

    /** The barème for a year: the API's when loaded, else the fallback. */
    function baremeFor(year: number): Bareme {
      return byYear.value[year] ?? FALLBACK_BAREME
    }

    function isFallback(year: number): boolean {
      return !byYear.value[year] || fallbackYears.value.includes(year)
    }

    /** Fetches `/rates?year=` once per year; never throws (falls back to FALLBACK_BAREME). */
    function load(year: number): Promise<Bareme> {
      const cached = byYear.value[year]
      if (cached && !fallbackYears.value.includes(year)) return Promise.resolve(cached)
      const running = inflight.get(year)
      if (running) return running
      const p = ratesApi
        .get(year)
        .then((res): Bareme => {
          byYear.value[year] = res
          fallbackYears.value = fallbackYears.value.filter((y) => y !== year)
          return res
        })
        .catch((): Bareme => {
          byYear.value[year] = FALLBACK_BAREME
          if (!fallbackYears.value.includes(year)) fallbackYears.value.push(year)
          return FALLBACK_BAREME
        })
        .finally(() => inflight.delete(year))
      inflight.set(year, p)
      return p
    }

    /**
     * What a trip of `tripBilledKm` adds to `vehicle`'s year, in cents, using the km already
     * logged for that vehicle in the trips store. When editing, pass the trip's id as
     * `excludeTripId` so its previous km are not counted twice. Load the year's rates first.
     */
    function previewCents(
      vehicle: RatedVehicle & { id: number },
      tripBilledKm: number,
      excludeTripId?: number | null,
      year: number = useUiStore().year,
    ): number {
      const trips = useTripsStore()
      let yearKm = trips.kmByVehicle(year)[vehicle.id] ?? 0
      if (excludeTripId != null) {
        const t = trips.tripById(excludeTripId)
        if (t && t.vehicleId === vehicle.id && yearOf(t.date) === year) yearKm -= t.billedKm
      }
      return tripPreviewCents(baremeFor(year), vehicle, yearKm, tripBilledKm)
    }

    return { byYear, fallbackYears, baremeFor, isFallback, load, previewCents }
  },
  { persist: { key: 'coach-km:rates', pick: ['byYear', 'fallbackYears'] } },
)
