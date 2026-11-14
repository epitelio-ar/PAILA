// Recortar silencios de verdad sobre una muestra (masterplan 4, 4A.3), en D:\PAILA-trabajo\Música-copia y nunca en la Música:
//   preparar:  copia la base (con los silencios medidos), la apunta a la copia de la Música, elige la muestra y la deja en
//              Cambios pendientes (para apretar Aplicar en la app). Pide el aviso copia-en-uso.lock.
//   controlar: después de Aplicar, cada recortado contra su original de la Música: dura lo propuesto, los tags quedaron byte a
//              byte, el audio que queda es el mismo (core/trimfile.ts ya lo verificó: acá se mira de nuevo, de afuera).
//   app-aplicar / app-deshacer: con la app compilada (scripts/conducir.ts): Aplicar en Cambios pendientes, o Deshacer la tanda
//              "Recorte de silencios" en el Historial, con capturas (--capturas <carpeta>).
//   probar-todos --plan <json>: recorta una copia (en una carpeta temporal) de cada tema propuesto, para ver antes de aplicar
//              que ninguno falle (la verificación de core/trimfile.ts). No toca la Música ni la copia.
//   comparar:  después de Deshacer, cada tema de la muestra es idéntico al de la Música (MD5 del archivo entero).
//   node scripts/run-ts.mjs scripts/recortes-muestra.ts preparar --base <copia.db con silencios> --datos <carpeta> --cuantos 30 [--plan <recortes.md.json>]
//   (--plan: la propuesta de scripts/recortes.ts sobre la Música, que es igual a la copia: así no se leen los temas otra vez)
//   node scripts/run-ts.mjs scripts/recortes-muestra.ts controlar|comparar --datos <carpeta>
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { Library } from '@paila/core/library'
import { findFfprobe, probe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { planTrims, trimValue } from '@paila/core/trim'
import { mp3Layout } from '@paila/core/trimmp3'
import { readTags } from '@paila/core/tagio'
import { trimToFile } from '@paila/core/trimfile'
import os from 'node:os'
import type { TrimProposal } from '@paila/shared/types'
import { abrirApp, type App } from './conducir'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
const mode = process.argv[2]
const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const datos = arg('--datos'), dbFile = path.join(datos, 'paila.db'), muestraFile = path.join(datos, 'muestra.json')
const COPIA = 'D:/PAILA-trabajo/Música-copia', ORIGINAL = 'D:/Música'
const fail = (m: string) => { console.error(m); process.exit(2) }
const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
const at = (root: string, rel: string) => path.join(root, ...rel.split('/'))

function open(): Library {
  const lib = new Library(dbFile, ffprobe)
  const roots = lib.roots()
  if (roots.length !== 1 || !/PAILA-trabajo[\\/]Música-copia$/i.test(roots[0].path)) fail(`La base no apunta a la copia: ${roots.map((r) => r.path).join(', ')}`)
  return lib
}

async function preparar() {
  const base = arg('--base'), cuantos = Number(arg('--cuantos', '30'))
  if (!base || !datos) fail('Uso: preparar --base <copia.db> --datos <carpeta> [--cuantos 30]')
  if (!fs.existsSync('D:/PAILA-trabajo/copia-en-uso.lock')) fail('Falta el aviso D:\\PAILA-trabajo\\copia-en-uso.lock')
  if (fs.existsSync(dbFile)) fail(`Ya hay una base en ${dbFile}`)
  fs.mkdirSync(datos, { recursive: true })
  const src = new DatabaseSync(base, { readOnly: true })
  src.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`)
  src.close()
  const raw = new DatabaseSync(dbFile)
  raw.prepare("UPDATE roots SET rel_path = 'PAILA-trabajo/Música-copia' WHERE id = 1").run()
  raw.close()
  const lib = open()
  // --plan: la propuesta de scripts/recortes.ts sobre la Música (igual a la copia): así no se leen los temas otra vez
  const planFile = arg('--plan')
  const plan = planFile ? JSON.parse(fs.readFileSync(planFile, 'utf8')) as Awaited<ReturnType<typeof planTrims>>
    : await planTrims(lib.db, (i) => lib.trackPath(i), ffmpeg, { onProgress: (d, t) => process.stdout.write(`\r${d}/${t}`) })
  // una muestra variada: de cada tipo (formato y lados que se cortan), repartida
  const kinds = new Map<string, TrimProposal[]>()
  for (const p of plan.items) { const k = `${p.ext} ${p.cutStart ? 'principio' : ''}${p.cutEnd ? ' final' : ''}${p.note ? ' (nota)' : ''}`; kinds.set(k, [...(kinds.get(k) ?? []), p]) }
  const pick: TrimProposal[] = []
  for (let round = 0; pick.length < cuantos && round < 100; round++) for (const xs of kinds.values()) if (xs[round] && pick.length < cuantos) pick.push(xs[round])
  const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(datos, 'resguardo'))
  changes.stageMany(pick.map((p) => ({ id: p.fileId, field: 'trim' as const, value: trimValue(p) })))
  fs.writeFileSync(muestraFile, JSON.stringify(pick.map((p) => ({ ...p, md5: md5(at(ORIGINAL, p.rel)) })), null, 1))
  console.log(`\n${plan.items.length} propuestos; muestra de ${pick.length} en Cambios pendientes: ${[...kinds].map(([k, xs]) => `${k}: ${xs.length}`).join(' · ')}`)
  lib.close()
}

/** Los bytes que no son audio (los tags), para compararlos entre el original y el recortado. */
function tagBytes(file: string, ext: string): Buffer[] {
  const b = fs.readFileSync(file)
  if (ext === 'mp3') { const L = mp3Layout(b); return [b.subarray(0, L.start), b.subarray(L.end)] }
  if (ext === 'wav') {
    const out: Buffer[] = []
    for (let i = 12; i + 8 <= b.length;) { const id = b.toString('latin1', i, i + 4), n = b.readUInt32LE(i + 4); if (id !== 'data') out.push(b.subarray(i, i + 8 + n)); i += 8 + n + (n & 1) }
    return out
  }
  if (ext === 'aiff' || ext === 'aif') {
    const out: Buffer[] = []
    for (let i = 12; i + 8 <= b.length;) { const id = b.toString('latin1', i, i + 4), n = b.readUInt32BE(i + 4); if (id !== 'SSND' && id !== 'COMM') out.push(b.subarray(i, i + 8 + n)); i += 8 + n + (n & 1) }
    return out
  }
  // FLAC: los bloques que no son STREAMINFO ni la tabla de saltos
  const out: Buffer[] = []
  let i = b.indexOf('fLaC') + 4
  for (let last = false; !last;) { last = (b[i] & 0x80) !== 0; const t = b[i] & 0x7f, n = b.readUIntBE(i + 1, 3); if (t !== 0 && t !== 3) out.push(b.subarray(i + 4, i + 4 + n)); i += 4 + n }
  return out
}

async function controlar() {
  const muestra = JSON.parse(fs.readFileSync(muestraFile, 'utf8')) as (TrimProposal & { md5: string })[]
  const lib = open()
  let ok = 0
  for (const p of muestra) {
    const row = lib.db.prepare('SELECT rel_path AS rel FROM files WHERE id = ?').get(p.fileId) as { rel: string }
    const now = at(COPIA, row.rel), orig = at(ORIGINAL, p.rel)
    const bad: string[] = []
    const d = (await probe(ffprobe, now)).duration ?? 0
    if (Math.abs(d - (p.to - p.from)) > 0.2) bad.push(`dura ${d.toFixed(2)} s y tenía que durar ${(p.to - p.from).toFixed(2)}`)
    const a = tagBytes(orig, p.ext), b = tagBytes(now, p.ext)
    if (a.length !== b.length || a.some((x, k) => !x.equals(b[k]))) bad.push('los tags no quedaron byte a byte')
    if (JSON.stringify(readTags(orig)) !== JSON.stringify(readTags(now))) bad.push('los tags leídos cambiaron')
    if (md5(now) === p.md5) bad.push('no se recortó')
    if (!lib.db.prepare("SELECT 1 FROM replacements WHERE file_id = ? AND batch LIKE 'recorte-%' AND undone_at IS NULL").get(p.fileId)) bad.push('no quedó en el Historial')
    console.log(`${bad.length ? 'MAL' : 'bien'} · ${p.rel} · ${p.cutStart ? `−${p.from.toFixed(1)} s al empezar ` : ''}${p.cutEnd ? `−${(p.duration - p.to).toFixed(1)} s al terminar` : ''}${bad.length ? ` · ${bad.join('; ')}` : ''}`)
    if (!bad.length) ok++
  }
  console.log(`${ok} de ${muestra.length} bien`)
  lib.close()
}

function comparar() {
  const muestra = JSON.parse(fs.readFileSync(muestraFile, 'utf8')) as (TrimProposal & { md5: string })[]
  let ok = 0
  for (const p of muestra) {
    const same = fs.existsSync(at(COPIA, p.rel)) && md5(at(COPIA, p.rel)) === p.md5
    if (!same) console.log(`DISTINTO · ${p.rel}`)
    else ok++
  }
  console.log(`${ok} de ${muestra.length} idénticos al original de la Música`)
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const foto = async (a: App, nombre: string) => { const d = arg('--capturas'); if (d) { fs.mkdirSync(d, { recursive: true }); await a.captura(path.join(d, `recortes-${nombre}.png`)) } }
const replacements = (q: string) => { const db = new DatabaseSync(dbFile, { readOnly: true }); try { return (db.prepare(q).get() as { n: number }).n } finally { db.close() } }

async function appAplicar() {
  const a = await abrirApp(datos, { log: path.join(datos, 'app.log') })
  await espera(4000)
  await a.clic('Ver antes y después').catch(() => {})
  await espera(800)
  await foto(a, 'cambios-pendientes')
  const t0 = Date.now()
  await a.clic('Aplicar')
  // hasta que la tanda termina (el panel dice "Terminó"); los que no se pudieron aplicar quedan pendientes
  while (Date.now() - t0 < 20 * 60_000 && !/Terminó|Finished/.test(await a.texto())) await espera(1000)
  await espera(2500)
  await foto(a, 'aplicado')
  console.log(`Aplicado en ${Math.round((Date.now() - t0) / 1000)} s: ${replacements("SELECT COUNT(*) AS n FROM replacements WHERE batch LIKE 'recorte-%' AND undone_at IS NULL")} recortes en el Historial`)
  await a.clic('Historial', { dentroDe: 'nav, aside, .sidebar' }).catch(() => a.clic('Historial'))
  await a.esperarTexto(/Se recortaron los silencios/, 30_000)
  await foto(a, 'historial')
  await a.cerrar()
}

async function appDeshacer() {
  const a = await abrirApp(datos, { log: path.join(datos, 'app.log') })
  await espera(4000)
  await a.clic('Historial', { dentroDe: 'nav, aside, .sidebar' }).catch(() => a.clic('Historial'))
  await a.esperarTexto(/Se recortaron los silencios/, 30_000)
  // marca la tanda de recortes para apretar su Deshacer (y no el de otra)
  const ok = await a.js<boolean>(`(() => { const b = [...document.querySelectorAll('.box')].find((x) => /Se recortaron los silencios/.test(x.textContent) && [...x.querySelectorAll('button')].some((y) => y.textContent.trim() === 'Deshacer')); if (b) b.setAttribute('data-recorte', '1'); return !!b })()`)
  if (!ok) fail('No encontré la tanda de recortes para deshacer')
  const t0 = Date.now()
  await a.clic('Deshacer', { dentroDe: '[data-recorte]' })
  await a.clic('Sí, deshacer', { dentroDe: '[data-recorte]' }).catch(() => a.clic('Sí, deshacer'))
  while (replacements("SELECT COUNT(*) AS n FROM replacements WHERE batch LIKE 'recorte-%' AND undone_at IS NULL") > 0 && Date.now() - t0 < 10 * 60_000) await espera(1000)
  await espera(2000)
  await foto(a, 'deshecho')
  console.log(`Deshecho en ${Math.round((Date.now() - t0) / 1000)} s: quedan ${replacements("SELECT COUNT(*) AS n FROM replacements WHERE batch LIKE 'recorte-%' AND undone_at IS NULL")} sin deshacer`)
  await a.cerrar()
}

async function probarTodos() {
  const plan = JSON.parse(fs.readFileSync(arg('--plan'), 'utf8')) as { items: TrimProposal[] }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-recortes-'))
  let ok = 0
  try {
    for (const p of plan.items) {
      const ext = path.extname(p.rel), src = path.join(tmp, `src${ext}`), out = path.join(tmp, `out${ext}`)
      fs.copyFileSync(at(ORIGINAL, p.rel), src)
      try { await trimToFile(ffmpeg, src, ext.slice(1).toLowerCase(), p.from, p.cutEnd ? p.to : Infinity, out); ok++ } catch (e) { console.log(`MAL · ${p.rel} · ${(e as Error).message}`) }
      fs.rmSync(out, { force: true })
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  console.log(`${ok} de ${plan.items.length} se recortan y verifican bien`)
}

if (mode === 'preparar') await preparar()
else if (mode === 'probar-todos') await probarTodos()
else if (mode === 'app-aplicar') await appAplicar()
else if (mode === 'app-deshacer') await appDeshacer()
else if (mode === 'controlar') await controlar()
else if (mode === 'comparar') comparar()
else fail('Modos: preparar | probar-todos | app-aplicar | controlar | app-deshacer | comparar')
