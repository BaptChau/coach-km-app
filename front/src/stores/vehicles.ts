// The coach's vehicles (issue #9). Persisted so the trip form works offline.
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { vehicles as vehiclesApi } from '@/api'
import type { Vehicle, VehicleInput, VehiclePatch } from '@/types'
import { useTripsStore } from './trips'

export const useVehiclesStore = defineStore(
  'vehicles',
  () => {
    const items = ref<Vehicle[]>([])
    const loaded = ref(false)
    const loading = ref(false)
    /** The vehicle of the last trip logged on this device (fallback when no trip is loaded). */
    const lastVehicleId = ref<number | null>(null)

    const byIdMap = computed(() => new Map(items.value.map((v) => [v.id, v])))

    function byId(id: number | null | undefined): Vehicle | undefined {
      return id == null ? undefined : byIdMap.value.get(id)
    }

    /** Smart default for the trip form: last trip's vehicle, else last used, else the only one. */
    const lastUsedVehicleId = computed<number | null>(() => {
      const fromTrips = useTripsStore().lastTrip?.vehicleId
      if (fromTrips != null && byIdMap.value.has(fromTrips)) return fromTrips
      if (lastVehicleId.value != null && byIdMap.value.has(lastVehicleId.value)) {
        return lastVehicleId.value
      }
      return items.value.length === 1 ? (items.value[0]?.id ?? null) : null
    })

    async function load(): Promise<Vehicle[]> {
      loading.value = true
      try {
        items.value = await vehiclesApi.list()
        loaded.value = true
        return items.value
      } finally {
        loading.value = false
      }
    }

    async function create(input: VehicleInput): Promise<Vehicle> {
      const vehicle = await vehiclesApi.create(input)
      items.value.push(vehicle)
      return vehicle
    }

    /** 409 when re-rating a vehicle with trips in a waived year (rethrown). */
    async function update(id: number, patch: VehiclePatch): Promise<Vehicle> {
      const vehicle = await vehiclesApi.update(id, patch)
      const index = items.value.findIndex((v) => v.id === id)
      if (index >= 0) items.value.splice(index, 1, vehicle)
      else items.value.push(vehicle)
      return vehicle
    }

    /** 409 while trips still use the vehicle (rethrown). */
    async function remove(id: number): Promise<void> {
      await vehiclesApi.remove(id)
      items.value = items.value.filter((v) => v.id !== id)
      if (lastVehicleId.value === id) lastVehicleId.value = null
    }

    function markUsed(id: number): void {
      lastVehicleId.value = id
    }

    function reset(): void {
      items.value = []
      loaded.value = false
      loading.value = false
      lastVehicleId.value = null
    }

    return {
      items,
      loaded,
      loading,
      lastVehicleId,
      byId,
      lastUsedVehicleId,
      load,
      create,
      update,
      remove,
      markUsed,
      reset,
    }
  },
  { persist: { key: 'coach-km:vehicles', pick: ['items', 'lastVehicleId'] } },
)
