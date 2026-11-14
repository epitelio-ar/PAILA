// ZIP y RAR con la misma cara: qué hay adentro (`listArchive`, solo los índices: no descomprime nada) y sacar algunos
// archivos a donde se pida (`extractEntries`). Los ZIP comunes los saca el lector propio (archive/zipread.ts); los RAR y los
// ZIP raros, libarchive (archive/libarchive.ts), en un hilo aparte si la app lo da (`workerRunner`).
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { extractZipEntry, listZip, zipCanRead, zipDataRange, type ZipEntry } from './zipread'
import { isLaterVolume, listRar, rarMini, readRarHead, type Piece, type RarListing } from './rarread'
import { libExtract, type LibJob } from './libarchive'
import { T } from './textos'
import { idioma } from '@paila/shared/idioma'

export type ArchiveFormat = 'zip' | 'rar'

/** Lo que hay adentro, en el orden del comprimido. `index`: su lugar en la lista (con carpetas incluidas). */
export interface InnerEntry {
  index: number; name: string; size: number; packed: number; dir: boolean; encrypted: boolean; mtime: number | null
  /** null = se puede abrir; si no, por qué no. */
  blocked: string | null
}
export interface Listing {
  format: ArchiveFormat
  volumes: string[]
  solid: boolean
  /** Con clave hasta para ver qué tiene. */
  locked: boolean
  /** La parte que falta (de un rar partido), o null. */
  missing: string | null
  entries: InnerEntry[]
  zip?: ZipEntry[]
  rar?: RarListing
}

/** ¿Es un comprimido que PAILA mira? (Las partes 2, 3… de un rar partido van con la primera.) */
export function archiveFormat(name: string): ArchiveFormat | null {
  if (/\.zip$/i.test(name)) return 'zip'
  if (/\.rar$/i.test(name) && !isLaterVolume(name)) return 'rar'
  return null
}

export function listArchive(file: string): Listing {
  const format = archiveFormat(file)
  if (format === 'zip') {
    const zip = listZip(file)
    return {
      format, volumes: [file], solid: false, locked: false, missing: null, zip,
      entries: zip.map((e, index) => ({ index, name: e.name.replace(/\/$/, ''), size: e.size, packed: e.packed, dir: e.dir, encrypted: e.encrypted, mtime: e.mtime,
        blocked: e.encrypted ? T.clave : null })),
    }
  }
  if (format !== 'rar') throw new Error(T.noEsZipNiRar)
  const rar = listRar(file)
  const missing = rar.missing
  // si falta una parte, el último archivo sigue en ella: ese no se puede abrir
  const lastFile = rar.entries.map((e) => !e.dir).lastIndexOf(true)
  return {
    format, volumes: rar.volumes, solid: rar.solid, locked: rar.locked, missing, rar,
    entries: rar.entries.map((e, index) => {
      const blocked = e.encrypted ? T.clave
        : missing && index === lastFile ? T.faltaParte(missing)
          : e.solid && rar.volumes.length > 1 ? T.solidoPartido : null
      return { index, name: e.name, size: e.size, packed: e.packed, dir: e.dir, encrypted: e.encrypted, mtime: e.mtime, blocked }
    }),
  }
}

/** Corre un pedido de libarchive. En la app, en un hilo aparte (que se cierra al terminar); en los tests, acá mismo. */
export type LibRunner = (job: LibJob, signal?: AbortSignal) => Promise<{ index: number; error: string | null }[]>
export const inlineRunner: LibRunner = (job) => libExtract(job)
export const workerRunner = (script: string): LibRunner => (job, signal) => new Promise((resolve, reject) => {
  const w = new Worker(script)
  const stop = () => { void w.terminate(); reject(Object.assign(new Error(T.cancelado), { name: 'AbortError' })) }
  signal?.addEventListener('abort', stop, { once: true })
  const end = () => signal?.removeEventListener('abort', stop)
  w.once('message', (m: { ok: boolean; result?: { index: number; error: string | null }[]; error?: string }) => {
    end(); void w.terminate()
    if (m.ok) resolve(m.result!); else reject(new Error(m.error))
  })
  w.once('error', (e) => { end(); reject(e) })
  w.once('exit', (code) => { end(); reject(new Error(T.lectorCerrado(code))) })
  // el hilo nuevo no sabe el idioma de la app: va con el pedido (sus errores se muestran)
  w.postMessage({ ...job, idioma: idioma() })
})

/** Su lugar entre los archivos (sin contar carpetas): así lo encuentra libarchive aunque no entienda el nombre. */
const fileIndex = (l: Listing, index: number) => l.entries.slice(0, index).filter((e) => !e.dir).length

/**
 * Saca los archivos pedidos (`index` de `listArchive`) a sus destinos, creando las carpetas. Devuelve el error de cada uno
 * (null = salió bien). Lo que falla no deja nada a medias. En un rar "sólido", una sola pasada para todos.
 */
export async function extractEntries(l: Listing, wanted: { index: number; dest: string }[], opts: { runner?: LibRunner; signal?: AbortSignal } = {}): Promise<{ index: number; error: string | null }[]> {
  const runner = opts.runner ?? inlineRunner
  const out = new Map<number, string | null>()
  const lib: { index: number; dest: string; pieces: Piece[] }[] = []
  const solid: { index: number; dest: string }[] = []
  for (const w of wanted) {
    const e = l.entries[w.index]
    if (!e || e.dir) { out.set(w.index, T.noAdentro); continue }
    if (e.blocked) { out.set(w.index, e.blocked); continue }
    fs.mkdirSync(path.dirname(w.dest), { recursive: true })
    if (l.zip) {
      const z = l.zip[w.index]
      if (zipCanRead(z)) {
        try { await extractZipEntry(l.volumes[0], z, w.dest, opts.signal); out.set(w.index, null) } catch (err) {
          if ((err as Error).name === 'AbortError') throw err
          out.set(w.index, (err as Error).message)
        }
      } else { // método raro: libarchive con el encabezado local y los datos
        const { end } = zipDataRange(l.volumes[0], z)
        lib.push({ index: w.index, dest: w.dest, pieces: [{ vol: 0, start: z.offset, len: end - z.offset }] })
      }
      continue
    }
    const r = l.rar!.entries[w.index]
    if (r.solid) { solid.push(w); continue }
    const pieces = rarMini(l.rar!, r, (p) => readRarHead(l.rar!, p))
    if (!pieces) { out.set(w.index, T.noDesdeAdentro); continue }
    lib.push({ index: w.index, dest: w.dest, pieces })
  }
  // de a uno lo que va con su propio "mini rar"; lo sólido, todo junto en una pasada
  for (const j of lib) {
    if (opts.signal?.aborted) throw Object.assign(new Error(T.cancelado), { name: 'AbortError' })
    try { const [r] = await runner({ volumes: l.volumes, pieces: j.pieces, outputs: [{ index: 0, dest: j.dest }] }, opts.signal); out.set(j.index, r.error) } catch (err) {
      if ((err as Error).name === 'AbortError') throw err
      out.set(j.index, (err as Error).message)
    }
  }
  if (solid.length) {
    const last = Math.max(...solid.map((s) => s.index))
    const pieces = rarMini(l.rar!, l.rar!.entries[last], (p) => readRarHead(l.rar!, p))!
    try {
      const rs = await runner({ volumes: l.volumes, pieces, outputs: solid.map((s) => ({ index: fileIndex(l, s.index), dest: s.dest })) }, opts.signal)
      solid.forEach((s, k) => out.set(s.index, rs[k].error))
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err
      for (const s of solid) out.set(s.index, (err as Error).message)
    }
  }
  return wanted.map((w) => ({ index: w.index, error: out.has(w.index) ? out.get(w.index)! : T.noSePudo }))
}
