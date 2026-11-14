// Corrida supervisada de "Traer tus playlists de Rekordbox" (MASTERPLAN-3, 4): lee un rekordbox.xml o un pendrive de CDJ, lo
// empareja con una COPIA de la base y escribe cada playlist con cada tema (cómo se encontró y con qué archivo) para revisarlo.
// Solo lee el XML, el pendrive y la Música; con --crear además crea la tanda en la copia, la revisa y la deshace.
//
//   node scripts/run-ts.mjs scripts/traer-rekordbox.ts --base <copia de paila.db> (--xml <rekordbox.xml> | --pendrive <carpeta>) --salida <revision.md> [--crear] [--huella]
//
// --huella: busca por cómo suenan los que no aparecieron y cuyo archivo está en esta compu (decodifica: tarda ~2 s por tema).
import fs from 'node:fs'
import path from 'node:path'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Requests } from '@paila/core/requests'
import { Wanted } from '@paila/core/wanted'
import { DjData } from '@paila/core/djdata'
import { ListImports, readPendrive, readRbXml } from '@paila/core/listimport'
import { analyzePrints } from '@paila/core/analysis/analyze'
import { matchByPrint } from '@paila/core/printmatch'
import { createRequire } from 'node:module'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--base'), xml = arg('--xml'), usb = arg('--pendrive'), out = arg('--salida')
if (!base || (!xml && !usb) || !out) { console.error('Uso: --base <copia de paila.db> (--xml <archivo> | --pendrive <carpeta>) --salida <revision.md> [--crear] [--huella]'); process.exit(2) }
if (/\\PAILA\\paila\.db$|\/PAILA\/paila\.db$/i.test(base)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }

const lib = new Library(base, findFfprobe())
const trackPath = (id: number) => lib.trackPath(id)
const playlists = new Playlists(lib.db, trackPath)
const req = new Requests(lib.db, playlists, new Wanted(lib.db), trackPath)
const imp = new ListImports(lib.db, req, playlists, new DjData(lib.db, trackPath))

const t0 = performance.now()
const source = xml ? readRbXml(xml) : readPendrive(usb)
const t1 = performance.now()
let p = await imp.preview(source)
const t2 = performance.now()
console.log(`Leído en ${((t1 - t0) / 1000).toFixed(1)} s; emparejado en ${((t2 - t1) / 1000).toFixed(1)} s: ${p.tracks} temas en ${p.lists.length} playlists`, p.how)
if (process.argv.includes("--huella") && p.printable) {
  const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
  p = await imp.byPrint(p.token, async (file, duration) => {
    const pr = await analyzePrints({ ffmpeg, file, channels: null })
    const best = pr.chromaprint ? (await matchByPrint(lib.db, pr.chromaprint, { duration, limit: 3 }))[0] : undefined
    return best?.kind === 'mismo' ? best.fileId : null
  }, (d, t) => process.stdout.write(`\rhuella ${d}/${t}`))
  console.log('\nCon huella:', p.how)
}

const min = (s: number | null) => (s == null ? '?' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
const lines: string[] = [`# Revisión: traer de ${p.label} (${path.basename(p.origin)})`, '', `- ${p.tracks} temas distintos en ${p.lists.length} playlists; leído en ${((t1 - t0) / 1000).toFixed(1)} s, emparejado en ${((t2 - t1) / 1000).toFixed(1)} s.`,
  `- Cómo se encontraron: ${Object.entries(p.how).map(([k, v]) => `${k} ${v}`).join(' · ')}.`, p.outside.count ? `- En la compu pero fuera de la biblioteca (quedan afuera): ${p.outside.count}, por ejemplo ${p.outside.examples.join(', ')}.` : '', p.dj ? `- Del pendrive se puede recuperar: grilla ${p.dj.grids}, cues ${p.dj.cues}, estrellas ${p.dj.stars}, color ${p.dj.colours} (${p.dj.tracks} temas).` : '', '']
for (const l of p.lists) {
  lines.push(`## ${[...l.folders, l.name].join(' / ')} (${l.total} temas: ${l.counts.tenes} tenés, ${l.counts.baja} mala calidad, ${l.counts.revisar} para confirmar, ${l.counts.falta} faltan)`, '')
  for (const i of imp.items(p.token, l.key)) {
    const f = i.file ? ` → \`${i.file.rel}\` (${i.file.artist ?? '¿?'} / ${i.file.title ?? '¿?'}, ${min(i.file.duration)}, ${i.file.quality})` : ''
    lines.push(`${i.position}. **${i.state}** · ${i.kind} · ${i.artist || '—'} — ${i.title} (${min(i.duration)})${f}`, `   - ${i.why}`)
  }
  lines.push('')
}
if (process.argv.includes('--crear')) {
  const before = (lib.db.prepare('SELECT COUNT(*) AS n FROM playlists').get() as { n: number }).n
  const r = imp.create(p.token, p.lists.map((l) => l.key), {}, !!p.dj)
  const made = (lib.db.prepare('SELECT COUNT(*) AS n FROM playlists').get() as { n: number }).n - before
  imp.undo(r.id)
  const after = (lib.db.prepare('SELECT COUNT(*) AS n FROM playlists').get() as { n: number }).n
  lines.push('## Crear y deshacer en la copia', '', `- Se crearon ${made} playlists y carpetas (${r.playlists} playlists, ${r.inLists} temas, ${r.toGet} a la lista «Faltan o suenan mal»; grilla ${r.dj.grids}, cues ${r.dj.cues}).`, `- Al deshacer quedaron ${after - before} de más (tiene que ser 0).`, '')
}
fs.writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`Revisión en ${out}`)
lib.close()
