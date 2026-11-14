// Lo que PAILA escribe afuera de tu Música (motor único, masterplan 4, 4B.4): copiar al pendrive o al celular, y los archivos
// de otros programas (la colección de Traktor, las crates de Serato, la base de VirtualDJ, el rekordbox.xml, las listas .m3u8).
// Tu Música no se toca, pero va por el mismo camino que todo lo demás: chequeos previos (ops/checks.ts) → diario → una copia
// temporal al lado del destino → verificar → ponerla en su lugar de una vez (nunca queda un archivo a medio escribir) →
// anotarla para el Historial. Si se corta en el medio, la copia temporal es de PAILA: la recuperación la saca y lo que había
// en el destino queda como estaba.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { OpJournal, copyDurable } from '../journal'
import { moveNoClobber } from '../safefs'
import type { Step } from './types'
import { precheck } from './checks'
import { textos } from '@paila/shared/idioma'

/** A dónde se copió: decide cómo se llama la tanda en el Historial. */
export type CopyKind = 'pendrive' | 'celular' | 'traktor' | 'serato' | 'virtualdj' | 'engine' | 'rekordbox' | 'listas'

/** Lo que guarda el diario de cada copia (y la recuperación necesita). */
export interface CopyData { batch: number; kind: CopyKind; dest: string; tmp: string; backup: string | null }

// Por qué no se pudo copiar un archivo: se muestra en el resumen de cada pantalla. Nada lo compara.
const T = textos({
  vacia: { es: 'La copia quedó vacía', en: 'The copy came out empty' },
  distinta: { es: 'La copia no quedó igual', en: "The copy didn't come out the same" },
  ocupado: { es: 'Ya hay un archivo con ese nombre: PAILA no lo pisa', en: "There's already a file with that name: PAILA won't overwrite it" },
})

/** La copia temporal: al lado del destino (así ponerla en su lugar es instantáneo) y con su extensión (la librería de tags la necesita). */
export const tmpOf = (dst: string) => `${dst}.paila-tmp${path.extname(dst)}`

function syncFile(p: string) {
  const fd = fs.openSync(p, 'r+')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

export interface CopyOne {
  fileId?: number | null
  /** El tema de origen, ruta completa (para el Historial); null si se arma de cero. */
  src?: string | null
  dst: string
  /**
   * true: lo que haya en `dst` se reemplaza de una vez (un archivo de otro programa, que antes se guardó en `backup`, o la
   * lista .m3u8 de una copia anterior). Si no, nunca se pisa nada.
   */
  replace?: boolean
  backup?: string | null
}

/** Una tanda de copias hacia afuera (una corrida de "A pendrive", "Llevar al celular", "Exportar a Serato"…). */
export class CopyOut {
  readonly batch: number
  private journal: OpJournal
  /**
   * `log: false`: lo copiado no se anota todavía en el Historial, porque es un paso intermedio (al celular por cable, la
   * carpeta temporal de la compu); lo que después llega a destino se anota con `note`.
   */
  constructor(private db: Db, readonly kind: CopyKind, readonly dest: string, private opts: { log?: boolean } = {}) {
    this.journal = new OpJournal(db)
    // el número de tanda sigue al último anotado, también al de una tanda cortada que todavía está en el diario
    const logged = (db.prepare('SELECT COALESCE(MAX(batch), 0) AS n FROM copies_log').get() as { n: number }).n
    const open = (db.prepare("SELECT COALESCE(MAX(json_extract(data, '$.batch')), 0) AS n FROM op_journal WHERE op = 'copia'").get() as { n: number }).n
    this.batch = Math.max(logged, open) + 1
  }

  /**
   * Un archivo: diario → hacerlo en la copia temporal (`make`; si algo no da, que tire un error) → verificar → ponerlo en su
   * lugar → confirmar. Devuelve cuánto pesa lo que quedó. `expect`: el tamaño que tiene que tener (una copia tal cual).
   */
  async file(o: CopyOne, make: (tmp: string) => Promise<void> | void, expect?: number): Promise<number> {
    const { jid, tmp } = this.start(o)
    try {
      await make(tmp)
      this.place(o, tmp, expect)
    } catch (e) { this.fail(jid, tmp); throw e }
    return this.done(jid, o)
  }

  /** Lo mismo para algo armado en la memoria (una lista, una colección, una crate). */
  write(o: CopyOne, data: string | Buffer): number {
    const { jid, tmp } = this.start(o)
    try {
      fs.writeFileSync(tmp, data)
      this.place(o, tmp, typeof data === 'string' ? Buffer.byteLength(data) : data.length)
    } catch (e) { this.fail(jid, tmp); throw e }
    return this.done(jid, o)
  }

  private start(o: CopyOne) {
    const tmp = tmpOf(o.dst)
    fs.mkdirSync(path.dirname(o.dst), { recursive: true })
    fs.rmSync(tmp, { force: true }) // lo que quedó de una vez anterior: es de PAILA
    if (!o.replace && fs.existsSync(o.dst)) throw new Error(T.ocupado)
    const data: CopyData = { batch: this.batch, kind: this.kind, dest: this.dest, tmp, backup: o.backup ?? null }
    const jid = this.journal.begin({ op: 'copia', fileId: o.fileId ?? null, src: o.src ?? null, dst: o.dst, data })
    return { jid, tmp }
  }

  /** Verificar (que esté, que no esté vacía y, si se sabe, que pese lo que tiene que pesar), al disco, y a su lugar de una vez. */
  private place(o: CopyOne, tmp: string, expect?: number) {
    const size = fs.statSync(tmp).size
    if (expect != null ? size !== expect : size === 0) throw new Error(expect != null && size ? T.distinta : T.vacia)
    syncFile(tmp)
    if (o.replace) fs.renameSync(tmp, o.dst) // en Windows reemplaza de una vez: nunca queda a medio escribir
    else moveNoClobber(tmp, o.dst)
  }

  private fail(jid: number, tmp: string) {
    fs.rmSync(tmp, { force: true })
    this.journal.drop(jid)
  }

  private done(jid: number, o: CopyOne): number {
    const size = fs.statSync(o.dst).size
    this.journal.done(jid, () => { if (this.opts.log !== false) this.note({ ...o, size }) })
    return size
  }

  /** Anota en el Historial algo de esta tanda que llegó a destino por otro camino (al celular por cable, ya verificado). */
  note(o: CopyOne & { size: number }) {
    logCopy(this.db, { batch: this.batch, kind: this.kind, dest: this.dest, backup: o.backup ?? null }, o.fileId ?? null, o.src ?? null, o.dst, o.size)
  }
}

/** La carpeta de las copias de antes, con la fecha y la hora de la compu ("PAILA-respaldos/20261024-153000"). */
export function backupStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * Antes de reemplazar un archivo de otro programa (la colección de Traktor, el rekordbox.xml que elegiste pisar): una copia
 * de lo que había, en `dir`. Devuelve dónde quedó (null si no había nada).
 */
export function keepCopy(file: string, dir: string): string | null {
  if (!fs.existsSync(file)) return null
  const to = path.join(dir, path.basename(file))
  fs.mkdirSync(dir, { recursive: true })
  copyDurable(file, to)
  return to
}

/** Los chequeos de toda la tanda (ops/checks.ts) para lo que se escribe afuera: el candado y que el disco de destino esté. */
export function checkOut(db: Db, dsts: string[]) {
  const c = precheck(db, dsts.map((dst) => copyStep({ rootId: null, fileId: null, src: null, dst })), { rootPath: () => null })
  if (c.fatal) throw new Error(c.fatal)
}

export function logCopy(db: Db, d: Pick<CopyData, 'batch' | 'kind' | 'dest' | 'backup'>, fileId: number | null, src: string | null, dst: string, size: number) {
  db.prepare('INSERT INTO copies_log (batch, kind, dest, file_id, src, dst, size, backup, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(d.batch, d.kind, d.dest, fileId, src, dst, size, d.backup, new Date().toISOString())
}

/**
 * El paso del motor para una copia hacia afuera, para los chequeos previos (`precheck` de ops/checks.ts): el candado, el disco
 * de tu Música de donde sale el tema, el disco de destino y su espacio libre, si el tema cambió desde la vista previa y dos
 * copias al mismo nombre. `src` relativa a la carpeta de música de `rootId`; `dst` completa.
 */
export function copyStep<D = null>(o: { rootId: number | null; fileId: number | null; src: string | null; dst: string; bytes?: number; size?: number; mtime?: number; data?: D }): Step<D> {
  return { kind: 'copiar', op: 'copia', rootId: o.rootId, fileId: o.fileId, src: o.src ?? '', dst: o.dst, bytes: o.bytes, size: o.size, mtime: o.mtime, data: (o.data ?? null) as D }
}

/**
 * Al abrir tras un corte en medio de una copia: si quedó la copia temporal, es de PAILA y se saca (lo que había en el destino
 * sigue igual: se puede volver a copiar). Si ya no está y el destino se escribió después de empezar, se llegó a poner en su
 * lugar: se termina de anotar.
 */
export function recoverCopy(db: Db, e: { fileId: number | null; src: string | null; dst: string; data: unknown; startedAt: string }, R: { aMedias: (n: string) => string; hecha: (n: string) => string; noHecha: (n: string) => string }):
  { result: 'completado' | 'no-hecho'; message: string; annotate?: () => void } | null {
  const d = e.data as CopyData
  if (!fs.existsSync(path.parse(e.dst).root)) return null // el disco de destino no está: la próxima vez
  const name = path.basename(e.dst)
  if (d?.tmp && fs.existsSync(d.tmp)) { fs.rmSync(d.tmp, { force: true }); return { result: 'no-hecho', message: R.aMedias(name) } }
  let st: fs.Stats | null = null
  try { st = fs.statSync(e.dst) } catch { /* no está */ }
  // copiar un archivo en Windows conserva su fecha: la que cambia al ponerlo en su lugar es la de creación o la del cambio
  const touched = st ? Math.max(st.mtimeMs, st.birthtimeMs, st.ctimeMs) : 0
  if (st && touched >= Date.parse(e.startedAt) - 2000) {
    const size = st.size
    return { result: 'completado', message: R.hecha(name), annotate: () => logCopy(db, d, e.fileId, e.src, e.dst, size) }
  }
  return { result: 'no-hecho', message: R.noHecha(name) }
}
