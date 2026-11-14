// Ensayo general del punto 1 (scripts/ensayo.ts): "Buscar nombres oficiales" sobre la copia de la base, como el botón de la
// pantalla de nombres (MusicBrainz, Deezer, Discogs y AcoustID; AudD apagado), para que el perfil Oficial tenga con qué proponer.
// Solo pregunta a internet y guarda las respuestas en la copia de la base: no toca archivos. Mide cuánto tarda.
//   node scripts/run-ts.mjs scripts/ensayo-oficial.ts --datos <carpeta> --claves <claves-desarrollo.json>
import fs from 'node:fs'
import { OfficialSearch, cleanedRows } from '@paila/core/official-run'
import { rulesOf } from '@paila/shared/tidy-profiles'
import { arg, log } from './corte-base'
import { abrir, tiempo } from './ensayo-base'

const claves = JSON.parse(fs.readFileSync(arg('--claves'), 'utf8')) as { discogs_consumer_key?: string; discogs_consumer_secret?: string; acoustid_app_key?: string }
const keys = () => ({
  acoustid: claves.acoustid_app_key ?? null,
  discogs: claves.discogs_consumer_key && claves.discogs_consumer_secret ? { key: claves.discogs_consumer_key, secret: claves.discogs_consumer_secret } : null,
})
const a = abrir()
try {
  const s = new OfficialSearch(a.lib.db, { ua: 'PAILA/ensayo-punto-1 (https://github.com/epitelio-ar/PAILA)', keys, useDeezer: () => true })
  const rows = cleanedRows(a.lib.db, rulesOf('oficial'))
  log(`Falta preguntar: ${JSON.stringify(s.todo(rows))}`)
  const t0 = Date.now()
  let last = 0
  const r = await s.run(rows, (p) => { if (Date.now() - last > 60_000) { last = Date.now(); log(`  ${p.done}/${p.total} · encontrados ${p.found} · ${JSON.stringify(p.bySource)}`) } }, () => false)
  tiempo('nombres oficiales: buscar en internet', Date.now() - t0, { resultado: r })
  log(`Después: ${JSON.stringify(s.todo(rows))}`)
} finally { a.lib.close() }
