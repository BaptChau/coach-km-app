<script setup lang="ts">
// Profil (UX.md section 5): e-mail and licence number (read-only), editable names and postal
// address (needed for the tax receipt), Déconnexion. Coming from Export (`?retour=export`),
// saving goes back there.
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLogout } from '@/composables/useLogout'
import { describeError } from '@/domain'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

type Field = 'firstName' | 'lastName' | 'line' | 'postalCode' | 'city'

const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const logout = useLogout()

const form = reactive<Record<Field, string>>({
  firstName: '',
  lastName: '',
  line: '',
  postalCode: '',
  city: '',
})
const fieldErrors = reactive<Partial<Record<Field, string>>>({})
const error = ref<string | null>(null)
const saving = ref(false)
const formRef = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null)

const fromExport = computed(() => route.query.retour === 'export')

/** The coach typed something: a late `fetchMe` must not overwrite it. */
let dirty = false

watch(
  () => auth.coach,
  (c) => {
    if (dirty) return
    form.firstName = c?.firstName ?? ''
    form.lastName = c?.lastName ?? ''
    form.line = c?.address.line ?? ''
    form.postalCode = c?.address.postalCode ?? ''
    form.city = c?.address.city ?? ''
  },
  { immediate: true },
)

// Fresh data (address changed on another device); the cached coach shows meanwhile.
auth.fetchMe().catch(() => {})

const addressRequired = (msg: string) => (v: string) => !fromExport.value || !!v.trim() || msg

const rules = {
  firstName: [(v: string) => !!v.trim() || 'Indiquez votre prénom'],
  lastName: [(v: string) => !!v.trim() || 'Indiquez votre nom'],
  line: [addressRequired('Indiquez le numéro et la rue')],
  postalCode: [
    addressRequired('Indiquez le code postal'),
    (v: string) => !v.trim() || /^\d{5}$/.test(v.replace(/\s/g, '')) || 'Code postal à 5 chiffres',
  ],
  city: [addressRequired('Indiquez la ville')],
}

function clearError(field: Field): void {
  dirty = true
  delete fieldErrors[field]
  error.value = null
}

async function submit(): Promise<void> {
  if (saving.value) return
  const { valid } = (await formRef.value?.validate()) ?? { valid: true }
  if (!valid) return
  saving.value = true
  error.value = null
  try {
    await auth.updateProfile({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      address: {
        line: form.line.trim(),
        postalCode: form.postalCode.replace(/\s/g, ''),
        city: form.city.trim(),
      },
    })
    ui.notify('Profil enregistré', { color: 'success' })
    if (fromExport.value && auth.hasAddress) await router.push({ name: 'export' })
  } catch (e) {
    const { message, field } = describeError(e)
    if (field === 'firstName' || field === 'lastName') fieldErrors[field] = message
    else error.value = message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section>
    <v-alert
      v-if="fromExport && !auth.hasAddress"
      type="info"
      variant="tonal"
      class="mb-4"
      icon="mdi-home-edit-outline"
    >
      Indiquez votre adresse postale : elle sera imprimée sur votre reçu fiscal.
    </v-alert>

    <v-card class="mb-4">
      <v-list lines="two" class="py-0" aria-label="Identité">
        <v-list-item
          prepend-icon="mdi-email-outline"
          title="E-mail"
          :subtitle="auth.coach?.email"
          min-height="56"
        />
        <v-divider />
        <v-list-item
          prepend-icon="mdi-card-account-details-outline"
          title="Numéro de licence"
          :subtitle="auth.coach?.registrationNumber"
          min-height="56"
          class="tabular-nums"
        />
      </v-list>
    </v-card>

    <v-card class="mb-4">
      <v-card-text>
        <v-form ref="formRef" validate-on="blur lazy" @submit.prevent="submit">
          <h2 class="text-subtitle-1 font-weight-bold mb-3">Identité</h2>
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

          <h2 class="text-subtitle-1 font-weight-bold mb-1">Adresse postale</h2>
          <p class="text-body-2 text-medium-emphasis mb-3">Nécessaire pour le reçu fiscal.</p>
          <v-text-field
            v-model="form.line"
            label="Numéro et rue"
            autocomplete="street-address"
            :rules="rules.line"
            class="mb-2"
            data-testid="address-line"
            @update:model-value="clearError('line')"
          />
          <v-text-field
            v-model="form.postalCode"
            label="Code postal"
            inputmode="numeric"
            autocomplete="postal-code"
            maxlength="6"
            :rules="rules.postalCode"
            class="mb-2"
            data-testid="address-postal-code"
            @update:model-value="clearError('postalCode')"
          />
          <v-text-field
            v-model="form.city"
            label="Ville"
            autocomplete="address-level2"
            :rules="rules.city"
            class="mb-2"
            data-testid="address-city"
            @update:model-value="clearError('city')"
          />

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
            :loading="saving"
            :disabled="saving"
            data-testid="profile-save"
          >
            Enregistrer
          </v-btn>
        </v-form>
      </v-card-text>
    </v-card>

    <v-btn
      block
      variant="outlined"
      color="error"
      prepend-icon="mdi-logout"
      data-testid="logout"
      @click="logout"
    >
      Déconnexion
    </v-btn>
  </section>
</template>
