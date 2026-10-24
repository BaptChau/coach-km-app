<script setup lang="ts">
// The trip form (UX.md sections 2, 4 and 5), the key screen of the app.
// Modes: `create` (smart defaults: today, last vehicle, last origin, round trip on),
// `edit` (the trip as is) and `repeat` ("Refaire": everything but the date, which is today).
// Live "Km retenus" and "≈ +X € sur l'année" lines; French validation on blur and submit;
// the form is never cleared on error and cannot be submitted twice.
import { computed, nextTick, reactive, ref, watch } from 'vue'
import FormDialog from '@/components/common/FormDialog.vue'
import VehicleFormDialog from '@/components/vehicles/VehicleFormDialog.vue'
import type { TripFormMode } from '@/composables/useTripEditor'
import { signedEuros } from '@/composables/useMoney'
import {
  billedKm,
  describeError,
  formatDecimal,
  parseDecimal,
  todayIso,
  vehicleLabel,
  type ErrorField,
} from '@/domain'
import { useRatesStore } from '@/stores/rates'
import { useTripsStore, yearOf } from '@/stores/trips'
import { useUiStore } from '@/stores/ui'
import { useVehiclesStore } from '@/stores/vehicles'
import type { Trip, TripInput, Vehicle } from '@/types'
import { kmLine, MAX_DISTANCE_KM, PURPOSE_SUGGESTIONS } from './tripForm'

const open = defineModel<boolean>({ default: false })
const props = withDefaults(defineProps<{ mode?: TripFormMode; trip?: Trip | null }>(), {
  mode: 'create',
  trip: null,
})
const emit = defineEmits<{ saved: [trip: Trip] }>()

const trips = useTripsStore()
const vehicles = useVehiclesStore()
const rates = useRatesStore()
const ui = useUiStore()

type Field = 'date' | 'vehicleId' | 'origin' | 'destination' | 'purpose' | 'distanceKm'
const FIELDS: Field[] = ['date', 'vehicleId', 'origin', 'destination', 'purpose', 'distanceKm']

const form = reactive({
  date: '',
  vehicleId: null as number | null,
  origin: '' as string | null,
  destination: '' as string | null,
  purpose: '' as string | null,
  distance: '',
  roundTrip: true,
})
const fieldErrors = reactive<Partial<Record<Field, string>>>({})
const error = ref<string | null>(null)
const saving = ref(false)
const vehicleFormOpen = ref(false)

const dialog = ref<InstanceType<typeof FormDialog> | null>(null)
const originField = ref<{ focus: () => void } | null>(null)
const destinationField = ref<{ focus: () => void } | null>(null)

const title = computed(
  () =>
    ({ create: 'Nouveau trajet', edit: 'Modifier le trajet', repeat: 'Refaire le trajet' })[
      props.mode
    ],
)

// --- defaults ------------------------------------------------------------------------------

function defaultVehicleId(): number | null {
  return vehicles.lastUsedVehicleId ?? vehicles.items[0]?.id ?? null
}

function fill(): void {
  const t = props.mode === 'create' ? null : props.trip
  form.date = props.mode === 'edit' && t ? t.date : todayIso()
  form.vehicleId = t && vehicles.byId(t.vehicleId) ? t.vehicleId : defaultVehicleId()
  form.origin = t ? t.origin : (trips.lastTrip?.origin ?? '')
  form.destination = t?.destination ?? ''
  form.purpose = t?.purpose ?? ''
  form.distance = t ? formatDecimal(t.distanceKm) : ''
  form.roundTrip = t ? t.roundTrip : true
  error.value = null
  for (const f of FIELDS) delete fieldErrors[f]
}

watch(
  open,
  async (isOpen) => {
    if (!isOpen) return
    fill()
    await nextTick()
    dialog.value?.resetValidation()
    // Quick log: the caret goes straight to the first empty field.
    if (props.mode === 'create') {
      setTimeout(() => (form.origin ? destinationField : originField).value?.focus(), 250)
    }
  },
  { immediate: true },
)

// A vehicle added from the form becomes the selected one; the first vehicle is picked
// once the list arrives (opened before the vehicles loaded).
watch(
  () => vehicles.items.length,
  () => {
    if (open.value && form.vehicleId == null) form.vehicleId = defaultVehicleId()
  },
)

// --- derived -------------------------------------------------------------------------------

const selectedVehicle = computed<Vehicle | undefined>(() => vehicles.byId(form.vehicleId))
const vehicleItems = computed(() =>
  vehicles.items.map((v) => ({ value: v.id, title: v.label, subtitle: vehicleLabel(v) })),
)
const distanceKm = computed(() => parseDecimal(form.distance))
const validDistance = computed(
  () => distanceKm.value != null && distanceKm.value > 0 && distanceKm.value <= MAX_DISTANCE_KM,
)
const dateYear = computed(() =>
  /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? yearOf(form.date) : ui.year,
)

watch(dateYear, (y) => rates.load(y), { immediate: true })

const kmText = computed(() =>
  validDistance.value ? kmLine(distanceKm.value as number, form.roundTrip) : null,
)

const previewCents = computed<number | null>(() => {
  const v = selectedVehicle.value
  if (!v || !validDistance.value) return null
  const editingId = props.mode === 'edit' ? (props.trip?.id ?? null) : null
  return rates.previewCents(
    v,
    billedKm(distanceKm.value as number, form.roundTrip),
    editingId,
    dateYear.value,
  )
})
const previewText = computed(() =>
  previewCents.value == null ? null : `≈ ${signedEuros(previewCents.value)} sur l’année`,
)

const purposeItems = computed(() => {
  const seen = new Set<string>()
  const list: string[] = []
  for (const p of [...PURPOSE_SUGGESTIONS, ...trips.trips.map((t) => t.purpose)]) {
    const key = p.trim().toLocaleLowerCase('fr-FR')
    if (!key || seen.has(key)) continue
    seen.add(key)
    list.push(p.trim())
    if (list.length >= 12) break
  }
  return list
})

// --- validation ----------------------------------------------------------------------------

const required = (msg: string) => (v: string | null) => !!(v ?? '').trim() || msg

const rules = {
  date: [
    (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') || 'Indiquez la date du trajet',
    (v: string) =>
      !trips.isYearLocked(yearOf(v)) ||
      `Année ${yearOf(v)} clôturée : vous avez renoncé au remboursement. Choisissez une autre date.`,
  ],
  vehicleId: [(v: number | null) => v != null || 'Choisissez un véhicule'],
  origin: [required('Indiquez le lieu de départ')],
  destination: [required('Indiquez le lieu d’arrivée')],
  purpose: [required('Indiquez le motif, par exemple « Match »')],
  distance: [
    (v: string) => !!(v ?? '').trim() || 'Indiquez la distance en km',
    (v: string) => {
      const n = parseDecimal(v)
      return (n != null && n > 0) || 'Indiquez un nombre de km, par exemple 32,5'
    },
    (v: string) => (parseDecimal(v) ?? 0) <= MAX_DISTANCE_KM || 'Au plus 100 000 km',
  ],
}

function clearError(field: Field): void {
  delete fieldErrors[field]
  error.value = null
}

function pickPurpose(p: string): void {
  form.purpose = p
  clearError('purpose')
}

// --- submit --------------------------------------------------------------------------------

function input(): TripInput {
  return {
    date: form.date,
    vehicleId: form.vehicleId as number,
    origin: (form.origin ?? '').trim(),
    destination: (form.destination ?? '').trim(),
    purpose: (form.purpose ?? '').trim(),
    distanceKm: distanceKm.value as number,
    roundTrip: form.roundTrip,
  }
}

function applyError(e: unknown): void {
  const { message, field } = describeError(e)
  const map: Partial<Record<ErrorField, Field>> = {
    date: 'date',
    vehicleId: 'vehicleId',
    origin: 'origin',
    destination: 'destination',
    purpose: 'purpose',
    distanceKm: 'distanceKm',
  }
  const target = field ? map[field] : undefined
  if (target) fieldErrors[target] = message
  else error.value = message
}

async function submit(): Promise<void> {
  if (saving.value) return
  error.value = null
  const valid = await dialog.value?.validate()
  if (!valid || form.vehicleId == null || !validDistance.value) {
    if (form.vehicleId == null) error.value = 'Ajoutez ou choisissez un véhicule.'
    return
  }
  saving.value = true
  try {
    const body = input()
    let saved: Trip
    if (props.mode === 'edit' && props.trip) {
      saved = await trips.update(props.trip.id, body)
      ui.notify('Trajet modifié')
    } else {
      saved = await trips.create(body)
      const id = saved.id
      ui.notify(
        id < 0
          ? 'Trajet enregistré : il sera synchronisé au retour du réseau'
          : 'Trajet enregistré',
        { action: { label: 'Annuler', handler: () => trips.undoCreate(id) } },
      )
    }
    emit('saved', saved)
    open.value = false
  } catch (e) {
    applyError(e)
  } finally {
    saving.value = false
  }
}

function onVehicleSaved(v: Vehicle): void {
  form.vehicleId = v.id
  clearError('vehicleId')
}
</script>

<template>
  <FormDialog ref="dialog" v-model="open" :title="title" :loading="saving" @submit="submit">
    <v-text-field
      v-model="form.date"
      label="Date"
      type="date"
      :rules="rules.date"
      :error-messages="fieldErrors.date"
      class="mb-2"
      data-testid="trip-date"
      @update:model-value="clearError('date')"
    />

    <!-- No vehicle yet: create one here, never a dead end (UX.md section 5). -->
    <v-alert
      v-if="vehicles.items.length === 0"
      type="info"
      variant="tonal"
      icon="mdi-car-off"
      class="mb-4"
      data-testid="no-vehicle"
    >
      <p class="mb-3">Ajoutez d’abord votre véhicule : le barème dépend de sa puissance.</p>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="vehicleFormOpen = true">
        Ajouter mon véhicule
      </v-btn>
    </v-alert>
    <v-select
      v-else-if="vehicles.items.length > 1"
      v-model="form.vehicleId"
      label="Véhicule"
      :items="vehicleItems"
      item-props
      :rules="rules.vehicleId"
      :error-messages="fieldErrors.vehicleId"
      class="mb-2"
      data-testid="trip-vehicle"
      @update:model-value="clearError('vehicleId')"
    />

    <v-combobox
      ref="originField"
      v-model="form.origin"
      label="Départ"
      :items="trips.recentOrigins"
      hide-no-data
      autocomplete="off"
      autocapitalize="words"
      enterkeyhint="next"
      :rules="rules.origin"
      :error-messages="fieldErrors.origin"
      class="mb-2"
      data-testid="trip-origin"
      @update:model-value="clearError('origin')"
    />
    <v-combobox
      ref="destinationField"
      v-model="form.destination"
      label="Arrivée"
      :items="trips.recentDestinations"
      hide-no-data
      autocomplete="off"
      autocapitalize="words"
      enterkeyhint="next"
      :rules="rules.destination"
      :error-messages="fieldErrors.destination"
      class="mb-2"
      data-testid="trip-destination"
      @update:model-value="clearError('destination')"
    />

    <v-combobox
      v-model="form.purpose"
      label="Motif"
      :items="purposeItems"
      hide-no-data
      autocomplete="off"
      enterkeyhint="next"
      :rules="rules.purpose"
      :error-messages="fieldErrors.purpose"
      data-testid="trip-purpose"
      @update:model-value="clearError('purpose')"
    />
    <div class="purpose-chips mb-4" role="group" aria-label="Motifs fréquents">
      <v-chip
        v-for="p in PURPOSE_SUGGESTIONS"
        :key="p"
        :color="form.purpose === p ? 'primary' : undefined"
        :variant="form.purpose === p ? 'flat' : 'outlined'"
        :aria-pressed="form.purpose === p"
        class="purpose-chip"
        :data-testid="`purpose-${p}`"
        @click="pickPurpose(p)"
      >
        {{ p }}
      </v-chip>
    </div>

    <v-text-field
      v-model="form.distance"
      label="Distance (km, aller simple)"
      inputmode="decimal"
      autocomplete="off"
      enterkeyhint="done"
      suffix="km"
      :rules="rules.distance"
      :error-messages="fieldErrors.distanceKm"
      class="mb-1"
      data-testid="trip-distance"
      @update:model-value="clearError('distanceKm')"
    />

    <v-switch
      v-model="form.roundTrip"
      label="Aller-retour"
      hide-details
      class="mb-2"
      data-testid="trip-roundtrip"
    />

    <div class="preview" aria-live="polite" data-testid="trip-preview">
      <div class="preview__km tabular-nums" data-testid="trip-km-line">
        {{ kmText ?? 'Km retenus : indiquez la distance' }}
      </div>
      <div v-if="previewText" class="preview__money tabular-nums" data-testid="trip-euro-line">
        {{ previewText }}
      </div>
      <div class="text-caption text-medium-emphasis">
        <template v-if="selectedVehicle && vehicles.items.length === 1">
          {{ selectedVehicle.label }} · {{ vehicleLabel(selectedVehicle) }} ·
        </template>
        Estimation selon le barème
      </div>
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="comfortable"
      class="mt-4"
      role="alert"
      data-testid="trip-error"
    >
      {{ error }}
    </v-alert>

    <VehicleFormDialog v-model="vehicleFormOpen" @saved="onVehicleSaved" />
  </FormDialog>
</template>

<style scoped>
.purpose-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: -4px;
}
/* 48 px touch targets for the one-tap purposes. */
.purpose-chip {
  min-height: 40px;
  padding-block: 4px;
  position: relative;
}
.purpose-chip::after {
  content: '';
  position: absolute;
  inset: -4px 0;
}
.preview {
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.08);
}
.preview__km {
  font-size: 1rem;
}
.preview__money {
  font-size: 1.25rem;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
}
</style>
