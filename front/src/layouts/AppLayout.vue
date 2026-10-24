<script setup lang="ts">
// Shell of every authenticated screen (issue #10): offline banner, app bar, navigation
// (bottom nav below `md`, drawer/rail from `md`), and the main area (max 960 px).
//
// FAB (issue #11): HomeView and TripsView mount their own
//   <v-fab app location="bottom end" extended prepend-icon="mdi-plus" text="Ajouter un trajet" />
// With `app`, Vuetify places it above the bottom nav (layout item). The main area below
// keeps `--fab-clearance` of bottom padding on mobile, so the last list item is never
// hidden under the FAB or the bottom nav. Hide the FAB on a locked (waived) year.
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useOnline } from '@/composables/useOnline'
import AppBar from '@/components/layout/AppBar.vue'
import BottomNav from '@/components/layout/BottomNav.vue'
import NavDrawer from '@/components/layout/NavDrawer.vue'
import OfflineBanner from '@/components/layout/OfflineBanner.vue'
import InstallPrompt from '@/components/pwa/InstallPrompt.vue'

// The one `useOnline()` of the app: `online` events and the mount (app start or right
// after login) flush the offline queue.
const { isOnline } = useOnline()
const { isMobile, isRail } = useBreakpoint()
</script>

<template>
  <OfflineBanner :online="isOnline" />
  <AppBar />
  <NavDrawer v-if="!isMobile" :rail="isRail" />

  <v-main>
    <div class="app-content" :class="{ 'app-content--mobile': isMobile }">
      <InstallPrompt />
      <slot />
    </div>
  </v-main>

  <BottomNav v-if="isMobile" />
</template>

<style scoped>
.app-content {
  /* Room for the FAB (56 px + 16 px margin) and a bit of air, above the bottom nav. */
  --fab-clearance: 88px;
  max-width: 960px;
  margin-inline: auto;
  padding: 16px 16px 32px;
}

/* `v-main` already pads by the bottom nav height; add the safe area and the FAB room. */
.app-content--mobile {
  padding-bottom: calc(var(--fab-clearance) + env(safe-area-inset-bottom, 0px));
}
</style>
