// Corrida supervisada de "Traer una lista de otro lado" (MASTERPLAN-2, 0.1 y 4b): empareja una lista (CSV de Spotify,
// .m3u o texto) con una COPIA de la base y escribe cada tema para revisarlo uno por uno. Para cada "no lo tenés" busca
// además a lo bruto (el título en cualquier nombre de archivo), así se ve si de verdad falta. Lee la Música, no la toca.
//
//   node scripts/run-ts.mjs scripts/listas.ts --base <copia de paila.db> --lista <archivo> --salida <revision.md> [--crear]
//
// --crear: además crea el pedido en la copia (playlist + Faltan o suenan mal), lo revisa y lo deshace.
// --deezer: antes pregunta a Deezer los ISRC de la lista (sin clave; queda en la caché de la copia).
import fs from 'node:fs'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { IsrcIndex } from '@paila/core/isrc'
import { Playlists } from '@paila/core/playlists'
import { Requests } from '@paila/core/requests'
import { Wanted } from '@paila/core/wanted'
import { titleParts } from '@paila/core/listmatch'
import { loose } from '@paila/core/names'
import { visible } from '@paila/core/db'
import { lookupIsrcs } from '@paila/core/listdeezer'
import { parseList } from '@paila/core/listparse'
import { Deezer } from '@paila/core/online/sources'
import type { RequestItem } from '@paila/shared/types'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--base'), list = arg('--lista'), out = arg('--salida')
if (!base || !list || !out) { console.error('Uso: --base <copia de paila.db> --lista <archivo> --salida <revision.md> [--crear]'); process.exit(2) }
if (/\\PAILA\\paila\.db$|\/PAILA\/paila\.db$/i.test(base)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }

const lib = new Library(base, findFfprobe())
const trackPath = (id: number) => lib.trackPath(id)
const isrc = new IsrcIndex(lib.db, findFfprobe()!, trackPath)
const t0 = performance.now()
const r = await isrc.refresh((d, t) => { if (d % 250 === 0 || d === t) process.stdout.write(`\rISRC ${d}/${t}`) })
console.log(`\nISRC: ${r.read} leídos, ${r.found} con código (${((performance.now() - t0) / 1000).toFixed(0)} s)`)
const playlists = new Playlists(lib.db, trackPath)
const wanted = new Wanted(lib.db)
const req = new Requests(lib.db, playlists, wanted, trackPath)
if (process.argv.includes('--deezer')) {
  const isrcs = parseList(fs.readFileSync(list, 'utf8'), list).entries.map((e) => e.isrc).filter((x): x is string => !!x)
  const d = await lookupIsrcs(lib.db, isrcs, new Deezer(), (n, t) => { if (n % 20 === 0 || n === t) process.stdout.write(`
Deezer ${n}/${t}`) })
  console.log(`
Deezer: ${d.asked} preguntados, ${d.found} encontrados`)
}
const t1 = performance.now()
const p = req.preview(fs.readFileSync(list, 'utf8'), list)
const secs = (performance.now() - t1) / 1000

const min = (s: number | null) => (s == null ? '?' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
const all = lib.db.prepare(`SELECT rel_path AS rel, artist, title, duration FROM files WHERE ${visible()} AND kind IN ('musica', 'revisar')`).all() as { rel: string; artist: string | null; title: string | null; duration: number | null }[]
/** Búsqueda floja: el título base en el nombre del archivo o en el tag, sin mirar el artista. */
const loosely = (i: RequestItem) => {
  const b = titleParts(i.title).base
  if (b.length < 4) return []
  return all.filter((f) => loose(f.rel).includes(b) || (f.title && loose(f.title).includes(b))).slice(0, 5)
}
const line = (i: RequestItem) => {
  const f = i.file
  const lib = f ? ` → \`${f.rel}\` (${f.artist ?? '¿?'} / ${f.title ?? '¿?'}, ${min(f.duration)}, ${f.quality})` : ''
  let s = `${i.position}. **${i.state}** · ${i.kind} · ${i.artist} — ${i.title} (${min(i.duration)}${i.isrc ? `, ${i.isrc}` : ''})${lib}\n   - ${i.why}`
  if (i.state === 'falta' && i.kind === 'none') {
    const l = loosely(i)
    s += l.length ? `\n   - ⚠ búsqueda floja: ${l.map((x) => `\`${x.rel}\` (${min(x.duration)})`).join(' · ')}` : '\n   - búsqueda floja: nada'
    // del mismo artista: ¿qué temas tenés? (si alguno es este con otro nombre, salta a la vista)
    const a = i.artist.split(', ').map((x) => loose(x.replace(/^the\s+/i, ''))).filter((x) => x.length >= 3)
    const same = all.filter((f) => a.some((k) => loose(`${f.artist ?? ''} ${f.rel}`).includes(k)))
    if (same.length) s += `\n   - del mismo artista (${same.length}): ${same.slice(0, 6).map((x) => `\`${x.rel.split('/').pop()}\``).join(' · ')}`
  }
  return s
}
const md = [
  `# Lista «${p.name}» — corrida sobre ${base}`, '',
  `${p.source}: ${p.items.length} temas en ${secs.toFixed(1)} s. Tenés ${p.counts.tenes}, en baja calidad ${p.counts.baja}, para confirmar ${p.counts.revisar}, no tenés ${p.counts.falta}. ISRC en la biblioteca: ${p.withIsrc}.`,
  p.skipped.length ? `Filas que no se entendieron: ${p.skipped.join(' | ')}` : '', '',
  ...p.items.map(line), '',
]
if (process.argv.includes('--crear')) {
  // los probables se confirman todos (como si la persona dijera "sí" a cada uno) para ver la playlist entera
  const d = req.create({ name: p.name, source: p.source, items: p.items.map((i) => ({ ...i, fileId: i.file?.id ?? null, decision: i.state === 'revisar' && i.kind === 'probable' ? 'si' : null })) })
  const ids = playlists.trackIds(d.playlistId!)
  const want = wanted.list().filter((w) => w.requests.includes(p.name))
  md.push('## Creado en la copia', '', `Playlist «${d.playlistName}»: ${ids.length} temas. Faltan o suenan mal con el pedido: ${want.length} (${want.filter((w) => w.fileId == null).length} que faltan, ${want.filter((w) => w.fileId != null).length} en baja calidad).`, '')
  const order = d.items.filter((i) => i.state === 'tenes' || i.state === 'baja').map((i) => i.file!.id)
  md.push(`Orden de la playlist igual al de la lista: ${JSON.stringify([...new Set(order)]) === JSON.stringify(ids) ? 'sí' : 'NO'}`, '')
  for (const w of want) md.push(`- ${w.artist} - ${w.title} · ${w.quality}`)
  const n = req.undo(d.id)
  const after = wanted.list().filter((w) => w.requests.includes(p.name)).length
  md.push('', `Deshecho: ${n} temas; la playlist ${lib.db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(d.playlistId) ? 'SIGUE' : 'ya no está'}; quedan ${after} en la lista «Faltan o suenan mal» con ese pedido.`)
}
fs.writeFileSync(out, md.join('\n'), 'utf8')
console.log(`Listo: ${out} (tenés ${p.counts.tenes}, baja ${p.counts.baja}, confirmar ${p.counts.revisar}, falta ${p.counts.falta})`)
lib.close()
