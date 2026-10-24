<script setup lang="ts">
// One trip in a list (UX.md section 5): short date, "Origine → Destination", purpose, billed
// km, "A/R" and pending chips. Tap to edit; overflow menu: Refaire / Supprimer. A locked
// (waived) year shows a lock and only offers "Refaire".
import { computed } from 'vue'
import { formatKm, formatShortDate } from '@/domain'
import type { Trip } from '@/types'

const props = withDefaults(
  defineProps<{
    trip: Trip
    pending?: boolean
    locked?: boolean
    /** Show "Refaire" as a visible button too (Accueil's last trips). */
    repeatButton?: boolean
  }>(),
  { pending: false, locked: false, repeatButton: false },
)
const emit = defineEmits<{ edit: [trip: Trip]; repeat: [trip: Trip]; remove: [trip: Trip] }>()

const route = computed(() => `${props.trip.origin} → ${props.trip.destination}`)
const label = computed(
  () =>
    `${formatShortDate(props.trip.date)}, ${route.value}, ${props.trip.purpose}, ${formatKm(props.trip.billedKm)}`,
)
</script>

<template>
  <v-list-item
    class="trip-item"
    lines="three"
    min-height="72"
    :link="!locked"
    :aria-label="locked ? undefined : `Modifier le trajet : ${label}`"
    data-testid="trip-item"
    v-on="locked ? {} : { click: () => emit('edit', trip) }"
  >
    <template #prepend>
      <div class="trip-item__date text-caption text-medium-emphasis tabular-nums">
        {{ formatShortDate(trip.date) }}
      </div>
    </template>

    <v-list-item-title class="trip-item__route">{{ route }}</v-list-item-title>
    <v-list-item-subtitle class="trip-item__purpose">{{ trip.purpose }}</v-list-item-subtitle>
    <div class="trip-item__chips">
      <v-chip v-if="trip.roundTrip" size="small" variant="tonal" label data-testid="chip-ar">
        A/R
      </v-chip>
      <v-chip
        v-if="pending"
        size="small"
        variant="tonal"
        color="info"
        prepend-icon="mdi-cloud-sync"
        label
        data-testid="chip-pending"
      >
        En attente de synchronisation
      </v-chip>
      <v-chip
        v-if="locked"
        size="small"
        variant="tonal"
        prepend-icon="mdi-lock"
        label
        data-testid="chip-locked"
      >
        Clôturé
      </v-chip>
      <v-btn
        v-if="repeatButton"
        variant="tonal"
        color="primary"
        size="small"
        prepend-icon="mdi-repeat"
        class="trip-item__repeat"
        :aria-label="`Refaire le trajet ${route}`"
        data-testid="trip-repeat-button"
        @click.stop="emit('repeat', trip)"
      >
        Refaire
      </v-btn>
    </div>

    <template #append>
      <div class="trip-item__km font-weight-bold tabular-nums">{{ formatKm(trip.billedKm) }}</div>
      <v-menu location="bottom end">
        <template #activator="{ props: menu }">
          <v-btn
            v-bind="menu"
            icon="mdi-dots-vertical"
            variant="text"
            size="default"
            :aria-label="`Actions pour le trajet ${route}`"
            data-testid="trip-menu"
            @click.stop
          />
        </template>
        <v-list density="comfortable" min-width="180">
          <v-list-item
            prepend-icon="mdi-repeat"
            title="Refaire"
            min-height="48"
            data-testid="trip-repeat"
            @click="emit('repeat', trip)"
          />
          <v-list-item
            v-if="!locked"
            prepend-icon="mdi-delete-outline"
            title="Supprimer"
            base-color="error"
            min-height="48"
            data-testid="trip-delete"
            @click="emit('remove', trip)"
          />
        </v-list>
      </v-menu>
    </template>
  </v-list-item>
</template>

<style scoped>
.trip-item {
  padding-inline: 12px 4px !important;
}
.trip-item__date {
  width: 52px;
  margin-inline-end: 8px;
  line-height: 1.2;
  white-space: normal;
}
.trip-item__route {
  font-weight: 600;
  white-space: normal;
  overflow-wrap: anywhere;
}
.trip-item__purpose {
  -webkit-line-clamp: 1;
}
.trip-item__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.trip-item__chips:empty {
  display: none;
}
.trip-item__km {
  white-space: nowrap;
  margin-inline-end: 0;
}
.trip-item__repeat {
  min-height: 36px;
  text-transform: none;
  letter-spacing: 0;
}
</style>
