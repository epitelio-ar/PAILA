// Formatos para mostrar en pantalla: números, tamaños, duraciones, formato del archivo y artista/título de un tema.
import type { Track } from '@paila/shared/types'
import { num } from '@paila/shared/idioma'

export const n = (x: number) => num(x)

export function bytes(b: number): string {
  if (b >= 1e9) return `${num(b / 1e9, { maximumFractionDigits: 1 })} GB`
  if (b >= 1e6) return `${num(b / 1e6, { maximumFractionDigits: 1 })} MB`
  return `${Math.max(1, Math.round(b / 1e3))} KB`
}

export function duration(s: number | null): string {
  if (!s) return ''
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60)
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`
}

export function sampleRate(t: Track): string {
  if (!t.sampleRate) return ''
  const khz = num(t.sampleRate / 1000, { maximumFractionDigits: 1 })
  return t.bits ? `${khz} kHz / ${t.bits} bits` : `${khz} kHz`
}

// Lo que se muestra de cada tema (artista y título, formato, carpeta) vive en shared/trackinfo.ts: también lo usa el
// proceso principal para ordenar y buscar en bibliotecas grandes.
export { display, fileName, folder, format } from '@paila/shared/trackinfo'
