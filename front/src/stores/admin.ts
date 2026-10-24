// President-only data: coaches overview and receipts per year (issue #9).
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { admin as adminApi, saveBlob, waivers as waiversApi } from '@/api'
import type { CoachYear, Receipt } from '@/types'

export const useAdminStore = defineStore('admin', () => {
  const coachesByYear = ref<Record<number, CoachYear[]>>({})
  const receiptsByYear = ref<Record<number, Receipt[]>>({})
  const loading = ref(false)

  /** Fetches every coach's total and waiver for `year`. */
  async function coaches(year: number): Promise<CoachYear[]> {
    loading.value = true
    try {
      const rows = await adminApi.coaches(year)
      coachesByYear.value[year] = rows
      return rows
    } finally {
      loading.value = false
    }
  }

  async function receipts(year: number): Promise<Receipt[]> {
    const list = await adminApi.receipts(year)
    receiptsByYear.value[year] = list
    return list
  }

  /** Issues the Cerfa receipt. 409 if not waived or already issued, 503 if not configured. */
  async function issueReceipt(coachId: number, year: number): Promise<Receipt> {
    const receipt = await adminApi.issueReceipt({ coachId, year })
    const row = coachesByYear.value[year]?.find((r) => r.coach.id === coachId)
    if (row?.waiver) row.waiver.receipt = receipt
    const list = receiptsByYear.value[year]
    if (list) list.push(receipt)
    return receipt
  }

  /** Downloads any coach's receipt PDF (the president may read them all). */
  async function downloadReceipt(receiptId: number): Promise<void> {
    const { blob, filename } = await waiversApi.receiptPdf(receiptId)
    saveBlob(blob, filename)
  }

  function reset(): void {
    coachesByYear.value = {}
    receiptsByYear.value = {}
    loading.value = false
  }

  return {
    coachesByYear,
    receiptsByYear,
    loading,
    coaches,
    receipts,
    issueReceipt,
    downloadReceipt,
    reset,
  }
})
