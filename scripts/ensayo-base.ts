// Lo común del ensayo general del punto 1 (scripts/ensayo.ts): abrir la copia de la base como la app (siempre apuntando a
// Música-copia), los tiempos de cada paso, la huella de lo que va a cambiar (para controlar el respaldo por paso) y qué dice el
// Historial de cada tanda. Solo escribe en la carpeta de datos del ensayo.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { History } from '@paila/core/history'
import { listBackups } from '@paila/core/ops/backup'
import { createServices } from '../apps/paila/electron/context'
import { datos, log, open } from './corte-base'

export const salidas = path.join(datos, 'salidas')
fs.mkdirSync(salidas, { recursive: true })
const corrida = () => JSON.parse(fs.readFileSync(path.join(datos, 'corrida.json'), 'utf8')) as { startedAt: string }

/** La copia abierta como la app, con todos sus servicios. */
export function abrir() {
  const o = open()
  const c = createServices({ lib: o.lib, ffprobe: findFfprobe()!, ffmpeg: findFfmpeg()!, userData: datos, version: 'ensayo' })
  return { ...o, c, ffmpeg: findFfmpeg()!, ffprobe: findFfprobe()! }
}
export type Abierta = ReturnType<typeof abrir>

/** Guarda un informe en salidas/. */
export const escribir = (nombre: string, md: string) => { fs.writeFileSync(path.join(salidas, nombre), md); log(`→ ${path.join(salidas, nombre)}`) }

/** Anota cuánto tardó algo (salidas/tiempos.json), para la guía. */
export function tiempo(que: string, ms: number, extra: Record<string, unknown> = {}) {
  const f = path.join(salidas, 'tiempos.json')
  const all = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) as unknown[] : []
  all.push({ que, segundos: Math.round(ms / 100) / 10, at: new Date().toISOString(), ...extra })
  fs.writeFileSync(f, JSON.stringify(all, null, 1))
  log(`TIEMPO ${que}: ${(ms / 1000).toFixed(1)} s ${Object.keys(extra).length ? JSON.stringify(extra) : ''}`)
}

export const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')

/**
 * Antes de aplicar: la huella de los bytes de cada archivo que va a cambiar por dentro, por su ruta de ahora. Después, cada
 * archivo del respaldo nuevo tiene que tener la misma huella (es "lo de antes de escribir").
 */
export function huellasAntes(a: Abierta, ids: number[]) {
  const out = new Map<string, string>()
  for (const id of new Set(ids)) {
    const p = a.lib.trackPath(id)
    if (!p || !fs.existsSync(p)) continue
    out.set(path.relative(a.root, p).split(path.sep).join('/').toLowerCase(), md5(p))
    // el cover.jpg de la carpeta también se respalda si cambia
    for (const n of ['cover.jpg', 'folder.jpg']) {
      const cj = path.join(path.dirname(p), n)
      if (fs.existsSync(cj)) out.set(path.relative(a.root, cj).split(path.sep).join('/').toLowerCase(), md5(cj))
    }
  }
  return out
}

/** Los respaldos hechos desde `desde`: que estén completos y que cada copia sea idéntica a lo que había antes de escribir. */
export function controlarRespaldos(a: Abierta, desde: string, antes: Map<string, string>) {
  const mine = listBackups(a.lib.db).filter((b) => b.createdAt >= desde)
  const lines: string[] = []
  let ok = 0, distintos = 0, sinHuella = 0
  for (const b of mine) {
    const files = (fs.readdirSync(b.dir, { recursive: true }) as string[]).filter((x) => fs.statSync(path.join(b.dir, x)).isFile())
    for (const x of files) {
      const want = antes.get(x.split(path.sep).join('/').toLowerCase())
      if (!want) { sinHuella++; continue }
      if (md5(path.join(b.dir, x)) === want) ok++
      else { distintos++; lines.push(`  RESPALDO DISTINTO de lo que había antes: ${x}`) }
    }
    lines.push(`${b.op} · ${b.createdAt} · ${b.files} archivos · ${(b.bytes / 1e6).toFixed(0)} MB · ${b.complete ? 'completo' : 'INCOMPLETO'} · ${b.dir}`)
  }
  lines.push(`Respaldos nuevos: ${mine.length}. Copias idénticas a lo de antes: ${ok}; distintas: ${distintos}; sin huella previa para comparar: ${sinHuella}`)
  for (const l of lines) log(l)
  return { respaldos: mine.length, ok, distintos, sinHuella, lineas: lines }
}

/** El Historial, armado como en la app. */
export function historialDe(a: Abierta) {
  const c = a.c
  return new History(a.lib.db, { changes: c.changes, trash: c.trash, organizer: c.organizer, replacer: c.replacer, improver: c.improver, listas: c.playlistOps, requests: c.requests, imports: c.imports, added: c.inboxAdd, archives: c.archiveExtract, archiveTrash: c.archiveTrash, rootPath: a.rootPath })
}

/** Qué dice el Historial de las tandas de este ensayo (todas tienen que poder deshacerse). */
export function historial(a: Abierta) {
  const mine = historialDe(a).list().filter((e) => e.at >= corrida().startedAt)
  for (const e of mine) log(`Historial: ${e.kind} ${e.id} · ${e.summary} · ${e.files} archivos${e.undone ? ' · deshecha' : ''} · ${e.canUndo ? 'se puede deshacer' : `NO se puede deshacer: ${e.whyNot}`}`)
  return mine
}

/** "Aplicar todo" en Cambios pendientes: respaldo por paso controlado y tiempo. */
export async function aplicarPendientes(a: Abierta, que: string) {
  const pend = a.c.changes.list()
  const plan = a.c.changes.backupPlan()
  log(`Respaldo previsto: ${JSON.stringify(plan).slice(0, 400)}`)
  const antes = huellasAntes(a, pend.map((x) => x.fileId))
  const desde = ahora()
  const t1 = Date.now()
  let last = 0
  const r = await a.lib.ops.run(`ensayo: ${que}`, () => a.c.changes.apply(undefined, { onProgress: (x) => { if (x.done - last >= 250) { last = x.done; log(`  ${x.done}/${x.total}`) } } }))
  tiempo(`${que}: aplicar`, Date.now() - t1, { cambios: r.applied, pendientes: pend.length, temas: new Set(pend.map((x) => x.fileId)).size, fallas: r.failed.length })
  for (const f of r.failed) log(`  FALLA ${f.rel}: ${f.error}`)
  const quedan = a.c.changes.list()
  if (quedan.length) log(`Quedaron pendientes: ${quedan.length}: ${quedan.slice(0, 10).map((x) => `${x.field} ${x.rel}`).join(' · ')}`)
  const resp = controlarRespaldos(a, desde, antes)
  escribir(`${que}-aplicar.md`, [`# ${que}: aplicar (${desde})`, '', `${r.applied} cambios, ${r.failed.length} fallas.`, ...r.failed.map((f) => `- FALLA \`${f.rel}\`: ${f.error}`), '', '## Respaldo', ...resp.lineas].join('\n'))
  historial(a).filter((e) => e.at >= desde)
}

/** "3:05" */
export const min = (s: number | null) => (s == null ? '?' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
export const ahora = () => new Date().toISOString()
