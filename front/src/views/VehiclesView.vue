<script setup lang="ts">
// Véhicules (UX.md section 5): one card per vehicle ("Voiture · 5 CV · électrique"), tap to
// edit, delete with an undo snackbar. The API's 409 (vehicle used by trips, re-rating in a
// waived year) is explained in French.
import { onMounted, ref } from 'vue'
import EmptyState from '@/components/common/EmptyState.vue'
import SkeletonList from '@/components/common/SkeletonList.vue'
import VehicleFormDialog from '@/components/vehicles/VehicleFormDialog.vue'
import { errorMessage, vehicleLabel } from '@/domain'
import { useUiStore } from '@/stores/ui'
import { useVehiclesStore } from '@/stores/vehicles'
import type { Vehicle } from '@/types'

const vehicles = useVehiclesStore()
const ui = useUiStore()

const formOpen = ref(false)
const editing = ref<Vehicle | null>(null)

const ICONS = { car: 'mdi-car', motorcycle: 'mdi-motorbike', moped: 'mdi-moped' } as const

onMounted(() => {
  vehicles.load().catch(() => {})
})

function openForm(v: Vehicle | null): void {
  editing.value = v
  formOpen.value = true
}

async function remove(v: Vehicle): Promise<void> {
  try {
    await vehicles.remove(v.id)
  } catch (e) {
    ui.notify(errorMessage(e), { color: 'error', timeout: 8000 })
    return
  }
  ui.notify(`Véhicule « ${v.label} » supprimé`, {
    action: {
      label: 'Annuler',
      handler: async () => {
        try {
          await vehicles.create({
            label: v.label,
            type: v.type,
            fiscalHorsepower: v.fiscalHorsepower,
            electric: v.electric,
          })
        } catch (e) {
          ui.notify(errorMessage(e), { color: 'error' })
        }
      },
    },
  })
}
</script>

<template>
  <section>
    <SkeletonList
      v-if="vehicles.loading && !vehicles.items.length"
      :count="2"
      type="list-item-avatar-two-line"
    />

    <v-card v-else-if="!vehicles.items.length">
      <EmptyState
        icon="mdi-car-off"
        title="Aucun véhicule."
        text="Ajoutez le véhicule que vous utilisez : le barème dépend de sa puissance fiscale."
        action-label="Ajouter un véhicule"
        action-icon="mdi-plus"
        @action="openForm(null)"
      />
    </v-card>

    <template v-else>
      <v-card v-for="v in vehicles.items" :key="v.id" class="mb-3" data-testid="vehicle-card">
        <v-list-item
          :prepend-icon="ICONS[v.type]"
          :title="v.label"
          :subtitle="vehicleLabel(v)"
          :aria-label="`Modifier le véhicule ${v.label}, ${vehicleLabel(v)}`"
          min-height="72"
          link
          class="vehicle-item"
          @click="openForm(v)"
        >
          <template #append>
            <v-icon
              v-if="v.electric"
              icon="mdi-lightning-bolt"
              color="success"
              class="me-1"
              aria-hidden="true"
            />
            <v-menu location="bottom end">
              <template #activator="{ props: menu }">
                <v-btn
                  v-bind="menu"
                  icon="mdi-dots-vertical"
                  variant="text"
                  size="default"
                  :aria-label="`Actions pour ${v.label}`"
                  @click.stop
                />
              </template>
              <v-list density="comfortable" min-width="180">
                <v-list-item
                  prepend-icon="mdi-pencil-outline"
                  title="Modifier"
                  min-height="48"
                  @click="openForm(v)"
                />
                <v-list-item
                  prepend-icon="mdi-delete-outline"
                  title="Supprimer"
                  base-color="error"
                  min-height="48"
                  data-testid="vehicle-delete"
                  @click="remove(v)"
                />
              </v-list>
            </v-menu>
          </template>
        </v-list-item>
      </v-card>

      <v-btn
        block
        variant="tonal"
        color="primary"
        prepend-icon="mdi-plus"
        class="mt-2"
        data-testid="vehicle-add"
        @click="openForm(null)"
      >
        Ajouter un véhicule
      </v-btn>
    </template>

    <VehicleFormDialog v-model="formOpen" :vehicle="editing" />
  </section>
</template>

<style scoped>
.vehicle-item :deep(.v-list-item-title) {
  font-weight: 600;
}
</style>
