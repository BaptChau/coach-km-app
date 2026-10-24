<script setup lang="ts">
// Admin, president only (UX.md sections 2.5 and 5): every coach of `ui.year` with km, € and
// a status chip (icon + text); filter chips; "Émettre le reçu" (confirmation), then
// "Télécharger".
import { computed, ref, watch } from 'vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import MoneyFigure from '@/components/common/MoneyFigure.vue'
import SkeletonList from '@/components/common/SkeletonList.vue'
import { errorMessage, formatEuros, formatKm, toCents } from '@/domain'
import { useAdminStore } from '@/stores/admin'
import { useUiStore } from '@/stores/ui'
import type { CoachYear } from '@/types'

type Filter = 'all' | 'toIssue' | 'issued' | 'noWaiver'
type Status = Exclude<Filter, 'all'>

const ui = useUiStore()
const admin = useAdminStore()

const filter = ref<Filter>('all')
const loadError = ref<string | null>(null)

watch(
  () => ui.year,
  async (y) => {
    loadError.value = null
    try {
      await admin.coaches(y)
    } catch (e) {
      loadError.value = errorMessage(e)
    }
  },
  { immediate: true },
)

function statusOf(row: CoachYear): Status {
  if (!row.waiver) return 'noWaiver'
  return row.waiver.receipt ? 'issued' : 'toIssue'
}

const STATUS = {
  toIssue: { label: 'À émettre', icon: 'mdi-clock-outline', color: 'warning' },
  issued: { label: 'Reçu émis', icon: 'mdi-check-decagram', color: 'success' },
  noWaiver: { label: 'Sans renonciation', icon: 'mdi-minus-circle-outline', color: undefined },
} as const

const rows = computed(() => admin.coachesByYear[ui.year] ?? [])
const counts = computed(() => {
  const c: Record<Filter, number> = { all: rows.value.length, toIssue: 0, issued: 0, noWaiver: 0 }
  for (const r of rows.value) c[statusOf(r)]++
  return c
})
const shown = computed(() =>
  filter.value === 'all' ? rows.value : rows.value.filter((r) => statusOf(r) === filter.value),
)
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'toIssue', label: 'À émettre' },
  { value: 'issued', label: 'Émis' },
  { value: 'noWaiver', label: 'Sans renonciation' },
]

const loading = computed(() => admin.loading && !admin.coachesByYear[ui.year])

function nameOf(row: CoachYear): string {
  return `${row.coach.firstName} ${row.coach.lastName}`.trim() || row.coach.email
}
function amountOf(row: CoachYear): number {
  return row.waiver ? row.waiver.amount : row.totalAmount
}

// --- actions -------------------------------------------------------------------------------

const confirmRow = ref<CoachYear | null>(null)
const confirmOpen = computed({
  get: () => !!confirmRow.value,
  set: (v: boolean) => {
    if (!v) confirmRow.value = null
  },
})
const issuing = ref(false)
const downloadingId = ref<number | null>(null)

async function issue(): Promise<void> {
  const row = confirmRow.value
  if (!row || issuing.value) return
  issuing.value = true
  try {
    const receipt = await admin.issueReceipt(row.coach.id, ui.year)
    ui.notify(`Reçu n° ${receipt.number} émis pour ${nameOf(row)}`, { color: 'success' })
    confirmRow.value = null
  } catch (e) {
    confirmRow.value = null
    ui.notify(errorMessage(e), { color: 'error', timeout: 8000 })
  } finally {
    issuing.value = false
  }
}

async function download(receiptId: number): Promise<void> {
  if (downloadingId.value) return
  downloadingId.value = receiptId
  try {
    await admin.downloadReceipt(receiptId)
  } catch (e) {
    ui.notify(errorMessage(e, 'Le téléchargement a échoué. Réessayez.'), { color: 'error' })
  } finally {
    downloadingId.value = null
  }
}
</script>

<template>
  <section>
    <div
      class="filters mb-3"
      role="group"
      aria-label="Filtrer les coachs"
      data-testid="admin-filters"
    >
      <v-chip
        v-for="f in FILTERS"
        :key="f.value"
        :color="filter === f.value ? 'primary' : undefined"
        :variant="filter === f.value ? 'flat' : 'outlined'"
        :prepend-icon="filter === f.value ? 'mdi-check' : undefined"
        :aria-pressed="filter === f.value"
        class="filter-chip"
        :data-testid="`filter-${f.value}`"
        @click="filter = f.value"
      >
        {{ f.label }} ({{ counts[f.value] }})
      </v-chip>
    </div>

    <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">{{ loadError }}</v-alert>

    <SkeletonList v-if="loading" :count="3" type="list-item-three-line" />

    <v-card v-else-if="!shown.length">
      <EmptyState
        icon="mdi-account-search-outline"
        :title="rows.length ? 'Aucun coach dans ce filtre.' : `Aucun coach en ${ui.year}.`"
      />
    </v-card>

    <v-card v-for="row in shown" v-else :key="row.coach.id" class="mb-3" data-testid="coach-card">
      <v-card-text>
        <div class="d-flex align-start justify-space-between ga-2">
          <div class="min-w-0">
            <div class="text-subtitle-1 font-weight-bold coach-name">{{ nameOf(row) }}</div>
            <div class="text-body-2 text-medium-emphasis tabular-nums">
              Licence {{ row.coach.registrationNumber }}
            </div>
          </div>
          <v-chip
            :color="STATUS[statusOf(row)].color"
            :prepend-icon="STATUS[statusOf(row)].icon"
            variant="tonal"
            size="small"
            label
            class="flex-shrink-0"
            data-testid="coach-status"
          >
            {{ STATUS[statusOf(row)].label }}
          </v-chip>
        </div>

        <div class="d-flex align-baseline ga-2 mt-2">
          <MoneyFigure :euros="amountOf(row)" size="large" />
          <span class="text-body-2 text-medium-emphasis tabular-nums">
            · {{ formatKm(row.waiver ? row.waiver.km : row.totalKm) }}
          </span>
        </div>
        <div v-if="row.waiver?.receipt" class="text-body-2 mt-1">
          Reçu n° {{ row.waiver.receipt.number }}
        </div>
      </v-card-text>

      <v-card-actions v-if="row.waiver" class="px-4 pb-4 pt-0">
        <v-btn
          v-if="!row.waiver.receipt"
          block
          color="primary"
          variant="flat"
          prepend-icon="mdi-file-sign"
          data-testid="issue-receipt"
          @click="confirmRow = row"
        >
          Émettre le reçu
        </v-btn>
        <v-btn
          v-else
          block
          variant="tonal"
          color="primary"
          prepend-icon="mdi-download"
          :loading="downloadingId === row.waiver.receipt.id"
          :aria-label="`Télécharger le reçu n° ${row.waiver.receipt.number} de ${nameOf(row)}`"
          data-testid="download-receipt"
          @click="download(row.waiver.receipt.id)"
        >
          Télécharger
        </v-btn>
      </v-card-actions>
    </v-card>

    <ConfirmDialog
      v-model="confirmOpen"
      title="Émettre le reçu fiscal ?"
      confirm-label="Émettre le reçu"
      :loading="issuing"
      @confirm="issue"
    >
      <template v-if="confirmRow">
        <p class="mb-3">
          Reçu {{ ui.year }} pour <strong>{{ nameOf(confirmRow) }}</strong> :
          <strong class="tabular-nums">{{ formatEuros(toCents(amountOf(confirmRow))) }}</strong
          >.
        </p>
        <p class="mb-0">Un reçu émis reçoit un numéro définitif et ne peut plus être modifié.</p>
      </template>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.filter-chip {
  min-height: 40px;
}
.min-w-0 {
  min-width: 0;
}
.coach-name {
  overflow-wrap: anywhere;
}
</style>
