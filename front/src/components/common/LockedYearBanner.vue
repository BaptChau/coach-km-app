<script setup lang="ts">
// Banner of a waived (locked) year: its trips are read-only (UX.md section 4).
defineProps<{ year: number }>()
</script>

<template>
  <v-alert
    type="info"
    variant="tonal"
    icon="mdi-lock"
    density="comfortable"
    class="mb-4"
    data-testid="locked-banner"
  >
    Année {{ year }} clôturée : vous avez renoncé au remboursement.
  </v-alert>
</template>
