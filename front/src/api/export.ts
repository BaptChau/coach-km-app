// File downloads (récapitulatif PDF/CSV, tax receipts). Requests use `responseType: 'blob'`;
// the filename comes from `Content-Disposition`, with a fallback.
import type { ExportFormat } from '@/types'

import { http } from './client'

export interface Download {
  blob: Blob
  filename: string
}

/**
 * Extracts the filename from a `Content-Disposition` header (`filename*=UTF-8''…` wins
 * over `filename="…"`), or returns `fallback`.
 */
export function filenameFromDisposition(
  header: string | null | undefined,
  fallback: string,
): string {
  if (!header) return fallback
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/i.exec(header)
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''))
    } catch {
      // fall through to the plain filename
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header)
  const name = (plain?.[2] ?? plain?.[1])?.trim()
  return name || fallback
}

/** GETs a file as a Blob. Internal helper shared with `waivers.receiptPdf`. */
export async function downloadFile(
  url: string,
  fallbackName: string,
  params?: Record<string, unknown>,
): Promise<Download> {
  const res = await http.get<Blob>(url, { params, responseType: 'blob' })
  const header = res.headers['content-disposition'] as string | undefined
  return { blob: res.data, filename: filenameFromDisposition(header, fallbackName) }
}

/** `GET /export?year=&format=pdf|csv`: the yearly récapitulatif. */
export function download(year: number, format: ExportFormat): Promise<Download> {
  return downloadFile('/export', `recapitulatif-km-${year}.${format}`, { year, format })
}

/** Hands a Blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke later: some browsers (iOS Safari) read the URL asynchronously after click().
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
