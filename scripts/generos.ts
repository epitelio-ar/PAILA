// Corrida supervisada de "Géneros desde internet" (MASTERPLAN-3, punto 4), siempre sobre una COPIA de la base: busca en
// Discogs (y en Last.fm, si se pasa la clave) los temas sin género, arma las propuestas en los dos niveles y las escribe
// para revisarlas a mano. No toca archivos de música: lo único que escribe es la caché de internet de la copia.
//
//   node scripts/run-ts.mjs scripts/generos.ts --base <copia.db> --salida <carpeta> [--claves <claves-desarrollo.json>] [--sin-buscar]
// En el archivo de claves: discogs_consumer_key + discogs_consumer_secret (o discogs_token_personal) y, opcional, lastfm_api_key.
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from '@paila/core/db'
import { cleanedRows } from '@paila/core/official-run'
import { GenreSearch } from '@paila/core/genres-run'
import { genreReport } from '@paila/core/genres-find'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--base'), outDir = arg('--salida')
if (!base || !outDir) { console.error('Uso: --base <copia.db> --salida <carpeta> [--claves <archivo>] [--sin-buscar]'); process.exit(2) }
if (/[\\/]PAILA[\\/]paila\.db$/i.test(base)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }
fs.mkdirSync(outDir, { recursive: true })
const log = (s: string) => { console.log(s); fs.appendFileSync(path.join(outDir, 'corrida.log'), `${new Date().toISOString()} ${s}\n`) }

// las claves se leen en el momento del archivo de desarrollo (nunca se escriben ni se muestran)
const c = arg('--claves') ? JSON.parse(fs.readFileSync(arg('--claves'), 'utf8')) as Record<string, string | undefined> : {}
const discogs = c.discogs_consumer_key && c.discogs_consumer_secret ? { key: c.discogs_consumer_key, secret: c.discogs_consumer_secret } : c.discogs_token_personal ? { token: c.discogs_token_personal } : null
const lastfm = c.lastfm_api_key ?? null

const db = openDb(base)
const t0 = Date.now()
const rows = cleanedRows(db)
log(`temas: ${rows.length} (armados en ${Math.round((Date.now() - t0) / 1000)} s) · Discogs: ${discogs ? 'sí' : 'no'} · Last.fm: ${lastfm ? 'sí' : 'no'}`)
const search = new GenreSearch(db, { ua: 'PAILA/corrida-supervisada (https://github.com/epitelio-ar/PAILA)', keys: () => ({ discogs, lastfm }) })
log(`falta preguntar: ${JSON.stringify(search.todo(rows))}`)

async function main() {
  if (!process.argv.includes('--sin-buscar')) {
    const r = await search.run(rows, (p) => { if (p.done % 50 === 0) log(`${p.done}/${p.total} ${p.current}`) }, () => false)
    log(`búsqueda: ${r.done} pedidos, ${r.found} con resultado ${JSON.stringify(r.bySource)}`)
  }
  for (const level of ['biblioteca', 'estilo', 'general'] as const) {
    const t = Date.now()
    const rep = genreReport(db, rows, level)
    const lines = rep.proposals.map((p) => `${p.conf.padEnd(5)} | ${p.genre.padEnd(22)} | ${(p.current ?? '—').padEnd(8)} | ${p.artist} — ${p.title} | ${p.sources.join('+')} | ${p.why}${p.others.length ? ` | otros: ${p.others.join(', ')}` : ''} | ${p.rel}`)
    fs.writeFileSync(path.join(outDir, `propuestas-${level}.txt`), lines.join('\n'))
    const by = new Map<string, number>()
    for (const p of rep.proposals) by.set(p.genre, (by.get(p.genre) ?? 0) + 1)
    log(`${level}: ${rep.proposals.length} propuestas (${rep.proposals.filter((p) => p.conf === 'alta').length} alta) de ${rep.empty} sin género · ${rep.handTouched} tocados a mano · ${rep.withGenre} ya tienen · en ${Date.now() - t} ms`)
    log(`${level}, géneros: ${[...by].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}`).join(', ')}`)
    if (level === 'biblioteca') fs.writeFileSync(path.join(outDir, 'escritura.txt'), rep.spelling.map((s) => `${s.from} → ${s.to} (${s.ids.length})`).join('\n'))
  }
  db.close()
}
main().catch((e) => { log(`error: ${(e as Error).stack}`); process.exit(1) })
