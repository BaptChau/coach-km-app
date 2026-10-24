<script setup lang="ts">
// 12 bars, one per month (UX.md section 5). Plain CSS, no chart library. The current month is
// highlighted (colour and a dot under its letter); tapping a bar shows its km and €. Each bar
// is a button with a full French label, and a visually hidden table gives the same data.
import { computed, ref, watch } from 'vue'
import { formatEuros, formatKm, toCents } from '@/domain'
import type { MonthTotal } from '@/types'

const props = defineProps<{ months: MonthTotal[]; year: number }>()

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

const now = new Date()
const currentMonth = computed(() => (props.year === now.getFullYear() ? now.getMonth() + 1 : null))

const rows = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const m = props.months.find((x) => x.month === i + 1)
    return { month: i + 1, km: m?.km ?? 0, amount: m?.amount ?? 0 }
  }),
)
const maxKm = computed(() => Math.max(...rows.value.map((r) => r.km), 0))

/** The bar whose details show: the tapped one, else the current month. */
const selected = ref<number | null>(null)
watch(
  () => props.year,
  () => (selected.value = null),
)
const shown = computed(() => {
  const month = selected.value ?? currentMonth.value
  return month ? rows.value[month - 1] : null
})

function heightOf(km: number): string {
  if (!maxKm.value || km <= 0) return '0%'
  return `${Math.max(4, (km / maxKm.value) * 100)}%`
}

function describe(r: { month: number; km: number; amount: number }): string {
  return `${MONTHS[r.month - 1]} : ${formatKm(r.km)}, ${formatEuros(toCents(r.amount))}`
}
</script>

<template>
  <div class="chart">
    <div class="chart__details text-body-2" aria-live="polite" data-testid="chart-details">
      <template v-if="shown">
        <span class="font-weight-medium chart__month">{{ MONTHS[shown.month - 1] }}</span>
        <span class="tabular-nums">
          · {{ formatKm(shown.km) }} · {{ formatEuros(toCents(shown.amount)) }}
        </span>
      </template>
      <span v-else class="text-medium-emphasis">Touchez un mois pour voir le détail</span>
    </div>

    <div class="chart__bars" role="group" :aria-label="`Kilomètres par mois en ${year}`">
      <button
        v-for="r in rows"
        :key="r.month"
        type="button"
        class="chart__col"
        :class="{
          'chart__col--current': r.month === currentMonth,
          'chart__col--selected': r.month === selected,
        }"
        :aria-label="describe(r)"
        :aria-pressed="r.month === selected"
        data-testid="chart-bar"
        @click="selected = selected === r.month ? null : r.month"
      >
        <span class="chart__track" aria-hidden="true">
          <span class="chart__bar" :style="{ height: heightOf(r.km) }" />
        </span>
        <span class="chart__letter" aria-hidden="true">
          {{ MONTHS[r.month - 1]?.charAt(0).toUpperCase() }}
        </span>
      </button>
    </div>

    <table class="sr-only">
      <caption>
        Kilomètres et montants par mois en
        {{
          year
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">Mois</th>
          <th scope="col">Kilomètres</th>
          <th scope="col">Montant</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.month">
          <th scope="row">{{ MONTHS[r.month - 1] }}</th>
          <td>{{ formatKm(r.km) }}</td>
          <td>{{ formatEuros(toCents(r.amount)) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.chart__details {
  min-height: 24px;
  margin-bottom: 8px;
}
.chart__month::first-letter {
  text-transform: uppercase;
}
.chart__bars {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 2px;
  height: 132px; /* reserved: no layout shift */
}
.chart__col {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  cursor: pointer;
}
.chart__col:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}
.chart__track {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  flex: 1 1 auto;
  width: 100%;
}
.chart__bar {
  display: block;
  width: 70%;
  max-width: 28px;
  border-radius: 4px 4px 0 0;
  background: rgba(var(--v-theme-primary), 0.35);
}
.chart__col--current .chart__bar {
  background: rgb(var(--v-theme-secondary));
}
.chart__col--selected .chart__bar {
  background: rgb(var(--v-theme-primary));
}
.chart__letter {
  height: 20px;
  line-height: 20px;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
/* Not colour alone: the current month's letter is bold and underlined. */
.chart__col--current .chart__letter {
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
  color: rgb(var(--v-theme-on-surface));
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
