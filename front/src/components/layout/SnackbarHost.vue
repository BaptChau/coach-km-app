<script setup lang="ts">
// The one snackbar of the app: shows `ui.current` (the head of the queue), one at a time.
import { computed } from 'vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const current = computed(() => ui.current)

function onToggle(open: boolean): void {
  // Closed by its timeout (or swiped away): drop it, the next one shows.
  if (!open && current.value) ui.dismiss(current.value.id)
}
</script>

<template>
  <v-snackbar
    :key="current?.id"
    :model-value="!!current"
    :timeout="current?.timeout ?? -1"
    :color="current?.color"
    multi-line
    data-testid="snackbar"
    @update:model-value="onToggle"
  >
    {{ current?.message }}

    <template #actions>
      <v-btn
        v-if="current?.action"
        variant="text"
        size="default"
        min-height="48"
        @click="ui.runAction(current.id)"
      >
        {{ current.action.label }}
      </v-btn>
      <v-btn
        icon="mdi-close"
        variant="text"
        size="default"
        aria-label="Fermer"
        @click="ui.dismiss(current?.id)"
      />
    </template>
  </v-snackbar>
</template>
