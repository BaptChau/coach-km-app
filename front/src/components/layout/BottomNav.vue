<script setup lang="ts">
// Mobile bottom navigation (below `md`): 4 tabs in the thumb zone, safe-area aware.
import { useRoute } from 'vue-router'
import { MAIN_NAV } from './nav'

const route = useRoute()
</script>

<template>
  <v-bottom-navigation
    class="bottom-nav"
    :height="64"
    grow
    color="primary"
    aria-label="Navigation principale"
    tag="nav"
  >
    <v-btn
      v-for="item in MAIN_NAV"
      :key="item.key"
      :to="item.to"
      :active="route.meta.nav === item.key"
      :aria-current="route.meta.nav === item.key ? 'page' : undefined"
      class="bottom-nav__item"
      size="default"
      rounded="0"
    >
      <v-icon :icon="item.icon" />
      <span>{{ item.label }}</span>
    </v-btn>
  </v-bottom-navigation>
</template>

<style scoped>
/* Vuetify sets the height inline (64 px); the safe-area inset is added below it. */
.bottom-nav {
  box-sizing: content-box;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.bottom-nav__item {
  min-width: 64px;
  min-height: 48px;
}
</style>
