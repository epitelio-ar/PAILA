// El BPM y el tono escritos en el tag de cada tema (TBPM y TKEY del ID3 en MP3, AIFF y WAV; BPM e INITIALKEY en FLAC y OGG;
// tmpo e initialkey en M4A), leídos y escritos con la misma librería que los demás tags. Son los campos 'bpm' y 'key' de
// Cambios pendientes (el texto tal cual está escrito; null = no está) y lo que mira el paso de Arreglar nombres que borra los
// que seguro están mal (core/tidy-djtag.ts). Se guardan en `file_djtag` mientras el archivo no cambie (tamaño y fecha): leerlos
// de nuevo en cada pasada tardaba ~20 s cada 6.000 temas. La primera vez se leen todos; después, solo lo nuevo o cambiado.
import fs from 'node:fs'
import path from 'node:path'
import { File, Id3v2FrameIdentifiers, TagTypes, type Id3v2Tag, type Mpeg4AppleTag, type XiphComment } from 'node-taglib-sharp'
import { transaction, visible, type Db } from './db'
import { seratoJson, type SeratoTag } from './seratotag'

export type DjField = 'bpm' | 'key'
export const DJ_FIELDS: readonly DjField[] = ['bpm', 'key']
export interface DjTag { bpm: string | null; key: string | null }

/** El texto como está escrito (sin caracteres nulos); vacío = null. Igual que `exact` de core/tagio.ts (que importa este módulo). */
const exact = (v: string | null | undefined) => { const s = (v ?? '').replace(/\u0000/g, ''); return s === '' ? null : s }

/** Dónde guarda cada formato el BPM y el tono (null = un formato donde PAILA no los lee). */
function holder(file: string): 'id3' | 'xiph' | 'apple' | null {
  const ext = path.extname(file).slice(1).toLowerCase()
  if (['mp3', 'aif', 'aiff', 'wav'].includes(ext)) return 'id3'
  if (['flac', 'ogg', 'oga', 'opus'].includes(ext)) return 'xiph'
  if (['m4a', 'mp4', 'aac', 'alac'].includes(ext)) return 'apple'
  return null
}

const ID: Record<DjField, { id3: typeof Id3v2FrameIdentifiers.TBPM; xiph: string }> = {
  bpm: { id3: Id3v2FrameIdentifiers.TBPM, xiph: 'BPM' },
  key: { id3: Id3v2FrameIdentifiers.TKEY, xiph: 'INITIALKEY' },
}

/** Lo que tiene escrito un archivo abierto. En M4A el BPM es un número entero: 0 es lo mismo que no tenerlo. */
export function readDjTagOf(f: File): DjTag {
  const h = holder(f.name)
  if (h === 'xiph') {
    const x = f.getTag(TagTypes.Xiph, false) as XiphComment | undefined
    return { bpm: exact(x?.getFieldFirstValue(ID.bpm.xiph)), key: exact(x?.getFieldFirstValue(ID.key.xiph)) }
  }
  if (h === 'apple') {
    const a = f.getTag(TagTypes.Apple, false) as Mpeg4AppleTag | undefined
    const n = a?.beatsPerMinute ?? 0
    return { bpm: n > 0 ? String(n) : null, key: exact(a?.initialKey) }
  }
  if (h === 'id3') {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | undefined
    return { bpm: exact(id3?.getTextAsString(ID.bpm.id3)), key: exact(id3?.getTextAsString(ID.key.id3)) }
  }
  return { bpm: null, key: null }
}

export function readDjTag(file: string): DjTag {
  const f = File.createFromPath(file)
  try { return readDjTagOf(f) } finally { f.dispose() }
}

/** Deja escrito exactamente `v` (null = se saca). Lo guarda quien llama (`f.save()`, en core/tagio.ts). */
export function writeDjTag(f: File, field: DjField, v: string | null) {
  const h = holder(f.name)
  if (h === 'xiph') {
    const x = f.getTag(TagTypes.Xiph, v != null) as XiphComment | undefined
    if (v != null) x!.setFieldAsStrings(ID[field].xiph, v)
    else x?.removeField(ID[field].xiph)
  } else if (h === 'apple') {
    const a = f.getTag(TagTypes.Apple, v != null) as Mpeg4AppleTag | undefined
    if (!a) return
    if (field === 'key') { if (v != null) a.initialKey = v; else a.setItunesStrings('com.apple.iTunes', 'initialkey') }
    else {
      const n = v == null ? 0 : Number(v)
      if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`BPM ${v}`) // en M4A va un entero (nunca pasa: se escribe lo que se leyó)
      a.beatsPerMinute = n
    }
  } else if (h === 'id3') {
    const id3 = f.getTag(TagTypes.Id3v2, v != null) as Id3v2Tag | undefined
    if (v != null) id3!.setTextFrame(ID[field].id3, v)
    else id3?.removeFrames(ID[field].id3)
  } else if (v != null) throw new Error(path.extname(f.name))
}

/**
 * Las marcas de Serato (campo 'serato', core/seratotag.ts) llevan adentro el BPM y el tono del tag. Si en la misma tanda también
 * se cambia el BPM o el tono, vale eso en las dos (si no, una de las dos verificaciones fallaba y el archivo no se tocaba).
 */
export function djOverSerato<T extends Partial<Record<string, string | null>>>(tags: T): T {
  if (!tags.serato || !DJ_FIELDS.some((k) => k in tags)) return tags
  const t = JSON.parse(tags.serato) as SeratoTag
  for (const k of DJ_FIELDS) if (k in tags) { const v = exact(tags[k])?.trim(); if (v) t[k] = v; else delete t[k] }
  return { ...tags, serato: seratoJson(t) }
}

// ---- lo ya leído (`file_djtag`) ----

/** Los temas de la Música que no tienen el BPM y el tono leídos (o cambiaron desde que se leyeron) y que están en el disco. */
function todo(db: Db, pathOf: (id: number) => string | null) {
  const rows = db.prepare(
    `SELECT f.id, f.size, f.mtime FROM files f LEFT JOIN file_djtag d ON d.file_id = f.id
     WHERE ${visible('f')} AND f.error IS NULL AND f.kind = 'musica' AND (d.file_id IS NULL OR d.size != f.size OR d.mtime != f.mtime)`,
  ).all() as { id: number; size: number; mtime: number }[]
  return rows.flatMap((r) => { const p = pathOf(r.id); return p && fs.existsSync(p) ? [{ ...r, path: p }] : [] })
}

export function pendingDjTags(db: Db, pathOf: (id: number) => string | null): number { return todo(db, pathOf).length }

/**
 * Lee lo que falta, de a tandas cortas para no trabar el resto de la app (cada lectura es ~3 ms). Un archivo que la librería
 * no puede abrir queda anotado sin BPM ni tono (se vuelve a probar si cambia); uno que se fue en el medio, para la próxima.
 */
export async function refreshDjTags(db: Db, pathOf: (id: number) => string | null, onProgress?: (done: number, total: number) => void, isCancelled: () => boolean = () => false): Promise<{ read: number; found: number }> {
  const list = todo(db, pathOf)
  const save = db.prepare(`INSERT INTO file_djtag (file_id, size, mtime, bpm, music_key) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (file_id) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, bpm = excluded.bpm, music_key = excluded.music_key`)
  let read = 0, found = 0
  for (let i = 0; i < list.length && !isCancelled(); i += 40) {
    const rows: [number, number, number, string | null, string | null][] = []
    for (const t of list.slice(i, i + 40)) {
      if (!fs.existsSync(t.path)) continue
      let d: DjTag = { bpm: null, key: null }
      try { d = readDjTag(t.path) } catch { /* no se puede abrir: sin BPM ni tono */ }
      rows.push([t.id, t.size, t.mtime, d.bpm, d.key])
      if (d.bpm != null || d.key != null) found++
    }
    transaction(db, () => { for (const r of rows) save.run(...r) })
    read += rows.length
    onProgress?.(Math.min(i + 40, list.length), list.length)
    await new Promise((r) => setImmediate(r))
  }
  return { read, found }
}

/**
 * Después de que PAILA escribe tags en un archivo (core/changes.ts): lo leído sigue valiendo con el tamaño y la fecha nuevos (y
 * con el BPM o el tono nuevos, si se escribieron). Va antes de anotar en `files` el tamaño y la fecha nuevos: solo sigue la
 * fila que estaba al día con los de antes.
 */
export function followDjTag(db: Db, fileId: number, st: { size: number; mtimeMs: number }, tags: Partial<Record<string, string | null>>) {
  const set = DJ_FIELDS.filter((k) => k in tags)
  db.prepare(`UPDATE file_djtag SET size = ?, mtime = ?${set.map((k) => `, ${k === 'key' ? 'music_key' : 'bpm'} = ?`).join('')}
    WHERE file_id = ? AND EXISTS (SELECT 1 FROM files f WHERE f.id = file_djtag.file_id AND f.size = file_djtag.size AND f.mtime = file_djtag.mtime)`)
    .run(st.size, st.mtimeMs, ...set.map((k) => exact(tags[k])), fileId)
}
