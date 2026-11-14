// Corrida supervisada de la pantalla Discos (MASTERPLAN-2, 0.1), siempre sobre una COPIA de la base:
//   vista:   Discos completos, Tapas y Volumen parejo hasta la vista previa (lee la biblioteca, no escribe nada) y escribe
//            cada propuesta para revisarla a mano.
//   aplicar: sobre la copia completa de la Música (con el aviso de turno): arma y aplica todas las tapas y el volumen parejo,
//            compara contra el original, deshace desde el Historial y vuelve a comparar. Después hay que volver la copia al
//            original con robocopy (AGENTS.es.md).
//
//   node scripts/run-ts.mjs scripts/discos.ts vista   --base <copia.db> --salida <carpeta> [--claves <claves-desarrollo.json>]
//   node scripts/run-ts.mjs scripts/discos.ts aplicar --base <copia.db> --salida <carpeta> --copia <Música-copia> --original <Música> [--muestra 400]
// Con --muestra solo se aplica a unos temas elegidos a propósito (scripts/discos-muestra.ts): la vista previa ya revisa todo.
import fs from 'node:fs'
import path from 'node:path'
import { tomarCopia } from './turnos.mjs'
import { Library } from '@paila/core/library'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { AlbumSources } from '@paila/core/albumsources'
import { AlbumCheck } from '@paila/core/albumrun'
import { Changes } from '@paila/core/changes'
import { Covers } from '@paila/core/covers'
import { gainChanges, gainPlan } from '@paila/core/replaygain'
import { readCover, readReplayGain, readTags } from '@paila/core/tagio'
import { FOLDER_COVER, findFile } from '@paila/core/foldercover'
import { pcmHash } from '@paila/core/audiohash'
import { pickSample } from './discos-muestra'

const mode = process.argv[2]
const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--base'), outDir = arg('--salida')
if (!['vista', 'aplicar'].includes(mode) || !base || !outDir) { console.error('Uso: vista|aplicar --base <copia.db> --salida <carpeta> [--copia <Música-copia> --original <Música>]'); process.exit(2) }
if (/[\\/]PAILA[\\/]paila\.db$/i.test(base)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }
fs.mkdirSync(outDir, { recursive: true })
const ffmpeg = findFfmpeg()!
const ua = 'PAILA/corrida-supervisada (https://github.com/epitelio-ar/PAILA)'
const lib = new Library(base, findFfprobe()!)
const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(outDir, 'datos', 'resguardo'))
// las claves de Discogs se leen en el momento del archivo de desarrollo (nunca se escriben ni se muestran)
const claves = arg('--claves') ? JSON.parse(fs.readFileSync(arg('--claves'), 'utf8')) as { discogs_consumer_key?: string; discogs_consumer_secret?: string } : {}
const discogs = claves.discogs_consumer_key && claves.discogs_consumer_secret ? { key: claves.discogs_consumer_key, secret: claves.discogs_consumer_secret } : null
const check = new AlbumCheck(lib.db, new AlbumSources(lib.db, { ua, discogs }))
const covers = new Covers(lib.db, changes, (i) => lib.trackPath(i), check, { ua, useDeezer: () => true })
const log = (s: string) => { console.log(s); fs.appendFileSync(path.join(outDir, 'corrida.log'), `${new Date().toISOString()} ${s}\n`) }
const progress = (what: string) => (p: { done: number; total: number; current: string }) => { if (p.done % 25 === 0) log(`${what} ${p.done}/${p.total} ${p.current}`) }

async function vista() {
  await check.run(progress('discos'), () => false)
  const rep = check.report()
  const lines = rep.reports.map((r) => [
    `## [${r.status}] ${r.artist} — ${r.album} (${r.tracks} temas) · ${r.dir}`,
    r.edition ? `   edición: ${r.edition.title} · ${[r.edition.date, r.edition.country, r.edition.format].filter(Boolean).join(' · ')} · ${r.edition.tracks} temas · coinciden ${r.edition.matched}${r.edition.note ? ` · ${r.edition.note}` : ''}` : '',
    r.missing.length ? `   faltan: ${r.missing.map((m) => `${m.disc}-${m.pos} ${m.title}`).join(' | ')}` : '',
    r.repeated.length ? `   repetidos: ${r.repeated.map((x) => `${x.title} ×${x.files.length}`).join(' | ')}` : '',
    r.extra.length ? `   no están en la edición: ${r.extra.map((x) => x.split('/').pop()).join(' | ')}` : '',
    r.options.length > 1 ? `   ediciones: ${r.options.map((o) => `${o.tracks}t/${o.matched}c/${o.missing}f ${o.date ?? ''} ${o.country ?? ''}`).join(' · ')}` : '',
  ].filter(Boolean).join('\n'))
  fs.writeFileSync(path.join(outDir, 'discos.txt'), lines.join('\n'))
  log(`discos: ${rep.reports.length} revisados, ${rep.skipped} no se revisan`)
  const props = await covers.scan(progress('tapas'), () => false)
  fs.writeFileSync(path.join(outDir, 'tapas.txt'), props.map((p) => `${p.proposed ? 'NUEVA' : '-----'} | ${p.artist} — ${p.album} (${p.tracks}) | hoy: ${p.current ? `${p.current.width}×${p.current.height}` : `sin (${p.without})`}${p.folder ? ` · carpeta ${p.folder.name} ${p.folder.width}×${p.folder.height}` : ''} | ${p.proposed ? `${p.proposed.source} ${p.proposed.width}×${p.proposed.height} → en ${p.embed}${p.folderFile ? ' + cover.jpg' : ''} · ${p.proposed.sha}` : p.why} | ${p.dir}`).join('\n'))
  log(`tapas: ${props.filter((p) => p.proposed).length} nuevas de ${props.length}`)
  const plan = await gainPlan(lib.db, (i) => lib.trackPath(i), { readCurrent: true, onProgress: progress('volumen') })
  fs.writeFileSync(path.join(outDir, 'volumen.txt'), plan.albums.map((a) => `## ${a.artist} — ${a.album} · disco ${a.gain ?? '–'} dB · pico ${a.peak ?? '–'}\n${a.tracks.map((t) => `   ${t.gain ?? '–'} dB (${t.lufs ?? '–'} LUFS, pico ${t.peak ?? '–'}) ${t.rel}${t.why ? ` · ${t.why}` : ''}`).join('\n')}`).join('\n'))
  log(`volumen: ${plan.ready} listos, ${plan.same} iguales, ${plan.notAnalyzed} sin analizar, ${plan.cantWrite} no se pueden escribir`)
}

/** Lo que interesa comparar de un archivo: tags, tapa, volumen parejo, y el cover.jpg de su carpeta. */
function snapshot(file: string) {
  const pic = (n: string) => { const f = findFile(path.dirname(file), n); return f ? fs.readFileSync(f).toString('base64') : null }
  return JSON.stringify({ tags: readTags(file), cover: readCover(file), rg: readReplayGain(file), coverJpg: pic(FOLDER_COVER), folderJpg: pic('folder.jpg') })
}

async function aplicar() {
  const copia = path.resolve(arg('--copia')), original = path.resolve(arg('--original'))
  if (!copia || !original || copia === original) { console.error('Faltan --copia y --original (distintas)'); process.exit(2) }
  const soltar = await tomarCopia(copia, { que: 'tapas y volumen parejo: aplicar, comparar y deshacer', horas: 2, propio: process.argv.includes('--aviso-propio') }) // el aviso de turno: lo toma y lo suelta solo
  try {
    // la copia de la base apunta a la copia de la Música (mismo disco, otra carpeta)
    const root = lib.roots()[0]
    const rel = path.relative(path.parse(copia).root, copia).split(path.sep).join('/')
    lib.db.prepare('UPDATE roots SET rel_path = ? WHERE id = ?').run(rel, root.id)
    const rootNow = lib.roots()[0].path
    if (path.resolve(rootNow) !== copia) throw new Error(`La base no quedó apuntando a la copia (${rootNow})`)
    const origOf = (f: string) => path.join(original, path.relative(copia, f))
    // las propuestas (internet ya quedó en la caché en la vista previa)
    const props = await covers.scan(progress('tapas'), () => false)
    const st = covers.stage(props.filter((p) => p.proposed).map((p) => p.key))
    const plan = await gainPlan(lib.db, (i) => lib.trackPath(i), { readCurrent: true, onProgress: progress('volumen') })
    changes.stageMany(gainChanges(plan))
    const all = changes.list()
    log(`vista previa: ${all.length} cambios en ${new Set(all.map((c) => c.fileId)).size} temas · el volumen parejo corrige ${plan.wrong} de otro programa · el volumen parejo saltea ${plan.same + plan.other + plan.notAnalyzed + plan.cantWrite} (iguales ${plan.same}, de otro programa y bien ${plan.other}, sin analizar ${plan.notAnalyzed}, no se pueden escribir ${plan.cantWrite})`)
    if (arg('--muestra')) {
      const smp = pickSample(lib.db, all, plan, props, (i) => lib.trackPath(i), Number(arg('--muestra')))
      changes.discard(all.filter((c) => !smp.ids.has(c.fileId)).map((c) => c.id))
      for (const [w, n] of smp.why) log(`   muestra · ${w}: ${n}`)
    }
    const pending = changes.list()
    const ids = [...new Set(pending.map((c) => c.fileId))]
    log(`armado: tapa en ${st.tracks} temas, ${st.folders} cover.jpg, volumen parejo en ${plan.ready} · ${pending.length} cambios en ${ids.length} temas`)
    const files = new Map(ids.map((id) => [id, lib.trackPath(id)!]))
    const before = new Map([...files].map(([id, f]) => [id, snapshot(f)]))
    const origStat = new Map([...files].map(([id, f]) => { const s = fs.statSync(origOf(f)); return [id, `${s.size}:${s.mtimeMs}`] }))
    const t0 = Date.now()
    const r = await changes.apply(undefined, { onProgress: progress('aplicando') })
    log(`aplicado: ${r.applied} cambios en ${((Date.now() - t0) / 60000).toFixed(1)} min; fallaron ${r.failed.length}`)
    for (const f of r.failed) log(`   no se tocó: ${f.rel} · ${f.error}`)
    // comparar: lo que se esperaba quedó escrito; los originales, intactos; el sonido, idéntico al original (muestra)
    let wrong = 0, origTouched = 0
    for (const c of pending) {
      const f = files.get(c.fileId)!
      if (r.failed.some((x) => x.fileId === c.fileId)) continue
      const ok = c.field === 'replaygain' ? readReplayGain(f) === (lib.db.prepare('SELECT after FROM journal WHERE file_id = ? AND field = ? ORDER BY id DESC').get(c.fileId, c.field) as { after: string }).after
        : c.field === 'cover' ? !!readCover(f) : !!findFile(path.dirname(f), FOLDER_COVER)
      if (!ok) { wrong++; log(`   distinto de lo esperado: ${c.rel} · ${c.field}`) }
    }
    for (const [id, f] of files) { const s = fs.statSync(origOf(f)); if (`${s.size}:${s.mtimeMs}` !== origStat.get(id)) { origTouched++; log(`   ¡ORIGINAL TOCADO! ${origOf(f)}`) } }
    const sample = [...files.values()].filter((_, i) => i % Math.max(1, Math.floor(files.size / 60)) === 0)
    let audioDiff = 0
    for (const f of sample) if (await pcmHash(ffmpeg, f) !== await pcmHash(ffmpeg, origOf(f))) { audioDiff++; log(`   sonido distinto al original: ${f}`) }
    log(`comparación: ${wrong} distintos de lo esperado · originales tocados: ${origTouched} · sonido distinto al original: ${audioDiff} de ${sample.length} (muestra)`)
    // deshacer todo y volver a comparar con cómo estaban
    const t1 = Date.now()
    const u = await changes.undo(r.batchId!)
    log(`deshecho: ${u.applied} cambios en ${((Date.now() - t1) / 60000).toFixed(1)} min; fallaron ${u.failed.length}`)
    for (const f of u.failed) log(`   no se pudo deshacer: ${f.rel} · ${f.error}`)
    let back = 0
    for (const [id, f] of files) if (snapshot(f) !== before.get(id)) { back++; log(`   no volvió igual: ${f}`) }
    const strays = [...new Set([...files.values()].map((f) => path.dirname(f)))].flatMap((d) => fs.readdirSync(d).filter((n) => n.includes('.paila-')).map((n) => path.join(d, n)))
    log(`después de deshacer: ${back} temas distintos de antes · temporales sueltos: ${strays.length}`)
    // y contra el original de la Música, también el sonido (si es una muestra: todos)
    if (files.size <= 600) {
      let vsOrig = 0
      for (const f of files.values()) if (snapshot(f) !== snapshot(origOf(f)) || await pcmHash(ffmpeg, f) !== await pcmHash(ffmpeg, origOf(f))) { vsOrig++; log(`   distinto del original: ${f}`) }
      log(`contra el original: ${vsOrig} de ${files.size} temas distintos (tags, tapa, volumen parejo, cover.jpg, Folder.jpg y sonido)`)
    }
  } finally {
    soltar()
    log('aviso de turno sacado. Falta volver la copia al original con robocopy (AGENTS.es.md).')
  }
}

await (mode === 'vista' ? vista() : aplicar())
lib.close()
