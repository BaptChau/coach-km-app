<script setup lang="ts">
// Connexion (minimal, issue #10; polished in #11). On success: offline-queue flush, then
// back to `?redirect` (or Accueil).
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isApiRequestError } from '@/api'
import PublicShell from '@/components/layout/PublicShell.vue'
import { errorMessage } from '@/domain'
import { safeRedirect } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useTripsStore } from '@/stores/trips'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const trips = useTripsStore()

const form = reactive({ email: '', password: '' })
const showPassword = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

const rules = {
  email: [(v: string) => !!v.trim() || 'Indiquez votre e-mail'],
  password: [(v: string) => !!v || 'Indiquez votre mot de passe'],
}

function messageFor(e: unknown): string {
  if (isApiRequestError(e)) {
    if (e.isUnauthorized) return 'E-mail ou mot de passe incorrect.'
    if (e.isNetworkError) return 'Connexion impossible : vérifiez votre réseau et réessayez.'
    if (e.isValidation) return 'Vérifiez votre e-mail et votre mot de passe.'
  }
  return errorMessage(e)
}

async function submit(): Promise<void> {
  if (loading.value || !form.email.trim() || !form.password) return
  loading.value = true
  error.value = null
  try {
    await auth.login({ email: form.email.trim(), password: form.password })
    // Trips logged offline before the session expired sync now.
    trips.flushQueue().catch(() => {})
    await router.replace(safeRedirect(route.query.redirect))
  } catch (e) {
    error.value = messageFor(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <PublicShell title="Connexion">
    <v-form validate-on="blur" @submit.prevent="submit">
      <v-text-field
        v-model="form.email"
        label="E-mail"
        type="email"
        autocomplete="email"
        inputmode="email"
        autocapitalize="off"
        spellcheck="false"
        :rules="rules.email"
        class="mb-2"
      />
      <v-text-field
        v-model="form.password"
        label="Mot de passe"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="current-password"
        :rules="rules.password"
        class="mb-2"
      >
        <template #append-inner>
          <v-btn
            :icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
            :aria-label="showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'"
            variant="text"
            size="default"
            density="comfortable"
            @click="showPassword = !showPassword"
          />
        </template>
      </v-text-field>

      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        density="comfortable"
        class="mb-4"
        role="alert"
        data-testid="login-error"
      >
        {{ error }}
      </v-alert>

      <v-btn
        type="submit"
        color="primary"
        block
        size="large"
        :loading="loading"
        :disabled="loading"
      >
        Se connecter
      </v-btn>
    </v-form>

    <div class="text-center text-body-2 mt-6">
      Pas encore de compte ?
      <v-btn variant="text" color="primary" :to="{ name: 'register', query: route.query }">
        Créer un compte
      </v-btn>
    </div>
  </PublicShell>
</template>
