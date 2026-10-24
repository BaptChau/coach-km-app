<script setup lang="ts">
// Tablet/desktop navigation (from `md` up): a rail on `md`, a permanent drawer from `lg`.
// Shows the main tabs plus the "Plus" entries directly (there is room for them).
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useLogout } from '@/composables/useLogout'
import { useAuthStore } from '@/stores/auth'
import { MAIN_NAV, MORE_NAV } from './nav'

defineProps<{ rail: boolean }>()

const route = useRoute()
const auth = useAuthStore()
const logout = useLogout()

const mainItems = MAIN_NAV.filter((i) => i.key !== 'more')
const moreItems = computed(() => MORE_NAV.filter((i) => !i.presidentOnly || auth.isPresident))
</script>

<template>
  <v-navigation-drawer permanent :rail="rail" rail-width="80" width="256" tag="nav">
    <v-list-item
      class="py-4"
      :title="rail ? undefined : 'Coach KM'"
      :subtitle="rail ? undefined : (auth.coach?.firstName ?? undefined)"
      prepend-icon="mdi-steering"
    />
    <v-divider />

    <v-list nav density="comfortable" color="primary" aria-label="Navigation principale">
      <v-list-item
        v-for="item in mainItems"
        :key="item.key"
        :to="item.to"
        :active="route.meta.nav === item.key"
        :prepend-icon="item.icon"
        :title="item.label"
        min-height="48"
      />
      <v-divider class="my-2" />
      <v-list-item
        v-for="item in moreItems"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="item.label"
        min-height="48"
      />
    </v-list>

    <template #append>
      <v-list nav density="comfortable">
        <v-list-item
          prepend-icon="mdi-logout"
          title="Déconnexion"
          min-height="48"
          @click="logout"
        />
      </v-list>
    </template>
  </v-navigation-drawer>
</template>
