// La tabla de la biblioteca a una planilla (MASTERPLAN-3, 4: "Biblioteca a Excel"): las columnas que se ven, en su orden,
// en un .csv que Excel abre bien con doble clic (UTF-8 con su marca para los acentos y el separador de la configuración de
// Windows: ";" donde la coma es decimal, como en castellano). Puro: lo usa el proceso principal.
import type { Track } from './types'
import { generoPrincipal } from './generos'
import { display, folder, format, type SortKey } from './trackinfo'

/** Cómo escribe los números la compu: con coma decimal (y ";" entre columnas) o con punto (y ","). */
export interface CsvFormat { sep: ';' | ','; decimal: ',' | '.' }

/** El formato que espera Excel según el idioma de Windows ("es-AR" → ";" y coma decimal; "en-US" → "," y punto). */
export function csvFormatFor(locale: string): CsvFormat {
  let decimal = '.'
  try { decimal = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.' } catch { /* idioma raro */ }
  return decimal === ',' ? { sep: ';', decimal: ',' } : { sep: ',', decimal: '.' }
}

/** Duración como la entiende Excel (h:mm:ss): "4:05" lo tomaría como 4 horas. */
const hms = (s: number | null) => {
  if (!s) return ''
  const r = Math.round(s)
  return `${Math.floor(r / 3600)}:${String(Math.floor((r % 3600) / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`
}

type Cell = string | number | null
/** El valor de cada columna para la planilla: números como números (se pueden sumar y ordenar en Excel). */
const VALUE: Record<Exclude<SortKey, 'order'>, (t: Track, f: CsvFormat) => Cell> = {
  artist: (t) => display(t).artist,
  title: (t) => display(t).title,
  grade: (t) => t.grade ?? '',
  bpm: (t) => (t.bpm ? Math.round(t.bpm * 10) / 10 : null),
  camelot: (t) => t.camelot ?? '',
  energy: (t) => t.energy ?? null,
  album: (t) => t.album ?? '',
  year: (t) => t.year ?? null,
  genre: (t) => generoPrincipal(t.genre) ?? '', // uno solo, como en la lista (shared/generos.ts)
  format,
  kbps: (t) => t.kbps ?? null,
  sampleRate: (t, f) => (t.sampleRate ? `${String(t.sampleRate / 1000).replace('.', f.decimal)} kHz${t.bits ? ` / ${t.bits} bits` : ''}` : ''),
  duration: (t) => hms(t.duration),
  size: (t) => Math.round(t.size / 1e5) / 10,
  folder,
}
/** Las columnas que cambian de nombre en la planilla (para decir la unidad). */
const LABEL: Partial<Record<SortKey, string>> = { size: 'Tamaño (MB)' }

function cell(v: Cell, f: CsvFormat): string {
  if (v == null || v === '') return ''
  if (typeof v === 'number') return String(v).replace('.', f.decimal)
  let s = String(v).replace(/\r?\n/g, ' ')
  // que Excel no tome un título como fórmula ("=", "+", "@" o "-" pegado a una letra)
  if (/^(?:[=+@]|-[^\s\d])/.test(s)) s = `'${s}`
  // entre comillas si tiene comillas, el separador o espacios en los bordes ("44,1 kHz" con ";" queda como está)
  return s.includes(f.sep) || /["\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * La planilla: una fila de encabezado con el nombre de cada columna y una fila por tema, en el orden de la tabla. Empieza con
 * la marca de UTF-8 (sin ella, Excel muestra mal los acentos) y usa fin de línea de Windows.
 */
export function tableCsv(tracks: Track[], columns: { key: SortKey; label: string }[], f: CsvFormat): string {
  const cols = columns.filter((c) => c.key !== 'order')
  const lines = [cols.map((c) => cell(LABEL[c.key] ?? c.label, f)).join(f.sep)]
  for (const t of tracks) lines.push(cols.map((c) => cell(VALUE[c.key as Exclude<SortKey, 'order'>](t, f), f)).join(f.sep))
  return '﻿' + lines.join('\r\n') + '\r\n'
}
