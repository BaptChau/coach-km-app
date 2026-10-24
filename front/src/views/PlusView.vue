<script setup lang="ts">
// "Plus" tab (UX.md section 3): Export & abandon de frais, Profil, Admin (president only),
// Déconnexion.
import { computed } from 'vue'
import { useLogout } from '@/composables/useLogout'
import { MORE_NAV } from '@/components/layout/nav'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const logout = useLogout()

const items = computed(() => MORE_NAV.filter((i) => !i.presidentOnly || auth.isPresident))
const name = computed(() =>
  auth.coach ? `${auth.coach.firstName} ${auth.coach.lastName}`.trim() : '',
)
</script>

<template>
  <section>
    <p v-if="name" class="text-body-2 text-medium-emphasis mb-3">
      Connecté en tant que <strong>{{ name }}</strong>
    </p>

    <v-card>
      <v-list lines="two" aria-label="Plus d'options">
        <v-list-item
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          :prepend-icon="item.icon"
          :title="item.label"
          :subtitle="item.subtitle"
          append-icon="mdi-chevron-right"
          min-height="56"
        />
        <v-divider />
        <v-list-item
          prepend-icon="mdi-logout"
          title="Déconnexion"
          base-color="error"
          min-height="56"
          data-testid="logout"
          @click="logout"
        />
      </v-list>
    </v-card>
  </section>
</template>
