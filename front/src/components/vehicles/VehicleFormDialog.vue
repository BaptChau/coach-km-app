<script setup lang="ts">
// Add or edit a vehicle (UX.md section 5): Libellé, Type (segmented), Puissance fiscale
// (hidden for a moped), Électrique. The barème depends on type, CV and electric.
import { computed, reactive, ref, watch } from 'vue'
import FormDialog from '@/components/common/FormDialog.vue'
import { describeError, parseDecimal } from '@/domain'
import { useUiStore } from '@/stores/ui'
import { useVehiclesStore } from '@/stores/vehicles'
import type { Vehicle, VehicleInput, VehiclePatch, VehicleType } from '@/types'

const open = defineModel<boolean>({ default: false })
const props = defineProps<{ vehicle?: Vehicle | null }>()
const emit = defineEmits<{ saved: [vehicle: Vehicle] }>()

const vehicles = useVehiclesStore()
const ui = useUiStore()

const TYPES: { value: VehicleType; label: string }[] = [
  { value: 'car', label: 'Voiture' },
  { value: 'motorcycle', label: 'Moto' },
  { value: 'moped', label: 'Cyclomoteur' },
]

type Field = 'label' | 'fiscalHorsepower' | 'type'

const form = reactive({ label: '', type: 'car' as VehicleType, cv: '', electric: false })
const fieldErrors = reactive<Partial<Record<Field, string>>>({})
const error = ref<string | null>(null)
const saving = ref(false)
const dialog = ref<InstanceType<typeof FormDialog> | null>(null)

const editing = computed(() => !!props.vehicle)
const needsCv = computed(() => form.type !== 'moped')

watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    const v = props.vehicle
    form.label = v?.label ?? ''
    form.type = v?.type ?? 'car'
    form.cv = v?.fiscalHorsepower != null ? String(v.fiscalHorsepower) : ''
    form.electric = v?.electric ?? false
    error.value = null
    for (const k of Object.keys(fieldErrors) as Field[]) delete fieldErrors[k]
    dialog.value?.resetValidation()
  },
  { immediate: true },
)

const rules = {
  label: [(v: string) => !!v.trim() || 'Indiquez un nom, par exemple « Clio »'],
  cv: [
    (v: string) => {
      if (!needsCv.value) return true
      const n = parseDecimal(v)
      if (!v.trim()) return 'Indiquez la puissance fiscale (CV)'
      return (n != null && Number.isInteger(n) && n >= 1 && n <= 99) || 'Un nombre entre 1 et 99'
    },
  ],
}

/** The body sent to the API (exported shape is tested). */
function payload(): VehicleInput {
  return {
    label: form.label.trim(),
    type: form.type,
    fiscalHorsepower: needsCv.value ? Number(parseDecimal(form.cv)) : null,
    electric: form.electric,
  }
}

/** Only what changed, so a label change never touches the barème fields. */
function patchOf(v: Vehicle, input: VehicleInput): VehiclePatch {
  const patch: VehiclePatch = {}
  if (input.label !== v.label) patch.label = input.label
  if (input.type !== v.type) patch.type = input.type
  if (input.fiscalHorsepower !== v.fiscalHorsepower) patch.fiscalHorsepower = input.fiscalHorsepower
  if (input.electric !== v.electric) patch.electric = input.electric
  return patch
}

async function submit(): Promise<void> {
  if (saving.value) return
  if (!(await dialog.value?.validate())) return
  saving.value = true
  error.value = null
  try {
    const input = payload()
    let saved: Vehicle
    if (props.vehicle) {
      const patch = patchOf(props.vehicle, input)
      saved = Object.keys(patch).length
        ? await vehicles.update(props.vehicle.id, patch)
        : props.vehicle
      ui.notify('Véhicule modifié')
    } else {
      saved = await vehicles.create(input)
      ui.notify('Véhicule ajouté')
    }
    emit('saved', saved)
    open.value = false
  } catch (e) {
    const { message, field } = describeError(e)
    if (field === 'label' || field === 'fiscalHorsepower' || field === 'type') {
      fieldErrors[field] = message
    } else {
      error.value = message
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <FormDialog
    ref="dialog"
    v-model="open"
    :title="editing ? 'Modifier le véhicule' : 'Ajouter un véhicule'"
    :loading="saving"
    @submit="submit"
  >
    <v-text-field
      v-model="form.label"
      label="Libellé"
      hint="Le nom que vous lui donnez, par exemple « Clio »"
      autocomplete="off"
      enterkeyhint="next"
      :rules="rules.label"
      :error-messages="fieldErrors.label"
      class="mb-2"
      data-testid="vehicle-label"
      @update:model-value="fieldErrors.label = undefined"
    />

    <div id="vehicle-type-label" class="text-body-2 text-medium-emphasis mb-2">Type</div>
    <v-btn-toggle
      v-model="form.type"
      mandatory
      divided
      color="primary"
      variant="outlined"
      class="type-toggle mb-1"
      aria-labelledby="vehicle-type-label"
      data-testid="vehicle-type"
    >
      <v-btn
        v-for="t in TYPES"
        :key="t.value"
        :value="t.value"
        :prepend-icon="form.type === t.value ? 'mdi-check' : undefined"
        rounded="0"
        :aria-pressed="form.type === t.value"
        :data-testid="`type-${t.value}`"
      >
        {{ t.label }}
      </v-btn>
    </v-btn-toggle>
    <div v-if="fieldErrors.type" class="text-error text-caption mb-2">{{ fieldErrors.type }}</div>
    <div class="mb-4" />

    <v-text-field
      v-if="needsCv"
      v-model="form.cv"
      label="Puissance fiscale (CV)"
      hint="Case P.6 de la carte grise"
      persistent-hint
      inputmode="numeric"
      autocomplete="off"
      maxlength="2"
      :rules="rules.cv"
      :error-messages="fieldErrors.fiscalHorsepower"
      class="mb-2"
      data-testid="vehicle-cv"
      @update:model-value="fieldErrors.fiscalHorsepower = undefined"
    />

    <v-switch
      v-model="form.electric"
      label="Électrique"
      hint="+20 % sur le barème"
      persistent-hint
      data-testid="vehicle-electric"
    />

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="comfortable"
      class="mt-4"
      role="alert"
      data-testid="vehicle-error"
    >
      {{ error }}
    </v-alert>
  </FormDialog>
</template>

<style scoped>
.type-toggle {
  display: flex;
  width: 100%;
  height: 48px;
}
.type-toggle :deep(.v-btn) {
  flex: 1 1 0;
  min-width: 0;
  padding-inline: 4px;
  font-size: 0.875rem;
  letter-spacing: 0;
  text-transform: none;
}
</style>
