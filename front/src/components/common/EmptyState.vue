<script setup lang="ts">
// Empty state (UX.md section 4): says what is missing and offers the next action.
defineProps<{
  icon: string
  title: string
  text?: string
  actionLabel?: string
  actionIcon?: string
}>()
const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <div class="empty-state text-center" data-testid="empty-state">
    <v-icon :icon="icon" size="48" color="primary" class="mb-3" aria-hidden="true" />
    <p class="text-subtitle-1 font-weight-medium mb-1">{{ title }}</p>
    <p v-if="text" class="text-body-2 text-medium-emphasis mb-4">{{ text }}</p>
    <slot>
      <v-btn v-if="actionLabel" color="primary" :prepend-icon="actionIcon" @click="emit('action')">
        {{ actionLabel }}
      </v-btn>
    </slot>
  </div>
</template>

<style scoped>
.empty-state {
  padding: 32px 16px;
}
</style>
