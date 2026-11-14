// Descomprimir con libarchive (BSD-2, en WebAssembly con el paquete libarchive-wasm, MIT): todo lo de los RAR y los ZIP con
// métodos raros. Se le pasa en memoria solo lo necesario (el "mini RAR" de archive/rarread.ts) y escribe cada archivo de a
// 1 MB, sin juntarlo entero. En la app corre en un hilo aparte (archive/worker.ts): descomprimir no frena la ventana y la
// memoria se devuelve al terminar.
import fs from 'node:fs'
import { libarchiveWasm, type LibarchiveWasm } from 'libarchive-wasm'
import type { Piece } from './rarread'
import { T } from './textos'

/** Lo que libarchive puede tener en memoria de una vez (lo que hace falta leer para sacar un archivo, no lo que pesa el rar). */
export const MAX_MEMORY = 1536 * 1024 * 1024

/** Un pedido: qué bytes leer (de qué partes) y qué archivos de adentro sacar (por orden entre los archivos, 0 = el primero). */
export interface LibJob { volumes: string[]; pieces: Piece[]; outputs: { index: number; dest: string }[] }

let loaded: Promise<LibarchiveWasm> | null = null
const load = () => (loaded ??= libarchiveWasm())

const FILE = 0o100000
const CHUNK = 1 << 20

/** Junta los pedazos en la memoria de libarchive. Devuelve dónde quedaron y cuánto miden. */
function gather(m: LibarchiveWasm, job: LibJob): { ptr: number; size: number } {
  const size = job.pieces.reduce((s, p) => s + (Buffer.isBuffer(p) ? p.length : p.len), 0)
  if (size > MAX_MEMORY) throw new Error(T.muyGrande)
  const ptr = m.module._malloc(Math.max(size, 1))
  if (!ptr) throw new Error(T.sinMemoria)
  const fds = new Map<number, number>()
  try {
    let at = 0
    for (const p of job.pieces) {
      const len = Buffer.isBuffer(p) ? p.length : p.len
      const view = Buffer.from(m.module.HEAP8.buffer, ptr + at, len)
      if (Buffer.isBuffer(p)) p.copy(view)
      else {
        let fd = fds.get(p.vol)
        if (fd == null) { fd = fs.openSync(job.volumes[p.vol], 'r'); fds.set(p.vol, fd) }
        for (let off = 0; off < len;) {
          const n = fs.readSync(fd, view, off, Math.min(len - off, 16 * CHUNK), p.start + off)
          if (n <= 0) throw new Error(T.cortado)
          off += n
        }
      }
      at += len
    }
    return { ptr, size }
  } catch (e) { m.module._free(ptr); throw e } finally { for (const fd of fds.values()) fs.closeSync(fd) }
}

/** Saca los archivos pedidos. Si uno falla, no deja nada a medias de ese archivo y sigue con los demás. */
export async function libExtract(job: LibJob): Promise<{ index: number; error: string | null }[]> {
  const m = await load()
  const res = new Map<number, string | null>()
  const { ptr, size } = gather(m, job)
  try {
    const a = m.read_new_memory(ptr, size)
    const buf = m.module._malloc(CHUNK)
    try {
      const want = new Map(job.outputs.map((o) => [o.index, o.dest]))
      for (let i = 0; res.size < want.size;) {
        let e: number
        try { e = m.read_next_entry(a) } catch (err) { throw new Error(T.noLeer((err as Error).message)) }
        if (!e) break
        if (m.entry_filetype(e) !== FILE) continue
        const dest = want.get(i)
        if (dest == null) { i++; try { m.read_data_skip(a) } catch { /* lo ve el siguiente */ } continue }
        if (m.entry_is_encrypted(e)) { res.set(i++, T.claveNoAbre); continue }
        const fd = fs.openSync(dest, 'w')
        try {
          for (;;) {
            const n = m.read_data(a, buf, CHUNK)
            if (n <= 0) break
            fs.writeSync(fd, Buffer.from(m.module.HEAP8.buffer, buf, n))
          }
          fs.closeSync(fd)
          res.set(i, null)
        } catch (err) {
          fs.closeSync(fd); fs.rmSync(dest, { force: true })
          res.set(i, T.noDescomprimir((err as Error).message || T.danado))
        }
        i++
      }
    } finally { m.module._free(buf); try { m.read_free(a) } catch { /* ya está */ } }
  } finally { m.module._free(ptr) }
  return job.outputs.map((o) => ({ index: o.index, error: res.has(o.index) ? res.get(o.index)! : T.noAdentro }))
}
