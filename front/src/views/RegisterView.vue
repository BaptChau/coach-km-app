<script setup lang="ts">
// Inscription (minimal, issue #10; polished in #11). API errors go under the field they
// concern (409 "Cet e-mail est déjà inscrit"); the form is never cleared on error.
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isApiRequestError } from '@/api'
import PublicShell from '@/components/layout/PublicShell.vue'
import { safeRedirect } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useTripsStore } from '@/stores/trips'

type Field = 'email' | 'registrationNumber' | 'firstName' | 'lastName' | 'password'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const trips = useTripsStore()

const form = reactive<Record<Field, string>>({
  email: '',
  registrationNumber: '',
  firstName: '',
  lastName: '',
  password: '',
})
const fieldErrors = reactive<Partial<Record<Field, string>>>({})
const showPassword = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const formRef = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LICENCE = /^5655006\d{6}$/

const rules: Record<Field, ((v: string) => true | string)[]> = {
  email: [
    (v) => !!v.trim() || 'Indiquez votre e-mail',
    (v) => EMAIL.test(v.trim()) || 'Cet e-mail ne semble pas valide',
  ],
  registrationNumber: [
    (v) => !!v.trim() || 'Indiquez votre numéro de licence',
    (v) => LICENCE.test(v.replace(/\s/g, '')) || '13 chiffres, commençant par 5655006',
  ],
  firstName: [(v) => !!v.trim() || 'Indiquez votre prénom'],
  lastName: [(v) => !!v.trim() || 'Indiquez votre nom'],
  password: [(v) => v.length >= 8 || 'Au moins 8 caractères'],
}

/** Message under a field the API rejected with a 400. */
const INVALID: Record<Field, string> = {
  email: 'Cet e-mail ne semble pas valide',
  registrationNumber: '13 chiffres, commençant par 5655006',
  firstName: 'Indiquez votre prénom (100 caractères max.)',
  lastName: 'Indiquez votre nom (100 caractères max.)',
  password: 'Entre 8 et 72 caractères',
}

/** Maps an API `{ error }` message to the field it names. */
function applyApiError(e: unknown): void {
  if (!isApiRequestError(e)) {
    error.value = 'Une erreur est survenue. Réessayez dans un instant.'
    return
  }
  const msg = e.serverMessage ?? ''
  if (e.isConflict && msg.startsWith('email')) fieldErrors.email = 'Cet e-mail est déjà inscrit'
  else if (e.isConflict && msg.startsWith('registrationNumber'))
    fieldErrors.registrationNumber = 'Ce numéro de licence est déjà inscrit'
  else if (e.isValidation) {
    const field = (Object.keys(form) as Field[]).find((f) => msg.startsWith(f))
    if (field) fieldErrors[field] = INVALID[field]
    else error.value = 'Vérifiez les informations saisies.'
  } else if (e.isNetworkError) {
    error.value = 'Inscription impossible : vérifiez votre réseau et réessayez.'
  } else {
    error.value = 'Une erreur est survenue. Réessayez dans un instant.'
  }
}

function clearError(field: Field): void {
  delete fieldErrors[field]
}

async function submit(): Promise<void> {
  if (loading.value) return
  const { valid } = (await formRef.value?.validate()) ?? { valid: true }
  if (!valid) return
  loading.value = true
  error.value = null
  try {
    await auth.register({
      email: form.email.trim(),
      registrationNumber: form.registrationNumber.replace(/\s/g, ''),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      password: form.password,
    })
    trips.flushQueue().catch(() => {})
    await router.replace(safeRedirect(route.query.redirect))
  } catch (e) {
    applyApiError(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <PublicShell title="Inscription">
    <v-form ref="formRef" validate-on="blur" @submit.prevent="submit">
      <v-text-field
        v-model="form.email"
        label="E-mail"
        type="email"
        autocomplete="email"
        inputmode="email"
        autocapitalize="off"
        spellcheck="false"
        :rules="rules.email"
        :error-messages="fieldErrors.email"
        class="mb-2"
        @update:model-value="clearError('email')"
      />
      <v-text-field
        v-model="form.registrationNumber"
        label="Numéro de licence"
        inputmode="numeric"
        autocomplete="off"
        hint="13 chiffres, commence par 5655006"
        persistent-hint
        :rules="rules.registrationNumber"
        :error-messages="fieldErrors.registrationNumber"
        class="mb-2"
        @update:model-value="clearError('registrationNumber')"
      />
      <v-text-field
        v-model="form.firstName"
        label="Prénom"
        autocomplete="given-name"
        :rules="rules.firstName"
        :error-messages="fieldErrors.firstName"
        class="mb-2"
        @update:model-value="clearError('firstName')"
      />
      <v-text-field
        v-model="form.lastName"
        label="Nom"
        autocomplete="family-name"
        :rules="rules.lastName"
        :error-messages="fieldErrors.lastName"
        class="mb-2"
        @update:model-value="clearError('lastName')"
      />
      <v-text-field
        v-model="form.password"
        label="Mot de passe"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="new-password"
        hint="Au moins 8 caractères"
        persistent-hint
        :rules="rules.password"
        :error-messages="fieldErrors.password"
        class="mb-4"
        @update:model-value="clearError('password')"
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
        Créer mon compte
      </v-btn>
    </v-form>

    <div class="text-center text-body-2 mt-6">
      Déjà inscrit ?
      <v-btn variant="text" color="primary" :to="{ name: 'login', query: route.query }">
        Se connecter
      </v-btn>
    </div>
  </PublicShell>
</template>
