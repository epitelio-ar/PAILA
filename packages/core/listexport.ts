// Listas para llevar a sockseek (el programa que baja de Soulseek; PAILA no baja nada, decisión del 20/10): lo que falta
// de la lista «Faltan o suenan mal» o de una lista traída, en los dos formatos que lee sockseek. Funciones puras, sin interfaz ni
// base: las usan PAILA y NAPIA.
// - .txt: un `s:"Artista - Tema"` por línea;
// - .csv: `Artist,Title,Album,Length`, con la duración en segundos.
// - para NAPIA (napiaCsv): el mismo .csv con la copia que ya tenés de lo que viene a reemplazarse.
import type { CopiaTuya } from '@paila/shared/napia'

export interface ExportTrack { artist: string; title: string; album?: string | null; duration?: number | null }

/** Las comillas de adentro rompen el `s:"…"`: pasan a comillas simples. */
const q = (s: string) => s.replace(/"/g, "'").replace(/\s+/g, ' ').trim()
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const unique = <T extends ExportTrack>(items: T[]) => {
  const seen = new Set<string>()
  return items.filter((i) => { const k = `${i.artist}|${i.title}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
}

export function sockseekTxt(items: ExportTrack[]): string {
  const lines = unique(items).filter((i) => i.title.trim()).map((i) => `s:"${q(i.artist ? `${i.artist} - ${i.title}` : i.title)}"`)
  return lines.join('\r\n') + (lines.length ? '\r\n' : '')
}

/** Sin ninguna duración, sin la columna Length: con la celda vacía sockseek avisa "Couldn't parse track length" (y 0 o -1 filtran mal). */
export function sockseekCsv(items: ExportTrack[]): string {
  const list = unique(items).filter((i) => i.title.trim())
  const length = list.some((i) => i.duration != null)
  const rows = list.map((i) => [i.artist, i.title, i.album ?? '', ...(length ? [i.duration != null ? String(Math.round(i.duration)) : ''] : [])])
  return [['Artist', 'Title', 'Album', ...(length ? ['Length'] : [])], ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

/**
 * Las columnas de más del CSV para NAPIA: la copia que ya tenés (nota, calidad real en kbps, qué es, sus marcas, recortes y volumen;
 * la duración es la de Length). sockseek no las ve.
 */
export const COPIA_COLS = { nota: 'Your Grade', kbps: 'Your Kbps', que: 'Your Quality', marcas: 'Your Flags', recortes: 'Your Clips', lufs: 'Your LUFS', id: 'Your PAILA Id' } as const
/** La columna de lo que es otra versión (en la lista traída dijiste "No es" a la copia parecida): NAPIA no lo saltea. */
export const OTRA_VERSION_COL = 'Other Version'

/**
 * El CSV para NAPIA ("Bajar con NAPIA" de la lista «Faltan o suenan mal»): el de sockseek más la copia que ya tenés de cada tema que
 * viene a reemplazarse, para que NAPIA se quede solo con una claramente mejor (core/sockseek/calidad.ts). NAPIA lo lee y le
 * arma a sockseek su propio CSV; las celdas vacías son temas que no tenés.
 */
const num = (v: number | null | undefined) => (v != null ? String(v) : '')

export function napiaCsv(items: (ExportTrack & { tuya?: CopiaTuya | null; otraVersion?: boolean })[]): string {
  const list = unique(items).filter((i) => i.title.trim())
  const otras = list.some((i) => i.otraVersion)
  if (!list.some((i) => i.tuya) && !otras) return sockseekCsv(list)
  const length = list.some((i) => i.duration != null)
  const rows = list.map((i) => [i.artist, i.title, i.album ?? '', ...(length ? [i.duration != null ? String(Math.round(i.duration)) : ''] : []),
    i.tuya?.nota ?? '', num(i.tuya?.kbps), i.tuya?.que ?? '', (i.tuya?.marcas ?? []).join(' '), num(i.tuya?.recortes), num(i.tuya?.lufs), num(i.tuya?.id), ...(otras ? [i.otraVersion ? 'yes' : ''] : [])])
  return [['Artist', 'Title', 'Album', ...(length ? ['Length'] : []), ...Object.values(COPIA_COLS), ...(otras ? [OTRA_VERSION_COL] : [])], ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
