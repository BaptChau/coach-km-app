<script setup lang="ts">
// Export & abandon de frais (UX.md sections 2.4 and 5): the year's récapitulatif (PDF/CSV),
// then the waiver step by step: explanation → address → "Renoncer…" (confirmation: the
// year's trips get locked) → status (withdrawable) → receipt issued → download it.
import { computed, ref, watch } from 'vue'
import { exportApi, saveBlob } from '@/api'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import MoneyFigure from '@/components/common/MoneyFigure.vue'
import { errorMessage, formatDate, formatEuros, formatKm, toCents } from '@/domain'
import { useAuthStore } from '@/stores/auth'
import { useSummaryStore } from '@/stores/summary'
import { useUiStore } from '@/stores/ui'
import { useWaiversStore } from '@/stores/waivers'
import type { ExportFormat } from '@/types'

const ui = useUiStore()
const auth = useAuthStore()
const summary = useSummaryStore()
const waivers = useWaiversStore()

watch(
  () => ui.year,
  (y) => {
    summary.load(y).catch(() => {})
  },
  { immediate: true },
)
waivers.load().catch(() => {})

// --- export --------------------------------------------------------------------------------

const downloading = ref<ExportFormat | null>(null)

async function download(format: ExportFormat): Promise<void> {
  if (downloading.value) return
  downloading.value = format
  try {
    const { blob, filename } = await exportApi.download(ui.year, format)
    saveBlob(blob, filename)
  } catch (e) {
    ui.notify(errorMessage(e, 'Le téléchargement a échoué. Réessayez.'), { color: 'error' })
  } finally {
    downloading.value = null
  }
}

// --- waiver --------------------------------------------------------------------------------

const waiver = computed(() => waivers.byYear(ui.year) ?? null)
const yearSummary = computed(() =>
  summary.data && summary.data.year === ui.year ? summary.data : null,
)
const amountText = computed(() => formatEuros(toCents(yearSummary.value?.totalAmount ?? 0)))
const hasKm = computed(() => (yearSummary.value?.totalKm ?? 0) > 0)
const isFutureOrCurrent = computed(() => ui.year >= new Date().getFullYear())

/** Which step the coach is at. */
const step = computed<'address' | 'waive' | 'waived' | 'receipt'>(() => {
  if (waiver.value?.receipt) return 'receipt'
  if (waiver.value) return 'waived'
  return auth.hasAddress ? 'waive' : 'address'
})

const confirmOpen = ref(false)
const busy = ref(false)

async function waive(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await waivers.waive(ui.year)
    confirmOpen.value = false
    ui.notify(`Renonciation ${ui.year} enregistrée`, { color: 'success' })
  } catch (e) {
    confirmOpen.value = false
    ui.notify(errorMessage(e), { color: 'error', timeout: 8000 })
  } finally {
    busy.value = false
  }
}

async function withdraw(): Promise<void> {
  if (busy.value) return
  busy.value = true
  const year = ui.year
  try {
    await waivers.withdraw(year)
    ui.notify(`Renonciation ${year} annulée : vos trajets sont de nouveau modifiables`)
  } catch (e) {
    ui.notify(errorMessage(e), { color: 'error', timeout: 8000 })
  } finally {
    busy.value = false
  }
}

async function downloadReceipt(): Promise<void> {
  const receipt = waiver.value?.receipt
  if (!receipt || busy.value) return
  busy.value = true
  try {
    await waivers.downloadReceipt(receipt.id)
  } catch (e) {
    ui.notify(errorMessage(e, 'Le téléchargement a échoué. Réessayez.'), { color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section>
    <!-- Récapitulatif -->
    <h2 class="text-subtitle-1 font-weight-bold mb-2">Récapitulatif {{ ui.year }}</h2>
    <p class="text-body-2 text-medium-emphasis mb-3">
      Le détail de vos trajets et le montant de l’année, à garder ou à joindre à votre déclaration.
    </p>
    <div class="downloads mb-6">
      <v-btn
        color="primary"
        size="x-large"
        prepend-icon="mdi-file-pdf-box"
        :loading="downloading === 'pdf'"
        :disabled="!!downloading"
        data-testid="download-pdf"
        @click="download('pdf')"
      >
        Télécharger le PDF
      </v-btn>
      <v-btn
        color="primary"
        variant="tonal"
        size="x-large"
        prepend-icon="mdi-file-delimited-outline"
        :loading="downloading === 'csv'"
        :disabled="!!downloading"
        data-testid="download-csv"
        @click="download('csv')"
      >
        Télécharger le CSV
      </v-btn>
    </div>

    <!-- Abandon de frais -->
    <v-card data-testid="waiver-card">
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">
        <v-icon icon="mdi-hand-heart-outline" class="me-1" aria-hidden="true" />
        Abandon de frais {{ ui.year }}
      </v-card-title>
      <v-card-text class="text-body-1">
        <p class="mb-4">
          Vous pouvez renoncer au remboursement de vos frais : l’association vous remet alors un
          reçu fiscal, et <strong>66 % du montant</strong> vous revient en réduction d’impôt.
        </p>

        <div class="amount mb-4">
          <div class="text-body-2 text-medium-emphasis">Montant de l’année</div>
          <MoneyFigure
            :euros="waiver ? waiver.amount : (yearSummary?.totalAmount ?? 0)"
            size="large"
          />
          <span class="text-body-2 text-medium-emphasis tabular-nums">
            · {{ formatKm(waiver ? waiver.km : (yearSummary?.totalKm ?? 0)) }}
          </span>
        </div>

        <!-- Step 1: address -->
        <div v-if="step === 'address'" data-testid="waiver-address">
          <v-alert type="warning" variant="tonal" icon="mdi-home-alert-outline" class="mb-3">
            Votre adresse postale est nécessaire : elle figure sur le reçu fiscal.
          </v-alert>
          <v-btn
            block
            color="primary"
            prepend-icon="mdi-account-edit-outline"
            :to="{ name: 'profile', query: { retour: 'export' } }"
            data-testid="waiver-to-profile"
          >
            Compléter mon adresse
          </v-btn>
        </div>

        <!-- Step 2: waive -->
        <div v-else-if="step === 'waive'" data-testid="waiver-waive">
          <p v-if="!hasKm" class="text-medium-emphasis mb-0">
            Aucun trajet en {{ ui.year }} : rien à déclarer pour l’instant.
          </p>
          <template v-else>
            <p v-if="isFutureOrCurrent" class="text-body-2 text-medium-emphasis mb-3">
              L’année {{ ui.year }} est en cours : en général, on renonce une fois l’année terminée,
              quand tous les trajets sont saisis.
            </p>
            <v-btn
              block
              color="primary"
              variant="flat"
              class="waive-btn"
              data-testid="waiver-start"
              @click="confirmOpen = true"
            >
              Renoncer au remboursement de {{ amountText }}
            </v-btn>
          </template>
        </div>

        <!-- Step 3: waived, waiting for the receipt -->
        <div v-else-if="step === 'waived' && waiver" data-testid="waiver-waived">
          <v-alert type="success" variant="tonal" icon="mdi-check-circle-outline" class="mb-3">
            <strong>Renonciation enregistrée</strong> le {{ formatDate(waiver.waivedAt) }}.<br />
            Le président doit maintenant émettre votre reçu fiscal. Les trajets de
            {{ ui.year }} sont verrouillés.
          </v-alert>
          <v-btn
            block
            variant="text"
            color="error"
            :loading="busy"
            :disabled="busy"
            data-testid="waiver-withdraw"
            @click="withdraw"
          >
            Annuler ma renonciation
          </v-btn>
        </div>

        <!-- Step 4: receipt issued -->
        <div v-else-if="step === 'receipt' && waiver?.receipt" data-testid="waiver-receipt">
          <v-alert type="success" variant="tonal" icon="mdi-check-decagram" class="mb-3">
            <strong>Reçu émis n° {{ waiver.receipt.number }}</strong>
            le {{ formatDate(waiver.receipt.issuedAt) }}.<br />
            Joignez-le à votre déclaration de revenus.
          </v-alert>
          <v-btn
            block
            color="primary"
            prepend-icon="mdi-download"
            :loading="busy"
            :disabled="busy"
            data-testid="receipt-download"
            @click="downloadReceipt"
          >
            Télécharger mon reçu fiscal
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <ConfirmDialog
      v-model="confirmOpen"
      :title="`Renoncer au remboursement de ${amountText} ?`"
      confirm-label="Je renonce"
      color="primary"
      :loading="busy"
      @confirm="waive"
    >
      <p class="mb-3">
        Vous ne serez pas remboursé de vos frais {{ ui.year }}. Le président émettra un reçu fiscal
        : 66 % du montant vous revient en réduction d’impôt.
      </p>
      <p class="mb-0">
        <v-icon icon="mdi-lock" size="small" aria-hidden="true" />
        <strong>Les trajets de {{ ui.year }} seront verrouillés</strong> : vous ne pourrez plus les
        modifier, les supprimer ni en ajouter, sauf si vous annulez avant l’émission du reçu.
      </p>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
.downloads {
  display: grid;
  gap: 12px;
}
@media (min-width: 600px) {
  .downloads {
    grid-template-columns: 1fr 1fr;
  }
}
.downloads :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0;
}
.amount {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 8px;
}
.amount > :first-child {
  flex-basis: 100%;
}
/* The amount is in the label: let it wrap on small screens. */
.waive-btn {
  height: auto !important;
  min-height: 52px;
  white-space: normal;
  text-transform: none;
  letter-spacing: 0;
}
.waive-btn :deep(.v-btn__content) {
  white-space: normal;
}
</style>
