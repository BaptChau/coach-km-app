<script setup lang="ts">
// Root: picks the layout from the route meta (public pages have no navigation), hosts the
// single snackbar, and sends the user to the login page when the session ends.
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SnackbarHost from '@/components/layout/SnackbarHost.vue'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

// Before the first navigation resolves, `route` is the START_LOCATION (no meta): show no shell.
const withShell = computed(() => route.matched.length > 0 && !route.meta.public)

// The stores have no router: logout() and an expired session (401) only clear the token.
// `sync` so that a deliberate logout's own `router.replace('/login')` runs after this one
// and wins (no `?redirect` back to the screen the user left).
watch(
  () => auth.isAuthenticated,
  (signedIn) => {
    const current = router.currentRoute.value
    if (signedIn || current.meta.public || current.matched.length === 0) return
    void router.replace({ name: 'login', query: { redirect: current.fullPath } })
  },
  { flush: 'sync' },
)
</script>

<template>
  <v-app>
    <AppLayout v-if="withShell">
      <router-view />
    </AppLayout>
    <v-main v-else>
      <router-view />
    </v-main>

    <!-- In the root (not the shell) so login pages can show it too, e.g. "Session expirée". -->
    <SnackbarHost />
  </v-app>
</template>
