<script setup lang="ts">
// Skeleton placeholders for lists and cards (never a full-screen spinner, UX.md section 4).
withDefaults(defineProps<{ count?: number; type?: string }>(), {
  count: 3,
  type: 'list-item-two-line',
})
</script>

<template>
  <div aria-busy="true" aria-label="Chargement…" role="status" data-testid="skeleton">
    <v-skeleton-loader v-for="i in count" :key="i" :type="type" class="mb-2" />
  </div>
</template>
