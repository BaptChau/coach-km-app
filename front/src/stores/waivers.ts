// Abandon de frais: the coach's waived years and receipts (issue #9). A waived year is
// locked: its trips are read-only (the trips store refuses mutations up front).
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { saveBlob, waivers as waiversApi } from '@/api'
import type { Waiver } from '@/types'

export const useWaiversStore = defineStore(
  'waivers',
  () => {
    const items = ref<Waiver[]>([])
    const loaded = ref(false)
    const loading = ref(false)

    /** Waived (locked) years, ascending. */
    const lockedYears = computed(() => items.value.map((w) => w.year).sort((a, b) => a - b))

    function isLocked(year: number): boolean {
      return items.value.some((w) => w.year === year)
    }

    function byYear(year: number): Waiver | undefined {
      return items.value.find((w) => w.year === year)
    }

    async function load(): Promise<Waiver[]> {
      loading.value = true
      try {
        items.value = await waiversApi.list()
        loaded.value = true
        return items.value
      } finally {
        loading.value = false
      }
    }

    /** Waives a year (locks it). 400 without an address or mileage, 409 if already waived. */
    async function waive(year: number): Promise<Waiver> {
      const waiver = await waiversApi.create(year)
      items.value = [...items.value.filter((w) => w.year !== year), waiver]
      return waiver
    }

    /** Withdraws a waiver (unlocks the year). 409 once a receipt is issued. */
    async function withdraw(year: number): Promise<void> {
      await waiversApi.remove(year)
      items.value = items.value.filter((w) => w.year !== year)
    }

    /** Downloads the Cerfa 11580 receipt PDF and hands it to the browser. */
    async function downloadReceipt(receiptId: number): Promise<void> {
      const { blob, filename } = await waiversApi.receiptPdf(receiptId)
      saveBlob(blob, filename)
    }

    function reset(): void {
      items.value = []
      loaded.value = false
      loading.value = false
    }

    return {
      items,
      loaded,
      loading,
      lockedYears,
      isLocked,
      byYear,
      load,
      waive,
      withdraw,
      downloadReceipt,
      reset,
    }
  },
  { persist: { key: 'coach-km:waivers', pick: ['items'] } },
)
