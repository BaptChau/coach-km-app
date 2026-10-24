<script setup lang="ts">
// Thin top banner (UX.md section 4): offline state, pending changes, and a short
// "Synchronisé" confirmation when the queue empties. `online` comes from the layout's
// single `useOnline()`.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useTripsStore } from '@/stores/trips'

/** How long "Synchronisé" stays on screen. */
const SYNCED_FLASH_MS = 2500

const props = defineProps<{ online: boolean }>()

const trips = useTripsStore()
const pending = computed(() => trips.pendingCount)
const synced = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

watch(pending, (count, before) => {
  if (count === 0 && before > 0 && props.online) {
    synced.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (synced.value = false), SYNCED_FLASH_MS)
  } else if (count > 0) {
    synced.value = false
  }
})
onBeforeUnmount(() => clearTimeout(timer))

const pendingText = computed(() =>
  pending.value === 1 ? '1 modification en attente' : `${pending.value} modifications en attente`,
)

const state = computed(() => {
  if (!props.online) {
    return {
      color: 'warning',
      icon: 'mdi-cloud-off-outline',
      text: 'Hors ligne : vos trajets seront synchronisés',
    }
  }
  if (pending.value > 0) {
    return {
      color: 'info',
      icon: trips.syncing ? 'mdi-cloud-sync-outline' : 'mdi-cloud-upload-outline',
      text: trips.syncing ? 'Synchronisation…' : 'En attente de synchronisation',
    }
  }
  if (synced.value)
    return { color: 'success', icon: 'mdi-cloud-check-outline', text: 'Synchronisé' }
  return null
})
</script>

<template>
  <v-system-bar
    v-if="state"
    :color="state.color"
    height="32"
    class="offline-banner"
    role="status"
    aria-live="polite"
    data-testid="offline-banner"
  >
    <v-icon :icon="state.icon" size="18" class="me-2" />
    <span class="text-truncate">{{ state.text }}</span>
    <template v-if="pending > 0">
      <span class="mx-1" aria-hidden="true">·</span>
      <span class="text-no-wrap">{{ pendingText }}</span>
    </template>
  </v-system-bar>
</template>

<style scoped>
.offline-banner {
  justify-content: center;
  font-size: 0.8125rem;
  font-weight: 500;
}
</style>
