// What Accueil and Trajets share around a trip: open the form (create, edit, "Refaire")
// and delete with an undo snackbar instead of a confirmation dialog (UX.md section 4).
import { ref } from 'vue'
import { errorMessage } from '@/domain'
import { useTripsStore } from '@/stores/trips'
import { useUiStore } from '@/stores/ui'
import type { Trip, TripInput } from '@/types'

export type TripFormMode = 'create' | 'edit' | 'repeat'

/** The create body that recreates `trip` (the "Annuler" of a delete). */
export function inputOf(trip: Trip): TripInput {
  return {
    date: trip.date,
    origin: trip.origin,
    destination: trip.destination,
    purpose: trip.purpose,
    vehicleId: trip.vehicleId,
    distanceKm: trip.distanceKm,
    roundTrip: trip.roundTrip,
  }
}

export function useTripEditor() {
  const trips = useTripsStore()
  const ui = useUiStore()

  const formOpen = ref(false)
  const formMode = ref<TripFormMode>('create')
  const formTrip = ref<Trip | null>(null)

  function open(mode: TripFormMode, trip: Trip | null = null): void {
    formMode.value = mode
    formTrip.value = trip
    formOpen.value = true
  }

  async function remove(trip: Trip): Promise<void> {
    try {
      await trips.remove(trip.id)
    } catch (e) {
      ui.notify(errorMessage(e), { color: 'error' })
      return
    }
    ui.notify('Trajet supprimé', {
      action: {
        label: 'Annuler',
        handler: async () => {
          try {
            await trips.create(inputOf(trip))
          } catch (e) {
            ui.notify(errorMessage(e), { color: 'error' })
          }
        },
      },
    })
  }

  return {
    formOpen,
    formMode,
    formTrip,
    openCreate: () => open('create'),
    openEdit: (trip: Trip) => open('edit', trip),
    openRepeat: (trip: Trip) => open('repeat', trip),
    remove,
  }
}
