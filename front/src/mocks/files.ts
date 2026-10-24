// Placeholder downloads for the mock API: a minimal valid one-page PDF and a CSV in the
// API's French Excel format (UTF-8 BOM, `;` separator, comma decimals).

/** Standard PDF fonts only cover Latin-1 well: drop the accents and escape the string. */
function pdfText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/([\\()])/g, '\\$1')
}

/** A one-page A4 PDF showing `lines` in Helvetica. Valid (correct xref offsets). */
export function minimalPdf(lines: string[]): Uint8Array {
  const text = lines
    .map(
      (line, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 56 ${780 - i * 22} Td (${pdfText(line)}) Tj ET`,
    )
    .join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  // Pure ASCII, so string length = byte length and the offsets above are exact.
  return new TextEncoder().encode(out)
}

/** A number with a comma decimal separator (`12,5`). */
export function frNumber(n: number, digits = 2): string {
  return n.toFixed(digits).replace('.', ',')
}

function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** CSV rows joined with `;` and CRLF, prefixed with a UTF-8 BOM. */
export function csv(rows: string[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n'
}

export function attachment(filename: string): string {
  return `attachment; filename="${filename}"`
}
