// Corrida supervisada de exportar a Traktor, Serato y VirtualDJ (MASTERPLAN-3, punto 4) con la biblioteca de verdad: usa una
// COPIA de la base, lee la música sin tocarla y escribe todo en una carpeta de pruebas (una "carpeta de usuario" falsa:
// las crates, la base de VirtualDJ y el .nml van ahí, nunca a las carpetas de los programas). La grilla de Serato para
// adentro de los archivos solo se calcula (no se aplica). Deja un resumen y muestras para revisar a mano.
//
//   node scripts/run-ts.mjs scripts/llevar-dj.ts <carpeta de pruebas> [base.db]
import fs from 'node:fs'
import path from 'node:path'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Rekordbox } from '@paila/core/rekordbox'
import { DjExport } from '@paila/core/djexport'
import { readCrate } from '@paila/core/seratofmt'
import { seratoText } from '@paila/core/seratotag'

const dir = path.resolve(process.argv[2] ?? 'D:/PAILA-trabajo/punto4')
const real = process.argv[3] ?? path.join(process.env.APPDATA ?? '', 'PAILA', 'paila.db')
if (/^f:[\\/]+música/i.test(dir)) throw new Error('La carpeta de pruebas no puede estar dentro de D:\\Música')
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
for (const f of ['', '-wal', '-shm']) if (fs.existsSync(real + f)) fs.copyFileSync(real + f, path.join(dir, `paila.db${f}`))

const lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
const pl = new Playlists(lib.db, (i) => lib.trackPath(i))
const rb = new Rekordbox(lib.db, (i) => lib.trackPath(i), pl)
const home = path.join(dir, 'usuario')
const dj = new DjExport(rb, home, path.join(home, 'AppData', 'Local', 'VirtualDJ'))
const o = { scope: 'todo' as const, playlistIds: [], grid: true, suggestedCues: false, pailaWhenMoving: false }
const out: string[] = []
const log = (s: string) => { out.push(s); console.log(s) }
const time = <T>(name: string, f: () => T): T => { const t = Date.now(); const r = f(); log(`${name}: ${((Date.now() - t) / 1000).toFixed(1)} s`); return r }

const t = time('Traktor', () => dj.traktor({ ...o, dest: path.join(dir, 'PAILA para Traktor.nml') }))
log(`  ${t.tracks} temas, ${t.playlists} playlists, ${t.grids} con grilla, ${t.cues} con cues, ${t.simplified} grillas variables simplificadas, ${t.skipped.length} afuera`)
const nml = fs.readFileSync(t.written[0], 'utf8')
log(`  ENTRY: ${(nml.match(/<ENTRY MODIFIED_DATE/g) ?? []).length} · marcadores de grilla: ${(nml.match(/TYPE="4"/g) ?? []).length} · cues: ${(nml.match(/TYPE="[05]"/g) ?? []).length} · temas con +26 ms: ${(nml.match(/<ENTRY/g) ?? []).length ? '(ver muestras)' : ''}`)

const s = time('Serato (crates)', () => dj.serato(o))
log(`  ${s.written.length} crates en ${path.dirname(s.written[0] ?? '')}`)
const ch = time('Serato (grilla adentro, solo calcular)', () => dj.seratoChanges(o))
log(`  ${ch.items.length} temas tendrían su grilla y cues adentro; ${ch.alreadyIn} ya tienen marcas de Serato (no se tocan)`)
for (const i of ch.items.slice(0, 8)) log(`  · ${lib.trackPath(i.id)?.split(/[\\/]/).slice(-2).join('/')}: ${seratoText(i.value)}`)

const v = time('VirtualDJ', () => dj.virtualdj(o))
log(`  ${v.tracks} temas, ${v.written.length} archivos, ${v.kept} con cues propios (no se tocan), ${v.simplified} grillas variables simplificadas`)

// muestras para revisar a mano: nombres raros, tildes, "&", rutas largas
const crates = s.written.filter((f) => f.endsWith('.crate'))
const sample = crates.slice(0, 5).map((f) => `${path.basename(f)}: ${readCrate(fs.readFileSync(f)).length} temas, p. ej. ${readCrate(fs.readFileSync(f))[0] ?? '-'}`)
log('Crates (muestra):'); for (const l of sample) log(`  ${l}`)
const raros = nml.match(/<ENTRY [^>]*(&amp;|&quot;|[ñáéíóú])[^>]*>/gi)?.slice(0, 5) ?? []
log('Traktor, títulos con símbolos (muestra):'); for (const l of raros) log(`  ${l}`)
// --aplicar N --copia <carpeta>: escribe de verdad la grilla de Serato en N temas (de todos los formatos) de una COPIA de la
// música, comprueba que Serato la leería igual, y deshace. Antes hay que tomar D:\PAILA-trabajo\copia-en-uso.lock.
const n = Number(process.argv[process.argv.indexOf('--aplicar') + 1] || 0)
const copia = process.argv.includes('--copia') ? process.argv[process.argv.indexOf('--copia') + 1] : null
if (process.argv.includes('--aplicar') && n > 0 && copia) await aplicar(n, copia)
fs.writeFileSync(path.join(dir, 'resumen.txt'), out.join('\n') + '\n')
lib.close()

async function aplicar(cuantos: number, carpeta: string) {
  const { Changes } = await import('@paila/core/changes')
  const { readSerato } = await import('@paila/core/serato')
  const { readSeratoTag } = await import('@paila/core/seratotag')
  const { readTags } = await import('@paila/core/tagio')
  const ffmpeg = (await import('ffmpeg-static')).default as unknown as string
  // la copia de la base apunta a la copia de la música (nunca a D:\Música)
  const vol = carpeta.slice(0, 3), rel = carpeta.slice(3)
  if (/^música$/i.test(rel.replace(/[\\/]+$/, ''))) throw new Error('Eso es la Música de verdad: solo copias')
  lib.db.prepare('UPDATE roots SET rel_path = ?').run(rel)
  log(`Raíz de la copia de la base: ${vol}${rel}`)
  const all = dj.seratoChanges(o)
  // una muestra pareja por formato
  const byExt = new Map<string, typeof all.items>()
  for (const i of all.items) { const e = path.extname(lib.trackPath(i.id) ?? '').toLowerCase(); byExt.set(e, [...(byExt.get(e) ?? []), i]) }
  const pick: typeof all.items = []
  for (let k = 0; pick.length < cuantos && [...byExt.values()].some((v) => v.length > k); k++) for (const v of byExt.values()) if (v[k] && pick.length < cuantos) pick.push(v[k])
  log(`Muestra: ${pick.length} temas (${[...byExt].map(([e, v]) => `${e} ${Math.min(v.length, pick.filter((p) => v.includes(p)).length)}`).join(', ')}); ${all.unreadable.length} no se pudieron leer`)
  const before = new Map(pick.map((i) => { const f = lib.trackPath(i.id)!; return [i.id, { tags: readTags(f, { exact: true }), serato: readSeratoTag(f) }] }))
  const ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
  ch.stageMany(pick.map((i) => ({ id: i.id, field: 'serato' as const, value: i.value })))
  const t0 = Date.now()
  const r = await ch.apply()
  log(`Aplicar: ${r.applied} bien, ${r.failed.length} con error, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  for (const f of r.failed) log(`  ERROR ${f.rel}: ${f.error}`)
  let leidos = 0
  for (const i of pick) {
    const f = lib.trackPath(i.id)!, m = readSerato(f, path.extname(f).slice(1))
    const want = JSON.parse(i.value) as { bg?: string }
    if (m && (!!m.grid === !!want.bg)) leidos++
    else log(`  NO SE LEE ${f}`)
  }
  log(`Serato lo leería: ${leidos} de ${pick.length}`)
  const u = await ch.undo(r.batchId!)
  log(`Deshacer: ${u.applied} bien, ${u.failed.length} con error`)
  let iguales = 0
  for (const [id, b] of before) {
    const f = lib.trackPath(id)!
    if (JSON.stringify({ tags: readTags(f, { exact: true }), serato: readSeratoTag(f) }) === JSON.stringify(b)) iguales++
    else log(`  DISTINTO después de deshacer: ${f}`)
  }
  log(`Tags y marcas como antes: ${iguales} de ${before.size} (el sonido lo verificó cada escritura con su huella)`)
}
