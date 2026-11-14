// Recortar los silencios largos del principio y del final (masterplan 4, 4A.3). PAILA ya los avisa (core/analysis/silence.ts);
// acá se arma la propuesta: se lee cada tema entero y se corta solo lo que no se oye (debajo de −80 dB), dejando un respiro.
// Va por Cambios pendientes (campo 'trim'): se escucha antes y después, se aplica con verificación (core/trimfile.ts) y el
// original queda en la papelera de PAILA (con el Reemplazo: se deshace desde el Historial). Nunca en sample packs.
import fs from 'node:fs'
import path from 'node:path'
import { visible, type Db } from './db'
import { BLOCK_SECONDS, LONG_END_S, LONG_START_S, audibleBounds, readLevels, soundBounds } from './analysis/silence'
import { readSeratoTag } from './seratotag'
import { TRIM_FORMATS, trimToFile } from './trimfile'
import { cutMp3 } from './trimmp3'
import type { Replacer } from './replace'
import type { TrimPlan, TrimProposal } from '@paila/shared/types'
import { T } from './trim.textos'
import { num } from '@paila/shared/idioma'

/** Lo que se deja antes del primer sonido y después del último (un respiro: que no arranque ni corte en seco). */
export const KEEP_BEFORE = 0.3
export const KEEP_AFTER = 1
/** Prefijo de las tandas de recortes en la tabla de reemplazos (así el Historial las muestra como recortes). */
export const TRIM_BATCH = 'recorte-'

/** ¿Tiene marcas de otro programa de DJ (cues o grilla de Rekordbox o Serato)? Si se corta el principio, se correrían. */
function djMarks(db: Db, fileId: number, file: string | null): boolean {
  const q = (sql: string) => !!db.prepare(sql).get(fileId)
  return q('SELECT 1 FROM rb_ids WHERE file_id = ?') || q("SELECT 1 FROM dj_cues WHERE file_id = ? AND source != 'paila'")
    || q("SELECT 1 FROM dj_grid WHERE file_id = ? AND method IN ('rekordbox', 'serato')") || (!!file && (() => { try { return !!readSeratoTag(file) } catch { return false } })())
}

/**
 * La propuesta de recortes: los temas con el aviso de silencio largo (Música y Para revisar, en MP3, FLAC o WAV), leídos
 * enteros. Solo lee: no toca ningún archivo.
 */
export async function planTrims(
  db: Db, pathOf: (id: number) => string | null, ffmpeg: string,
  opts: { ids?: number[]; onProgress?: (done: number, total: number, rel: string) => void; isCancelled?: () => boolean } = {},
): Promise<TrimPlan> {
  const rows = db.prepare(
    `SELECT f.id, f.rel_path AS rel, f.ext, f.codec, f.size, f.mtime, f.kind FROM files f JOIN silence s ON s.file_id = f.id
     WHERE ${visible('f')} AND f.error IS NULL AND (s.silence_start >= ? OR s.silence_end >= ?) ORDER BY f.rel_path`,
  ).all(LONG_START_S, LONG_END_S) as { id: number; rel: string; ext: string; codec: string | null; size: number; mtime: number; kind: string }[]
  const want = opts.ids && new Set(opts.ids)
  const plan: TrimPlan = { items: [], skipped: [] }
  const todo = rows.filter((r) => !want || want.has(r.id))
  for (let k = 0; k < todo.length; k++) {
    if (opts.isCancelled?.()) break
    const r = todo[k]
    opts.onProgress?.(k, todo.length, r.rel)
    const skip = (why: string) => plan.skipped.push({ fileId: r.id, rel: r.rel, why })
    if (r.kind === 'produccion') { skip(T.samplePacks); continue }
    if (r.kind !== 'musica' && r.kind !== 'revisar') { skip(T.soloMusica); continue }
    if (!TRIM_FORMATS.includes(r.ext)) { skip(T.formato(r.ext)); continue }
    // la extensión miente (un "MP3" de YouTube que adentro es Opus, corrida del 23/10): no se corta
    if (r.codec && !(r.ext === 'mp3' ? r.codec === 'mp3' : r.ext === 'flac' ? r.codec === 'flac' : r.codec.startsWith('pcm_'))) { skip(T.otroFormato(r.ext, r.codec)); continue }
    const file = pathOf(r.id)
    if (!file || !fs.existsSync(file)) { skip(T.sinDisco); continue }
    let levels: number[]
    try { levels = await readLevels({ ffmpeg, file, duration: null }, Infinity, false) } catch (e) { skip(T.noSeLeyo((e as Error).message)); continue }
    const p = proposal(levels)
    if (!p) { skip(T.todoSilencio); continue }
    let note: string | null = p.click ? T.golpe(p.click) : null
    if (p.cutStart && djMarks(db, r.id, file)) { p.cutStart = false; p.from = 0; note = T.soloFinal }
    if (!p.cutStart && !p.cutEnd) { skip(note ?? T.corto); continue }
    // un MP3 que no se puede cortar sin recodificar (cabecera rara, partes rotas) se avisa ahora y no al aplicar
    if (r.ext === 'mp3') { try { cutMp3(new Uint8Array(fs.readFileSync(file)), p.from, p.cutEnd ? p.to : Infinity) } catch (e) { skip((e as Error).message); continue } }
    const { click: _, ...cut } = p
    plan.items.push({ fileId: r.id, rel: r.rel, ext: r.ext, size: r.size, mtime: r.mtime, ...cut, note })
  }
  opts.onProgress?.(todo.length, todo.length, '')
  return plan
}

/**
 * Dónde cortar según el nivel de cada bloque de 50 ms del tema entero (null si todo es silencio). Puro. Lo que se oye (arriba
 * de −60 dB) cuenta como sonido aunque dure un instante: un golpe suelto en el silencio no se corta (corrida del 23/10: el final
 * de "Tatuaje" tiene 0,1 s del tema siguiente después de 5 s de silencio). `click`: de qué lado había uno que lo impidió.
 */
export function proposal(levels: number[]): (Omit<TrimProposal, 'fileId' | 'rel' | 'ext' | 'size' | 'mtime' | 'note'> & { click: 'start' | 'end' | 'both' | null }) | null {
  const b = soundBounds(levels)
  if (!b) return null
  const loud = audibleBounds(levels)
  const firstBlock = loud ? Math.min(b.first, loud.first) : b.first, lastBlock = loud ? Math.max(b.last, loud.last) : b.last
  const round = (s: number) => Math.round(s * 100) / 100
  const duration = round(levels.length * BLOCK_SECONDS), first = round(firstBlock * BLOCK_SECONDS), last = round((lastBlock + 1) * BLOCK_SECONDS)
  const silenceStart = first, silenceEnd = round(duration - last)
  const cutStart = silenceStart >= LONG_START_S, cutEnd = silenceEnd >= LONG_END_S
  // sin el golpe suelto, ¿se hubiera cortado ese lado?
  const clickStart = b.first * BLOCK_SECONDS >= LONG_START_S && !cutStart, clickEnd = duration - (b.last + 1) * BLOCK_SECONDS >= LONG_END_S && !cutEnd
  const click = clickStart && clickEnd ? 'both' : clickStart ? 'start' : clickEnd ? 'end' : null
  return {
    duration, silenceStart, silenceEnd, cutStart, cutEnd, click,
    from: cutStart ? round(first - KEEP_BEFORE) : 0, to: cutEnd ? round(last + KEEP_AFTER) : duration,
  }
}

/** Lo que va en Cambios pendientes (campo 'trim'): la propuesta, para aplicarla tal cual se escuchó. */
export const trimValue = (p: TrimProposal) => JSON.stringify({ from: p.from, to: p.to, cutStart: p.cutStart, cutEnd: p.cutEnd, duration: p.duration, size: p.size, mtime: p.mtime })
export type TrimValue = Pick<TrimProposal, 'from' | 'to' | 'cutStart' | 'cutEnd' | 'duration' | 'size' | 'mtime'>

const secs = (s: number) => `${num(Math.round(s * 10) / 10)} s`
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
/** El antes y el después en palabras, para la tabla de Cambios pendientes. */
export function trimText(v: string | null): { before: string; after: string } | null {
  if (!v) return null
  const t = JSON.parse(v) as TrimValue
  return { before: T.dura(mmss(t.duration)), after: T.queda(mmss(t.to - t.from), t.cutStart ? secs(t.from) : null, t.cutEnd ? secs(t.duration - t.to) : null) }
}

/**
 * Aplica un recorte: arma el archivo recortado y verificado en `workDir` y reemplaza el tema con él (el original va a la
 * papelera de PAILA y se puede volver desde el Historial). Si el archivo cambió desde la vista previa, no se toca.
 */
export async function applyTrim(db: Db, replacer: Replacer, pathOf: (id: number) => string | null, ffmpeg: string, workDir: string, fileId: number, value: string, batch: string): Promise<void> {
  const t = JSON.parse(value) as TrimValue
  const f = db.prepare('SELECT rel_path AS rel, ext, size, mtime, kind FROM files WHERE id = ?').get(fileId) as { rel: string; ext: string; size: number; mtime: number; kind: string } | undefined
  if (!f) throw new Error(T.noEnBiblioteca)
  if (f.kind === 'produccion') throw new Error(T.samplePacks)
  const src = pathOf(fileId)
  if (!src || !fs.existsSync(src)) throw new Error(T.sinDisco)
  const st = fs.statSync(src)
  if (st.size !== t.size || Math.abs(st.mtimeMs - t.mtime) > 1000) throw new Error(T.cambio)
  // las marcas se miraban solo al proponer: si se trajeron después, cortar el principio las corría (choques del 27/10, C8)
  if (t.cutStart && djMarks(db, fileId, src)) throw new Error(T.marcasNuevas)
  fs.mkdirSync(workDir, { recursive: true })
  const out = `${workDir}/recorte-${fileId}${path.extname(f.rel)}`
  try {
    await trimToFile(ffmpeg, src, f.ext, t.from, t.cutEnd ? t.to : Infinity, out) // sin cortar el final: hasta donde termine
    // la grilla la acomoda este mismo recorte (abajo); el volumen parejo sigue valiendo (el silencio no cuenta en la medida); las marcas
    // de Serato, solo si no se cortó el principio
    await replacer.replace(fileId, out, { keepTags: false, keepCover: false, sameName: true, batch, keepDj: true, stillValid: t.cutStart ? ['replaygain'] : ['replaygain', 'serato'] })
    // la grilla y los cues que calculó PAILA quedarían corridos: se vuelven a calcular
    if (t.cutStart) {
      db.prepare("DELETE FROM dj_grid WHERE file_id = ? AND method NOT IN ('rekordbox', 'serato')").run(fileId)
      db.prepare("DELETE FROM dj_cues WHERE file_id = ? AND source = 'paila'").run(fileId)
    }
  } finally { fs.rmSync(out, { force: true }) }
}
