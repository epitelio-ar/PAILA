// "Volumen parejo" (ReplayGain 2.0): cuánto subir o bajar cada tema (y cada disco entero) para que todo suene al mismo
// volumen en los reproductores que lo respetan. Se calcula con la medición de volumen (LUFS) que ya hizo el análisis y se
// guarda solo como dato en el tag: el audio no se toca. Rekordbox no lo usa (tiene su propio "Auto Gain").
import { visible, type Db } from './db'
import { albumGroups } from './albums'
import { cantWrite, readReplayGain, rgValue, type ReplayGain } from './tagio'
import { readRepaired } from './mp3fix'
import type { GainAlbum, GainPlan, GainTrack } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

// por qué un tema no lleva volumen parejo (se ve en Discos y tapas → Volumen parejo; lo que se escribe es solo el número)
const T = textos({
  otro: { es: 'Ya tiene volumen parejo de otro programa, y coincide con lo que mide PAILA', en: 'It already has even volume from another program, and it matches what PAILA measures' },
  sueltos: { es: 'Temas sueltos', en: 'Single tracks' },
  falta: { es: 'Falta analizarlo (o cambió desde el análisis)', en: 'It still needs to be analyzed (or it changed since the analysis)' },
  silencio: { es: 'Es silencio: no se puede medir', en: 'It is silence: it cannot be measured' },
  libreria: { es: 'La librería de tags no puede abrir este archivo: no se toca', en: 'The tag library cannot open this file: it is not touched' },
  mismo: { es: 'Ya tiene este mismo volumen parejo', en: 'It already has this same even volume' },
})

/** El volumen de referencia de ReplayGain 2.0, en LUFS (el mismo que usan foobar2000 y la mayoría de los programas). */
export const REFERENCE_LUFS = -18
const r2 = (v: number) => Math.round(v * 100) / 100
/**
 * Hasta cuánto puede diferir el volumen parejo que escribió otro programa del que mide PAILA para dejarlo como está
 * (decidido el 22/10/2026): menos de 1 dB no se nota; más, el reproductor sube o baja el tema de más.
 */
export const OTHER_TOLERANCE_DB = 1

/** Ganancia para llevar `lufs` a la referencia. */
export const gainFor = (lufs: number) => r2(REFERENCE_LUFS - lufs)
/** Pico en la escala de ReplayGain (1 = el máximo sin recortar), desde el pico en dBFS del análisis. */
export const peakFrom = (dbfs: number | null) => (dbfs == null || !Number.isFinite(dbfs) ? null : Math.round(10 ** (dbfs / 20) * 1e6) / 1e6)

/**
 * El volumen de un disco entero a partir del de cada tema: el promedio de su energía pesado por la duración, sin los temas
 * que quedan más de 10 LU por debajo (como hace el medidor EBU R128 con lo que es mucho más suave que el resto). Probado
 * contra medir el disco de corrido con ffmpeg: la diferencia es de décimas de dB (corrida supervisada del 20/10/2026; con
 * un tema muy suave entre temas fuertes, como "Princesa" en LPDA, sin esa regla daba 0,85 dB de diferencia).
 */
export function albumLoudness(tracks: { lufs: number; duration: number }[]): number | null {
  const mean = (ts: typeof tracks) => {
    const total = ts.reduce((a, t) => a + t.duration, 0)
    return ts.length && total > 0 ? 10 * Math.log10(ts.reduce((a, t) => a + t.duration * 10 ** (t.lufs / 10), 0) / total) : null
  }
  const all = mean(tracks)
  if (all == null) return null
  const kept = tracks.filter((t) => t.lufs >= all - 10)
  return mean(kept.length ? kept : tracks)
}

interface Row { id: number; rel: string; ext: string; codec: string | null; duration: number | null; lufs: number | null; tp: number | null; sp: number | null; fresh: number | null }

/**
 * El plan: ganancia de cada tema de la Música y, para los que están en un disco (core/albums.ts), la del disco (solo si
 * todos sus temas están analizados). `readCurrent` lee lo que cada archivo tiene escrito hoy (para no reescribir lo mismo):
 * lleva un rato con muchos temas, por eso va con avance.
 */
export async function gainPlan(db: Db, pathOf: (id: number) => string | null, opts: { readCurrent?: boolean; onProgress?: (p: { done: number; total: number; current: string }) => void; isCancelled?: () => boolean } = {}): Promise<GainPlan> {
  const rows = db.prepare(
    `SELECT f.id, f.rel_path AS rel, f.ext, f.codec, f.duration, a.lufs, a.true_peak AS tp, a.sample_peak AS sp,
            (a.src_size = f.size AND a.src_mtime = f.mtime) AS fresh
     FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND f.error IS NULL AND f.kind = 'musica' ORDER BY f.rel_path`,
  ).all() as unknown as Row[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ok = (r: Row | undefined) => !!r && r.lufs != null && Number.isFinite(r.lufs) && r.lufs > -70 && !!r.fresh
  const trackOf = new Map<number, GainAlbum>()
  const albums: GainAlbum[] = []
  for (const g of albumGroups(db, 2)) {
    const rs = g.tracks.map((t) => byId.get(t.id))
    const all = rs.every(ok)
    const loud = all ? albumLoudness(rs.map((r) => ({ lufs: r!.lufs!, duration: r!.duration ?? 0 }))) : null
    const peaks = rs.map((r) => peakFrom(r?.tp ?? r?.sp ?? null)).filter((p): p is number => p != null)
    const a: GainAlbum = { key: g.key, artist: g.artist, album: g.album, gain: loud == null ? null : gainFor(loud), peak: all && peaks.length ? Math.max(...peaks) : null, tracks: [] }
    for (const t of g.tracks) trackOf.set(t.id, a)
    albums.push(a)
  }
  const loose: GainAlbum = { key: null, artist: '', album: T.sueltos, gain: null, peak: null, tracks: [] }
  const plan: GainPlan = { albums: [], ready: 0, notAnalyzed: 0, same: 0, other: 0, wrong: 0, cantWrite: 0 }
  // los que tienen el de otro programa se deciden al final, por disco (ver `othersRight`)
  const others = new Map<GainAlbum | GainTrack, { t: GainTrack; cur: ReplayGain }[]>()
  let done = 0
  for (const r of rows) {
    if (opts.isCancelled?.()) break
    if (opts.readCurrent && done % 50 === 0) { opts.onProgress?.({ done, total: rows.length, current: r.rel }); await new Promise((res) => setImmediate(res)) }
    done++
    const alb = trackOf.get(r.id)
    const t: GainTrack = { id: r.id, rel: r.rel, lufs: r.lufs, gain: null, peak: null, albumGain: alb?.gain ?? null, current: null, why: null, wrong: null }
    ;(alb ?? loose).tracks.push(t)
    // un WMA, un WebM, o un .mp3 que por dentro es un WebM: de entrada, no al aplicar (core/tagio.ts, cantWrite)
    const no = cantWrite(r, () => pathOf(r.id))
    if (no) { t.why = no; plan.cantWrite++; continue }
    if (!ok(r)) { t.why = r.lufs == null || !r.fresh ? T.falta : T.silencio; plan.notAnalyzed++; continue }
    t.gain = gainFor(r.lufs!)
    t.peak = peakFrom(r.tp ?? r.sp)
    if (opts.readCurrent) {
      const p = pathOf(r.id)
      // un MP3 que la librería de tags no abre (ceros, un tag mal cerrado o restos antes del audio) se prueba sobre una copia
      // arreglada (core/mp3fix.ts): al aplicar, el motor hace el mismo arreglo. Si ni así se abre, no se toca
      try { t.current = p ? readReplayGain(p) : null } catch { try { t.current = readRepaired(p!, readReplayGain) } catch { t.why = T.libreria; t.gain = null; plan.cantWrite++; continue } }
    }
    if (t.current != null && t.current === valueFor(t, alb?.peak ?? null)) { t.why = T.mismo; plan.same++; continue }
    const cur = t.current != null ? JSON.parse(t.current) as ReplayGain : null
    if (cur?.tg != null) { const k = alb ?? t; others.set(k, [...(others.get(k) ?? []), { t, cur }]); continue }
    plan.ready++
  }
  // lo que puso otro programa (a veces con el ReplayGain viejo, que mide distinto): si coincide con lo que se escucha se
  // deja; si no, se corrige (el reproductor lo subiría o bajaría de más)
  for (const [k, ts] of others) {
    const alb = 'tracks' in k ? k : null
    if (othersRight(ts, alb ? alb.gain : null, alb ? alb.tracks.length : 1)) for (const { t } of ts) { t.why = T.otro; plan.other++ }
    else for (const { t, cur } of ts) { t.wrong = cur.tg; plan.wrong++; plan.ready++ }
  }
  plan.albums = [...albums.filter((a) => a.tracks.length), ...(loose.tracks.length ? [loose] : [])]
  opts.onProgress?.({ done, total: rows.length, current: '' })
  return plan
}

/**
 * El valor a escribir en un tema. Un tema suelto (sin disco) conserva la ganancia de disco que ya tenía escrita (de otro
 * programa): PAILA no la conoce y no la borra.
 */
export function valueFor(t: Pick<GainTrack, 'gain' | 'peak' | 'albumGain' | 'current'>, albumPeak: number | null): string | null {
  const cur = t.current ? JSON.parse(t.current) as ReplayGain : null
  return rgValue({ tg: t.gain, tp: t.peak, ag: t.albumGain ?? cur?.ag ?? null, ap: t.albumGain != null ? albumPeak : cur?.ap ?? null })
}

/**
 * ¿El volumen parejo que puso otro programa en los temas de un disco (o en un tema suelto) coincide con lo que mide PAILA?
 * Se decide por disco entero, para que no queden temas corregidos y otros no (en "por disco" sonarían desparejos):
 * - cada tema, a menos de 1 dB del que mide PAILA;
 * - el del disco, solo si el otro programa midió los mismos temas (todos los del disco lo tienen, y el mismo): si no, midió
 *   otra cosa (el disco entero que acá está incompleto, por ejemplo) y PAILA no tiene con qué compararlo.
 * `total`: cuántos temas tiene el disco en PAILA.
 */
export function othersRight(ts: { t: Pick<GainTrack, 'gain'>; cur: ReplayGain }[], albumGain: number | null, total: number): boolean {
  if (ts.some(({ t, cur }) => cur.tg != null && t.gain != null && Math.abs(cur.tg - t.gain) >= OTHER_TOLERANCE_DB)) return false
  const ags = new Set(ts.map(({ cur }) => cur.ag))
  const ag = ags.size === 1 ? [...ags][0] : null
  if (albumGain == null || ag == null || ts.length < total) return true
  return Math.abs(ag - albumGain) < OTHER_TOLERANCE_DB
}

/**
 * Los Cambios pendientes del plan: los temas listos, incluidos los que tenían el de otro programa mal puesto. El que
 * coincide con lo que mide PAILA no se toca. La marca "Sound Check" de iTunes (iTunNORM) tampoco: se escriben solo los
 * campos de ReplayGain.
 */
export function gainChanges(plan: GainPlan): { id: number; field: 'replaygain'; value: string | null }[] {
  const out: { id: number; field: 'replaygain'; value: string | null }[] = []
  for (const a of plan.albums) for (const t of a.tracks) if (t.gain != null && !t.why) out.push({ id: t.id, field: 'replaygain', value: valueFor(t, a.peak) })
  return out
}
