// Corrida supervisada de "exportar de nuevo sin romper" (Fase F): sobre una COPIA de la base, trae el rekordbox.xml de
// Rekordbox y los marcadores de Serato, exporta dos veces y compara tema por tema con el XML original (TrackID, ruta,
// grilla, estrellas y cues). Solo escribe en la copia y en la carpeta de la copia.
// Uso: node scripts/run-ts.mjs scripts/rekordbox-idavuelta.ts --base <copia de paila.db> [--rekordbox x.xml]
import fs from 'node:fs'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Rekordbox } from '@paila/core/rekordbox'
import { parseRbXml } from '@paila/core/rbxml'
import path from 'node:path'
import { carpetaTrabajo } from './turnos.mjs'
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const base = arg('base')!, xml = arg('rekordbox', path.join(carpetaTrabajo(), 'rekordbox.xml'))!
const lib = new Library(base, findFfprobe())
const pl = new Playlists(lib.db, (i) => lib.trackPath(i))
const rb = new Rekordbox(lib.db, (i) => lib.trackPath(i), pl)
const out = path.join(path.dirname(base), 'rekordbox-paila.xml')
rb.dj.importRekordbox(xml); rb.dj.importSerato()
let t = Date.now(); const r = rb.export({ scope: 'todo', playlistIds: [], dest: out, suggestedCues: true }); console.log('export', Date.now() - t, 'ms', r.tracks, 'temas', r.playlists, 'playlists', r.grids, 'con grilla', r.cues, 'con cues', r.skipped.length, 'salteados')
const t2 = Date.now(); rb.export({ scope: 'todo', playlistIds: [], dest: out + '.2', suggestedCues: true }); console.log('segunda', Date.now() - t2, 'ms')
const orig = new Map(parseRbXml(fs.readFileSync(xml, 'utf8')).map((x) => [x.trackId, x]))
const a = parseRbXml(fs.readFileSync(out, 'utf8')), b = parseRbXml(fs.readFileSync(out + '.2', 'utf8'))
const ids = (x: typeof a) => x.map((y) => y.path + '=' + y.trackId).sort().join('\n')
console.log('mismos TrackID en las dos exportaciones:', ids(a) === ids(b))
let same = 0, kept = 0, gridSame = 0, gridN = 0, stars = 0, starsN = 0, cues = 0, cuesN = 0, newIds = 0
const diffs: string[] = []
for (const x of a) {
  const o = orig.get(x.trackId)
  if (!o) { newIds++; continue }
  kept++
  if (o.path.toLowerCase() === x.path.toLowerCase()) same++
  if (o.grid.length) { gridN++; if (JSON.stringify(o.grid) === JSON.stringify(x.grid)) gridSame++; else if (diffs.length < 5) diffs.push(`${x.path}\n  rb  ${JSON.stringify(o.grid.slice(0, 2))}\n  pai ${JSON.stringify(x.grid.slice(0, 2))}`) }
  if (o.stars) { starsN++; if (o.stars === x.stars) stars++ }
  if (o.cues.length) { cuesN++; if (JSON.stringify(o.cues) === JSON.stringify(x.cues.filter((c) => o.cues.some((d) => d.start === c.start)))) cues++ }
}
console.log({ temas: a.length, conTrackIdDeRekordbox: kept, mismaRuta: same, nuevosDePaila: newIds, grillaIgual: `${gridSame}/${gridN}`, estrellasIguales: `${stars}/${starsN}`, cuesIguales: `${cues}/${cuesN}` })
console.log(diffs.join('\n'))
lib.close()
