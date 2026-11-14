// El motor de operaciones: chequeos previos → por cada paso: diario → hacer → verificar → confirmar. Mover lo hace el
// motor mismo (`runMovesAsync`: organizar, papelera, restaurar, limpieza, Bandeja); escribir y reemplazar traen su propio
// "hacer" y el motor pone los chequeos y la verificación de la copia (ver replace.ts y changes-write.ts).
import fs from 'node:fs'
import type { Db } from '../db'
import { OpJournal, copyDurable } from '../journal'
import { moveNoClobber } from '../safefs'
import { T as C, absOf, precheck, sameFile, type CheckDeps } from './checks'
import type { RunResult, Step } from './types'
import { textos } from '@paila/shared/idioma'

const T = textos({
  ocupado: { es: 'Ya existe un archivo en el destino', en: 'There is already a file where it goes' },
  noEntero: { es: 'No llegó entero al moverlo: quedó donde estaba', en: "It didn't arrive whole when moving it: it stayed where it was" },
  noSeAnotoQueda: { es: (m: string) => `PAILA no lo pudo anotar (${m}): lo termina de acomodar al volver a abrirla`, en: (m: string) => `PAILA couldn't record it (${m}): it finishes sorting it out the next time it opens` },
  noSeAnoto: { es: (m: string) => `PAILA no lo pudo anotar, así que lo dejó donde estaba (${m})`, en: (m: string) => `PAILA couldn't record it, so it left it where it was (${m})` },
  copiaDistinta: { es: 'La copia no quedó igual', en: "The copy didn't come out the same" },
})

export interface MoveDeps<D> extends CheckDeps {
  /** Lo que se guarda en la base cuando el paso terminó (va en la misma transacción que borra la anotación del diario). */
  annotate: (step: Step<D>) => void
  /** Algo para hacer después de confirmar (sacar carpetas vacías). */
  after?: (step: Step<D>) => void
}
export interface RunOpts<D> { onStep?: (done: number, total: number, step: Step<D>, errors: number) => void; isCancelled?: () => boolean }

/** Mueve cada archivo sin pisar nada, verifica que llegó entero y confirma. Nunca deja un paso sin anotar o a medias. */
export function runMoves<D>(db: Db, steps: Step<D>[], deps: MoveDeps<D>, opts: RunOpts<D> = {}): RunResult<D> {
  const { res, ok, journal } = begin(db, steps, deps)
  let n = 0
  for (const step of ok) {
    if (opts.isCancelled?.()) { res.cancelled = true; break }
    opts.onStep?.(n++, ok.length, step, res.failed.length)
    moveStep(journal, step, deps, res)
  }
  return res
}

/**
 * Lo mismo, pero cada ~30 ms le devuelve el control a la app: si no, mientras mueve (Organizar: 436 temas en 4 s, 2.886 en
 * casi un minuto) la ventana queda congelada, la barra de avance no se mueve y Cancelar no llega nunca (corte real con la app,
 * 22/10). Que nada más toque archivos en el medio lo asegura el candado de operaciones.
 */
export async function runMovesAsync<D>(db: Db, steps: Step<D>[], deps: MoveDeps<D>, opts: RunOpts<D> = {}): Promise<RunResult<D>> {
  const { res, ok, journal } = begin(db, steps, deps)
  const breathe = breather()
  let n = 0
  for (const step of ok) {
    await breathe()
    if (opts.isCancelled?.()) { res.cancelled = true; break }
    opts.onStep?.(n++, ok.length, step, res.failed.length)
    moveStep(journal, step, deps, res)
  }
  return res
}

/**
 * Para los que mueven de a un archivo dentro de su propio bucle (la Bandeja: «Reemplazar todos» y lo que no sirvió):
 * llamar `await breathe()` en cada vuelta le devuelve el control a la app si pasaron más de ~30 ms desde la última vez.
 */
export function breather(ms = 30) {
  let last = Date.now()
  return async () => { if (Date.now() - last > ms) { await new Promise((r) => setImmediate(r)); last = Date.now() } }
}

/** Chequeos previos de toda la tanda: lo que no pasa queda como fallado y no se mueve. */
function begin<D>(db: Db, steps: Step<D>[], deps: MoveDeps<D>) {
  const res: RunResult<D> = { done: [], failed: [], cancelled: false }
  const c = precheck(db, steps, deps)
  if (c.fatal) return { res: { ...res, failed: steps.map((step) => ({ step, error: c.fatal! })) }, ok: [] as Step<D>[], journal: null as unknown as OpJournal }
  res.failed.push(...c.failed)
  return { res, ok: c.ok, journal: new OpJournal(db) }
}

/** Un paso: diario → mover → verificar → confirmar (lo anotado y el diario resuelto van en la misma transacción). */
function moveStep<D>(journal: OpJournal, step: Step<D>, deps: MoveDeps<D>, res: RunResult<D>) {
  try {
    const a = absOf(deps, step, step.src), b = step.dst != null ? absOf(deps, step, step.dst) : null
    if (!a || !b) throw new Error(C.sinDisco)
    if (!fs.existsSync(a)) throw new Error(step.missing ?? C.noEsta)
    if (fs.existsSync(b) && !sameFile(a, b)) throw new Error(step.taken ?? T.ocupado)
    const size = fs.statSync(a).size
    const jid = journal.begin({ op: step.op, rootId: step.rootId, fileId: step.fileId, src: step.src, dst: step.dst, data: step.data })
    try { moveFile(a, b) } catch (e) { journal.drop(jid); throw e }
    // verificar: llegó con el mismo tamaño y no quedó también en el origen
    let ok = false
    try { ok = fs.statSync(b).size === size && (sameFile(a, b) || !fs.existsSync(a)) } catch { /* no llegó */ }
    if (!ok) {
      try { if (fs.existsSync(b) && !fs.existsSync(a)) moveNoClobber(b, a) } catch { /* lo resuelve la recuperación */ }
      if (fs.existsSync(a) && !fs.existsSync(b)) journal.drop(jid)
      throw new Error(T.noEntero)
    }
    // anotarlo en la base; si la base no lo acepta, el archivo vuelve a donde estaba: disco y base nunca quedan distintos (pasó el
    // 01/11 con 11 temas: movidos en el disco y la base todavía en el lugar de antes)
    try { journal.done(jid, () => deps.annotate(step)) } catch (e) {
      // un corte (se cerró PAILA, se apagó la compu) lo termina la recuperación al abrir; esto es solo para cuando la base lo rechaza
      if ((e as { code?: string }).code !== 'ERR_SQLITE_ERROR') throw e
      let volvio = false
      try { if (!sameFile(a, b) && fs.existsSync(b) && !fs.existsSync(a)) { moveNoClobber(b, a); volvio = true } } catch { /* queda para la recuperación al abrir */ }
      if (volvio) journal.drop(jid)
      throw new Error((volvio ? T.noSeAnoto : T.noSeAnotoQueda)((e as Error).message))
    }
    res.done.push(step)
    try { deps.after?.(step) } catch { /* solo limpieza */ }
  } catch (e) { res.failed.push({ step, error: (e as Error).message }) }
}

/**
 * Mover sin pisar. Entre discos distintos (la Bandeja en otro disco que su carpeta de trabajo) se copia con sincronización
 * al disco, se compara el tamaño y recién ahí se saca el original.
 */
function moveFile(a: string, b: string) {
  try { moveNoClobber(a, b) } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    copyDurable(a, b)
    if (fs.statSync(b).size !== fs.statSync(a).size) { fs.rmSync(b, { force: true }); throw new Error(T.copiaDistinta) }
    fs.rmSync(a)
  }
}

/** Para las operaciones que traen su propio "hacer" (reemplazar, escribir): solo los chequeos, con el mismo formato de error. */
export function checkOrThrow<D>(db: Db, step: Step<D>, deps: CheckDeps) {
  const c = precheck(db, [step], deps)
  if (c.fatal) throw new Error(c.fatal)
  if (c.failed.length) throw new Error(c.failed[0].error)
}
