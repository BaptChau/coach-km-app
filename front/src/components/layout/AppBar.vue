<script setup lang="ts">
// Top app bar: screen title (route meta) and, on per-year screens, the year selector chip.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'

/** How many past years the selector offers, besides the current one. */
const PAST_YEARS = 4

const route = useRoute()
const ui = useUiStore()

const title = computed(() => route.meta.title ?? '')
const showYear = computed(() => !!route.meta.perYear)

const years = computed(() => {
  const current = new Date().getFullYear()
  const list = Array.from({ length: PAST_YEARS + 1 }, (_, i) => current - i)
  // A persisted year older than the range (or a future one) stays selectable.
  if (!list.includes(ui.year)) list.push(ui.year)
  return list.sort((a, b) => b - a)
})
</script>

<template>
  <v-app-bar :elevation="0" border="b" color="surface">
    <v-app-bar-title class="app-bar__title">{{ title }}</v-app-bar-title>

    <template v-if="showYear" #append>
      <v-menu location="bottom end">
        <template #activator="{ props: menu }">
          <v-chip
            v-bind="menu"
            class="year-chip me-1"
            color="primary"
            variant="tonal"
            append-icon="mdi-menu-down"
            :aria-label="`Année affichée : ${ui.year}. Changer d'année`"
            data-testid="year-chip"
          >
            {{ ui.year }}
          </v-chip>
        </template>
        <v-list density="comfortable" aria-label="Choisir l'année" min-width="140">
          <v-list-item
            v-for="y in years"
            :key="y"
            :active="y === ui.year"
            color="primary"
            min-height="48"
            @click="ui.setYear(y)"
          >
            <v-list-item-title class="tabular-nums">{{ y }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </template>
  </v-app-bar>
</template>

<style scoped>
.app-bar__title {
  font-weight: 600;
}

/* 48 px touch target (UX.md section 4); the chip keeps its pill look. */
.year-chip {
  height: 48px;
  padding-inline: 14px;
  font-size: 1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
