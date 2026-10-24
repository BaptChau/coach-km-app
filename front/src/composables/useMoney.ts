// fr-FR money and distance formatting for templates: thin wrappers over `@/domain`.
import { formatEuros, formatKm } from '@/domain'

/** Integer cents → `1 234,56 €`. */
export function euros(cents: number): string {
  return formatEuros(cents)
}

/** Integer cents → `+20,67 €` (signed, for "this trip adds…" previews). */
export function signedEuros(cents: number): string {
  return `${cents < 0 ? '−' : '+'}${formatEuros(Math.abs(cents))}`
}

/** Kilometres → `1 234,5 km`. */
export function km(value: number): string {
  return formatKm(value)
}

export function useMoney() {
  return { euros, signedEuros, km }
}
