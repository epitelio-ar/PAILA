// Chequeos previos del motor de operaciones, para toda la tanda antes de tocar el primer archivo: candado, discos
// conectados, espacio libre, sample packs, archivos que cambiaron desde la vista previa y destinos repetidos u ocupados.
// Lo que afecta a toda la tanda la frena entera; lo que afecta a un archivo lo saltea con el motivo.
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import type { OpLock } from '../oplock'
import { kindFor, type Rule } from '../collections'
import type { Step, StepFailure } from './types'
import { num, textos } from '@paila/shared/idioma'

// Por qué no se hizo una tanda o un archivo: se muestra (Historial, avisos de cada pantalla). Nada lo compara. También lo usa
// ops/run.ts.
export const T = textos({
  sinCandado: {
    es: 'PAILA no tomó el candado de operaciones antes de tocar archivos (es un error de PAILA): no se tocó nada',
    en: "PAILA didn't take the operations lock before touching files (it's a PAILA bug): nothing was touched",
  },
  sinDisco: { es: 'El disco no está conectado', en: "The disk isn't connected" },
  sinEspacio: {
    es: (need: string, free: string) => `Falta espacio en el disco: hacen falta ${need} y quedan ${free} libres. No se tocó nada`,
    en: (need: string, free: string) => `Not enough space on the disk: ${need} needed and ${free} free. Nothing was touched`,
  },
  samples: { es: 'Los sample packs no se tocan', en: "Sample packs aren't touched" },
  noEsta: { es: 'El archivo ya no está', en: "The file isn't there anymore" },
  cambio: { es: 'Cambió desde la vista previa: revisalo de nuevo', en: 'It changed since the preview: check it again' },
  mismoLugar: { es: 'Otro archivo de esta tanda va al mismo lugar', en: 'Another file in this batch goes to the same place' },
  sinDestino: { es: 'El disco de destino no está conectado. No se tocó nada', en: "The destination disk isn't connected. Nothing was touched" },
  aSamples: { es: 'Iría a parar a una carpeta de sample packs: ahí PAILA no mete nada', en: 'It would land in a sample pack folder: PAILA never puts anything there' },
  aExcluida: {
    es: 'Iría a parar a una carpeta que PAILA no toca (PIONEER o un proyecto de Ableton)',
    en: "It would land in a folder PAILA doesn't touch (PIONEER or an Ableton project)",
  },
})

/** Deshacer y restaurar devuelven cada cosa a donde estaba: no se les mira la carpeta de destino. */
const BACK = new Set(['restaurar', 'deshacer-organizar', 'deshacer-tags', 'deshacer-reemplazo', 'papelera', 'limpieza'])

/** El candado de operaciones de cada base. La app lo registra; los tests y scripts que no lo registran no lo exigen. */
const locks = new WeakMap<Db, OpLock>()
export function guardWith(db: Db, lock: OpLock) { locks.set(db, lock) }
export const lockOf = (db: Db) => locks.get(db) ?? null

export interface CheckDeps { rootPath: (rootId: number) => string | null }

/** Ruta completa de un lado del paso (null si su disco no está). En una copia hacia afuera, el destino ya es completo. */
export function absOf(deps: CheckDeps, step: Step, rel: string): string | null {
  if (step.rootId == null || (step.kind === 'copiar' && rel === step.dst)) return rel
  const root = deps.rootPath(step.rootId)
  return root ? path.join(root, ...rel.split('/')) : null
}

/** Mismo archivo con otras mayúsculas (Windows no distingue): mover así no pisa nada. */
export const sameFile = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

const GB = (n: number) => `${num(n / 1e9, { maximumFractionDigits: 1 })} GB`

export interface Checked<D> { fatal: string | null; ok: Step<D>[]; failed: StepFailure<D>[] }

export function precheck<D>(db: Db, steps: Step<D>[], deps: CheckDeps): Checked<D> {
  const out: Checked<D> = { fatal: null, ok: [], failed: [] }
  if (!steps.length) return out
  const lock = lockOf(db)
  if (lock && !lock.busy) return { ...out, fatal: T.sinCandado }
  // discos: si falta uno, no arranca nada (antes cada archivo fallaba por separado y la tanda quedaba a medias)
  const roots = new Map<number, string>()
  for (const s of steps) {
    if (s.rootId == null || roots.has(s.rootId)) continue
    const r = deps.rootPath(s.rootId)
    if (!r) return { ...out, fatal: T.sinDisco }
    roots.set(s.rootId, r)
  }
  // lo que va afuera de tu Música (pendrive, celular, la Bandeja) tiene su destino en una ruta completa: su disco tiene que estar
  const outside = (s: Step<D>) => s.dst != null && (s.kind === 'copiar' || s.rootId == null)
  const drives = new Set(steps.filter(outside).map((s) => path.parse(s.dst!).root.toLowerCase()))
  for (const d of drives) if (!fs.existsSync(d)) return { ...out, fatal: T.sinDestino }
  // espacio libre: lo que se copia, por disco de destino, con un margen del 5 % y 50 MB
  const need = new Map<string, number>()
  for (const s of steps) {
    if (!s.bytes) continue
    const where = outside(s) ? path.parse(s.dst!).root : s.rootId != null ? roots.get(s.rootId)! : path.parse(s.src).root
    need.set(where, (need.get(where) ?? 0) + s.bytes)
  }
  for (const [where, bytes] of need) {
    let free: number
    try { const st = fs.statfsSync(where); free = Number(st.bavail) * Number(st.bsize) } catch { continue } // no se sabe: sigue
    if (bytes * 1.05 + 50e6 > free) return { ...out, fatal: T.sinEspacio(GB(bytes), GB(free)) }
  }
  const kindOf = db.prepare('SELECT kind FROM files WHERE id = ?')
  const rulesOf = new Map<number, Rule[]>()
  const rules = (rootId: number) => {
    let r = rulesOf.get(rootId)
    if (!r) { r = db.prepare('SELECT rel_prefix AS rel, kind FROM rules WHERE root_id = ?').all(rootId) as unknown as Rule[]; rulesOf.set(rootId, r) }
    return r
  }
  const seen = new Set<string>()
  for (const s of steps) {
    const skip = (error: string) => out.failed.push({ step: s, error })
    // Regla del producto: los sample packs nunca se mueven, renombran, reemplazan ni borran, venga de donde venga el pedido
    // (sus tags sí se pueden escribir, sin cambiarles el nombre: lo encontró el laboratorio el 21/10). Copiarlos afuera, sí.
    const renames = s.kind !== 'copiar' && (s.kind !== 'escribir' || (s.dst != null && s.dst !== s.src))
    if (renames && s.fileId != null && (kindOf.get(s.fileId) as { kind: string } | undefined)?.kind === 'produccion') { skip(T.samples); continue }
    // ni nada de tu Música va a parar adentro de un sample pack, de PIONEER o de un proyecto de Ableton (deshacer devuelve a
    // donde estaba: no se mira)
    if (renames && s.rootId != null && s.dst != null && s.dst !== s.src && !BACK.has(s.op)) {
      const k = kindFor(s.dst, rules(s.rootId))
      if (k === 'produccion') { skip(T.aSamples); continue }
      if (k === 'excluir') { skip(T.aExcluida); continue }
    }
    if (s.size != null) {
      const a = absOf(deps, s, s.src)
      let st: fs.Stats | null = null
      try { st = a ? fs.statSync(a) : null } catch { /* no está */ }
      if (!st) { skip(s.missing ?? T.noEsta); continue }
      if (st.size !== s.size || (s.mtime != null && Math.abs(st.mtimeMs - s.mtime) > 2000)) { skip(T.cambio); continue }
    }
    if (s.dst != null && (s.kind === 'mover' || s.kind === 'sacar' || s.kind === 'copiar')) {
      const key = `${s.rootId}|${s.dst.toLowerCase()}`
      if (seen.has(key)) { skip(T.mismoLugar); continue }
      seen.add(key)
    }
    out.ok.push(s)
  }
  return out
}
