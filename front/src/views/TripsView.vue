<script setup lang="ts">
// Trajets (UX.md section 5): the year's trips grouped by month (sticky headers with the
// month's km), newest first. Tap to edit, menu Refaire / Supprimer (undo snackbar). A waived
// year is read-only (banner, no FAB, no edit or delete).
import EmptyState from '@/components/common/EmptyState.vue'
import LockedYearBanner from '@/components/common/LockedYearBanner.vue'
import SkeletonList from '@/components/common/SkeletonList.vue'
import TripFormDialog from '@/components/trips/TripFormDialog.vue'
import TripListItem from '@/components/trips/TripListItem.vue'
import { useTripEditor } from '@/composables/useTripEditor'
import { useYearData } from '@/composables/useYearData'
import { formatKm } from '@/domain'
import { useTripsStore } from '@/stores/trips'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const trips = useTripsStore()
const { locked, tripsLoading } = useYearData()
const editor = useTripEditor()
const { formOpen, formMode, formTrip } = editor
</script>

<template>
  <section>
    <LockedYearBanner v-if="locked" :year="ui.year" />

    <SkeletonList v-if="tripsLoading && trips.trips.length === 0" :count="5" />

    <v-card v-else-if="trips.trips.length === 0">
      <EmptyState
        icon="mdi-map-marker-path"
        :title="`Aucun trajet en ${ui.year}.`"
        :text="locked ? undefined : 'Ajoutez votre premier trajet.'"
        :action-label="locked ? undefined : 'Ajouter un trajet'"
        action-icon="mdi-plus"
        @action="editor.openCreate()"
      />
    </v-card>

    <template v-else>
      <section
        v-for="group in trips.groupedByMonth"
        :key="group.key"
        class="month mb-4"
        :aria-label="`${group.label}, ${formatKm(group.km)}`"
        data-testid="month-group"
      >
        <h2 class="month__header" data-testid="month-header">
          <span class="month__label">{{ group.label }}</span>
          <span class="month__km tabular-nums">{{ formatKm(group.km) }}</span>
        </h2>
        <v-card>
          <v-list class="py-0">
            <template v-for="(trip, i) in group.trips" :key="trip.id">
              <v-divider v-if="i > 0" />
              <TripListItem
                :trip="trip"
                :pending="trips.isPending(trip.id)"
                :locked="locked"
                @edit="editor.openEdit"
                @repeat="editor.openRepeat"
                @remove="editor.remove"
              />
            </template>
          </v-list>
        </v-card>
      </section>
    </template>

    <v-fab
      v-if="!locked"
      app
      order="1"
      location="bottom end"
      extended
      prepend-icon="mdi-plus"
      text="Ajouter un trajet"
      data-testid="fab"
      @click="editor.openCreate()"
    />

    <TripFormDialog v-model="formOpen" :mode="formMode" :trip="formTrip" />
  </section>
</template>

<style scoped>
/* Sticky month header, under the app bar (Vuetify exposes its height as --v-layout-top). */
.month__header {
  position: sticky;
  top: var(--v-layout-top, 64px);
  z-index: 2;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 0 -16px 8px;
  padding: 8px 16px;
  font-size: 0.9375rem;
  font-weight: 600;
  background: rgb(var(--v-theme-background));
}
.month__label::first-letter {
  text-transform: uppercase;
}
.month__km {
  color: rgba(var(--v-theme-on-background), var(--v-medium-emphasis-opacity));
}
</style>
