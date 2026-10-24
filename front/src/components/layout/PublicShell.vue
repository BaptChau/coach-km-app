<script setup lang="ts">
// Frame of the public pages (Connexion, Inscription): logo + app name, one column.
defineProps<{ title: string }>()
</script>

<template>
  <div class="public-shell">
    <header class="text-center mb-6">
      <v-avatar color="primary" size="56" class="mb-3">
        <v-icon icon="mdi-steering" size="32" />
      </v-avatar>
      <div class="text-h5 font-weight-bold">Coach KM</div>
      <div class="text-body-2 text-medium-emphasis">Frais kilométriques des coachs bénévoles</div>
    </header>

    <h1 class="text-h6 mb-4">{{ title }}</h1>
    <slot />
  </div>
</template>

<style scoped>
.public-shell {
  max-width: 440px;
  margin-inline: auto;
  padding: 32px 16px calc(32px + env(safe-area-inset-bottom, 0px));
}
</style>
