// Banco de pruebas de BPM y tono (MASTERPLAN-2, 6.2): compara lo que calcula PAILA con una referencia (Rekordbox, los tags
// de Beatport o Mixed In Key) y da el número que cada cambio del motor tiene que mejorar. Solo lee; no toca archivos.

/** Tono en la rueda Camelot: número 1–12 y letra (A = menor, B = mayor). */
export interface Camelot { n: number; minor: boolean }

const MINOR: Record<string, number> = { 'G#': 1, Ab: 1, 'D#': 2, Eb: 2, 'A#': 3, Bb: 3, F: 4, C: 5, G: 6, D: 7, A: 8, E: 9, B: 10, 'F#': 11, Gb: 11, 'C#': 12, Db: 12 }
const MAJOR: Record<string, number> = { B: 1, Cb: 1, 'F#': 2, Gb: 2, Db: 3, 'C#': 3, Ab: 4, 'G#': 4, Eb: 5, 'D#': 5, Bb: 6, 'A#': 6, F: 7, C: 8, G: 9, D: 10, A: 11, E: 12 }

/**
 * Lee un tono escrito de cualquier manera: "Am", "A m", "Amin", "A minor", "Abm", "G#m", "A#maj", "C", "8A", "08A",
 * "10m" / "1d" (Open Key, el de Traktor), "8A - Energy 6" (Mixed In Key). Devuelve null si no se entiende.
 */
export function parseKey(raw: string | null | undefined): Camelot | null {
  if (!raw) return null
  const s = raw.trim().replace(/♯/g, '#').replace(/♭/g, 'b')
  const cam = s.match(/^0?(1[0-2]|[1-9])\s*([AB])\b/i)
  if (cam) return { n: Number(cam[1]), minor: cam[2].toUpperCase() === 'A' }
  const open = s.match(/^0?(1[0-2]|[1-9])\s*([dm])\b/i)
  // Open Key: 1d = Do mayor (8B), 1m = La menor (8A); cada número suma una quinta, igual que Camelot
  if (open) return { n: ((Number(open[1]) + 6) % 12) + 1, minor: open[2].toLowerCase() === 'm' }
  const m = s.match(/^([A-Ga-g])\s*(#|b|sharp|flat)?\s*(m(?:in(?:or)?)?|maj(?:or)?|dur|moll)?\s*$/i)
  if (!m) return null
  const root = m[1].toUpperCase() + (m[2] ? (/^(#|sharp)$/i.test(m[2]) ? '#' : 'b') : '')
  const minor = !!m[3] && /^(m|min|minor|moll)$/i.test(m[3])
  const n = (minor ? MINOR : MAJOR)[root]
  return n ? { n, minor } : null
}

export const camelotText = (c: Camelot) => `${c.n}${c.minor ? 'A' : 'B'}`

export type KeyMatch = 'exacto' | 'vecino' | 'relativo' | 'otro'

/**
 * Cómo se parecen dos tonos para mezclar: exacto; vecino en la rueda (±1, misma letra: una quinta de diferencia);
 * relativo (mismo número, otra letra: La menor ↔ Do mayor, mismas notas); otro (choca).
 */
export function keyMatch(a: Camelot, b: Camelot): KeyMatch {
  if (a.n === b.n && a.minor === b.minor) return 'exacto'
  if (a.n === b.n) return 'relativo'
  const d = Math.abs(a.n - b.n)
  if (a.minor === b.minor && (d === 1 || d === 11)) return 'vecino'
  return 'otro'
}

export type BpmMatch = 'igual' | 'doble' | 'mitad' | 'tres-medios' | 'otro'

/** Compara un BPM con la referencia: igual (±1), el doble o la mitad (±1 en la escala de la referencia), 3/2 o 2/3, u otro. */
export function bpmMatch(ours: number, ref: number, tol = 1): BpmMatch {
  if (Math.abs(ours - ref) <= tol) return 'igual'
  if (Math.abs(ours / 2 - ref) <= tol) return 'doble'
  if (Math.abs(ours * 2 - ref) <= tol) return 'mitad'
  if (Math.abs(ours * 2 / 3 - ref) <= tol || Math.abs(ours * 3 / 2 - ref) <= tol) return 'tres-medios'
  return 'otro'
}

export interface BenchItem { bpm: number | null; refBpm: number | null; key: string | null; refKey: string | null }

export interface BenchScore {
  bpm: { total: number; igual: number; doble: number; mitad: number; tresMedios: number; otro: number }
  key: { total: number; exacto: number; vecino: number; relativo: number; otro: number }
}

/** Cuenta coincidencias. Solo entran los temas que tienen el dato de los dos lados. */
export function score(items: BenchItem[]): BenchScore {
  const s: BenchScore = { bpm: { total: 0, igual: 0, doble: 0, mitad: 0, tresMedios: 0, otro: 0 }, key: { total: 0, exacto: 0, vecino: 0, relativo: 0, otro: 0 } }
  for (const it of items) {
    if (it.bpm && it.refBpm) {
      const m = bpmMatch(it.bpm, it.refBpm)
      s.bpm.total++
      if (m === 'tres-medios') s.bpm.tresMedios++
      else s.bpm[m]++
    }
    const a = parseKey(it.key), b = parseKey(it.refKey)
    if (a && b) { s.key.total++; s.key[keyMatch(a, b)]++ }
  }
  return s
}

const pct = (n: number, t: number) => (t ? `${((100 * n) / t).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %` : '—')

/** El resumen en castellano, para la bitácora. */
export function scoreText(s: BenchScore): string[] {
  const b = s.bpm, k = s.key
  return [
    `BPM (${b.total} temas): igual ±1 ${pct(b.igual, b.total)} · doble ${pct(b.doble, b.total)} · mitad ${pct(b.mitad, b.total)} · 3/2 ${pct(b.tresMedios, b.total)} · otro ${pct(b.otro, b.total)}`,
    `Tono (${k.total} temas): exacto ${pct(k.exacto, k.total)} · vecino ${pct(k.vecino, k.total)} · relativo ${pct(k.relativo, k.total)} · otro ${pct(k.otro, k.total)}`,
  ]
}

export interface RekordboxTrack { path: string; bpm: number | null; key: string | null; name: string; artist: string; seconds: number | null }

const xmlText = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/**
 * Los temas de un `rekordbox.xml` (Archivo → Exportar colección en formato xml): ruta, BPM promedio y tono.
 * La ruta viene como "file://localhost/D:/M%C3%BAsica/…": se devuelve como ruta normal ("D:/Música/…").
 */
export function parseRekordboxXml(xml: string): RekordboxTrack[] {
  const out: RekordboxTrack[] = []
  const coll = xml.slice(xml.indexOf('<COLLECTION'), xml.indexOf('</COLLECTION>') + 1 || undefined)
  for (const m of coll.matchAll(/<TRACK\s([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {}
    for (const a of m[1].matchAll(/(\w+)="([^"]*)"/g)) attrs[a[1]] = xmlText(a[2])
    if (!attrs.Location) continue
    let p = attrs.Location.replace(/^file:\/\/localhost\//i, '').replace(/^file:\/\/\//i, '')
    try { p = decodeURIComponent(p) } catch { /* queda como vino */ }
    const bpm = Number(attrs.AverageBpm)
    const secs = Number(attrs.TotalTime)
    out.push({ path: p, bpm: bpm > 0 ? bpm : null, key: attrs.Tonality || null, name: attrs.Name || '', artist: attrs.Artist || '', seconds: secs > 0 ? secs : null })
  }
  return out
}
