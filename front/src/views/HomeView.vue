<script setup lang="ts">
// Accueil (UX.md section 5): the year's € and km, a 12-month chart, per-vehicle totals,
// the last 3 trips (with "Refaire"), a call to action towards Export when the year can be
// waived, and the "Ajouter un trajet" FAB (hidden on a waived year).
import { computed, ref } from 'vue'
import EmptyState from '@/components/common/EmptyState.vue'
import LockedYearBanner from '@/components/common/LockedYearBanner.vue'
import MoneyFigure from '@/components/common/MoneyFigure.vue'
import SkeletonList from '@/components/common/SkeletonList.vue'
import MonthChart from '@/components/home/MonthChart.vue'
import TripFormDialog from '@/components/trips/TripFormDialog.vue'
import TripListItem from '@/components/trips/TripListItem.vue'
import { useTripEditor } from '@/composables/useTripEditor'
import { useYearData } from '@/composables/useYearData'
import { formatKm, vehicleLabel } from '@/domain'
import { useAuthStore } from '@/stores/auth'
import { useTripsStore } from '@/stores/trips'
import { useUiStore } from '@/stores/ui'
import { useWaiversStore } from '@/stores/waivers'

const BAREME_URL = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1132'

const ui = useUiStore()
const auth = useAuthStore()
const trips = useTripsStore()
const waivers = useWaiversStore()
const { locked, tripsLoading, yearSummary, summaryLoading } = useYearData()
const editor = useTripEditor()
const { formOpen, formMode, formTrip } = editor

const baremeOpen = ref(false)

const lastTrips = computed(() => trips.trips.slice(0, 3))
const totalKm = computed(() => yearSummary.value?.totalKm ?? 0)
const totalAmount = computed(() => yearSummary.value?.totalAmount ?? 0)

const VEHICLE_ICONS = { car: 'mdi-car', motorcycle: 'mdi-motorbike', moped: 'mdi-moped' } as const

/**
 * Gentle nudge towards Export: a past year with km and no waiver yet, or the current year
 * from November on (the waiver is decided at year end).
 */
const showExportCta = computed(() => {
  if (locked.value || waivers.isLocked(ui.year) || totalKm.value <= 0) return false
  const now = new Date()
  return ui.year < now.getFullYear() || now.getMonth() >= 10
})
</script>

<template>
  <section>
    <LockedYearBanner v-if="locked" :year="ui.year" />

    <!-- Hero: the year's amount -->
    <v-card class="hero mb-4" color="primary" variant="flat" data-testid="hero">
      <v-card-text>
        <div class="text-body-2 hero__label">Vos frais kilométriques {{ ui.year }}</div>
        <template v-if="summaryLoading">
          <v-skeleton-loader type="heading" color="transparent" class="hero__skeleton" />
          <v-skeleton-loader type="text" color="transparent" class="hero__skeleton" />
        </template>
        <template v-else>
          <MoneyFigure :euros="totalAmount" size="hero" data-testid="hero-amount" />
          <div class="text-h6 tabular-nums mt-1" data-testid="hero-km">{{ formatKm(totalKm) }}</div>
        </template>
        <v-btn
          variant="text"
          size="small"
          class="hero__note mt-2"
          append-icon="mdi-information-outline"
          @click="baremeOpen = true"
        >
          Estimation selon le barème
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- Months -->
    <v-card class="mb-4">
      <v-card-title class="text-subtitle-1 font-weight-bold">Par mois</v-card-title>
      <v-card-text>
        <v-skeleton-loader v-if="summaryLoading" type="image" height="160" />
        <MonthChart v-else :months="yearSummary?.byMonth ?? []" :year="ui.year" />
      </v-card-text>
    </v-card>

    <!-- Export / waiver call to action -->
    <v-card
      v-if="showExportCta"
      class="mb-4"
      variant="tonal"
      color="primary"
      data-testid="export-cta"
    >
      <v-card-text class="text-body-1">
        <div class="font-weight-bold mb-1">Faire un don de vos frais {{ ui.year }} ?</div>
        En renonçant au remboursement, vous récupérez 66 % du montant en réduction d’impôt.
        <template v-if="!auth.hasAddress"
          >Il vous faudra d’abord renseigner votre adresse.</template
        >
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-btn
          variant="flat"
          color="primary"
          :to="{ name: 'export' }"
          append-icon="mdi-arrow-right"
        >
          Voir l’export et le don
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Vehicles -->
    <v-card v-if="yearSummary && yearSummary.byVehicle.length" class="mb-4">
      <v-card-title class="text-subtitle-1 font-weight-bold">Par véhicule</v-card-title>
      <v-list class="py-0" data-testid="by-vehicle">
        <v-list-item
          v-for="v in yearSummary.byVehicle"
          :key="v.vehicleId"
          :prepend-icon="VEHICLE_ICONS[v.type]"
          :title="v.label"
          :subtitle="vehicleLabel(v)"
          min-height="56"
        >
          <template #append>
            <div class="text-end">
              <MoneyFigure :euros="v.amount" />
              <div class="text-caption text-medium-emphasis tabular-nums">
                {{ formatKm(v.km) }}
              </div>
            </div>
          </template>
        </v-list-item>
      </v-list>
    </v-card>

    <!-- Last trips -->
    <v-card class="mb-4">
      <div class="d-flex align-center justify-space-between pe-2">
        <v-card-title class="text-subtitle-1 font-weight-bold">Derniers trajets</v-card-title>
        <v-btn
          v-if="trips.trips.length"
          variant="text"
          color="primary"
          size="default"
          :to="{ name: 'trips' }"
        >
          Voir tout
        </v-btn>
      </div>
      <SkeletonList v-if="tripsLoading && !trips.trips.length" :count="3" class="px-2" />
      <EmptyState
        v-else-if="!lastTrips.length"
        icon="mdi-map-marker-path"
        :title="`Aucun trajet en ${ui.year}.`"
        :text="locked ? undefined : 'Ajoutez votre premier trajet.'"
        :action-label="locked ? undefined : 'Ajouter un trajet'"
        action-icon="mdi-plus"
        @action="editor.openCreate()"
      />
      <v-list v-else class="py-0" data-testid="last-trips">
        <template v-for="(trip, i) in lastTrips" :key="trip.id">
          <v-divider v-if="i > 0" />
          <TripListItem
            :trip="trip"
            :pending="trips.isPending(trip.id)"
            :locked="locked"
            repeat-button
            @edit="editor.openEdit"
            @repeat="editor.openRepeat"
            @remove="editor.remove"
          />
        </template>
      </v-list>
    </v-card>

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

    <v-bottom-sheet v-model="baremeOpen" max-width="560">
      <v-card title="Comment est calculé ce montant ?">
        <v-card-text class="text-body-1">
          <p class="mb-3">
            Le montant suit le barème kilométrique officiel : il dépend de la puissance fiscale de
            chaque véhicule et du total de km parcourus avec lui dans l’année (+20 % pour un
            véhicule électrique).
          </p>
          <p class="mb-3 text-medium-emphasis">
            {{ yearSummary?.baremeSource ?? 'Barème kilométrique (service-public.gouv.fr, F1132)' }}
          </p>
          <v-btn
            :href="BAREME_URL"
            target="_blank"
            rel="noopener"
            variant="tonal"
            color="primary"
            append-icon="mdi-open-in-new"
            block
          >
            Voir le barème sur service-public.gouv.fr
          </v-btn>
        </v-card-text>
        <v-card-actions class="px-4 pb-4">
          <v-btn block variant="text" @click="baremeOpen = false">Fermer</v-btn>
        </v-card-actions>
      </v-card>
    </v-bottom-sheet>
  </section>
</template>

<style scoped>
.hero__label {
  opacity: 0.9;
}
.hero__note {
  margin-inline-start: -8px;
  color: inherit;
  text-transform: none;
  letter-spacing: 0;
  min-height: 40px;
}
.hero__skeleton {
  background: transparent;
}
</style>
