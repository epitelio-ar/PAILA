// Lo dudoso que trae internet en Ordenar, clasificado (docs/pruebas/mp5-internet-dudoso.md): sobre una COPIA de la base, sin
// buscar nada en internet (usa lo ya guardado) y sin escribir archivos, arma lo que Ordenar sumaría sin tildar (MusicBrainz y
// nombres oficiales; las tapas entran todas tildadas) y lo vuelca con de dónde viene, qué campo, si llena o pisa, por qué quedó
// dudoso y qué diría el criterio nuevo (core/revision-internet.ts, `criterioInternet`).
//
//   node scripts/run-ts.mjs scripts/internet-dudoso.ts --base <copia de paila.db> --salida <carpeta>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MusicBrainz } from '@paila/core/musicbrainz'
import { tidy } from '@paila/core/tidy'
import { rulesOf } from '@paila/shared/tidy-profiles'
import { reglasGuardadas } from '@paila/core/tidy-reglas'
import { criterioMb, oficialesDudosos, pareceRecopilacion } from '@paila/core/revision-internet'
import { openDb } from '@paila/core/db'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const base = arg('--base'), salida = arg('--salida')
if (!base || !salida || !fs.existsSync(base)) { console.error('Uso: --base <copia de paila.db> --salida <carpeta>'); process.exit(2) }
const real = path.resolve(process.env.APPDATA ?? os.homedir(), 'PAILA', 'paila.db').toLowerCase()
if (path.resolve(base).toLowerCase() === real) { console.error('Pasale una COPIA de la base, no la real.'); process.exit(2) }
fs.mkdirSync(salida, { recursive: true })

// se abre la copia con openDb: una base vieja se pone al día (solo la copia; la real no se abre)
const db = openDb(base)
const fila = db.prepare('SELECT rel_path AS rel, artist, title, album, year, track, duration FROM files WHERE id = ?')
type Fila = { rel: string; artist: string | null; title: string | null; album: string | null; year: string | null; track: string | null; duration: number | null }
const filas: string[][] = [['servicio', 'campo', 'tipo', 'motivo', 'antes del 13/11', 'criterio nuevo', 'tema', 'antes', 'despues', 'detalle']]

// MusicBrainz: lo que propone con lo guardado (solo llena lo vacío)
const mb = new MusicBrainz(db, 'PAILA (vista previa)')
const props = mb.proposals()
for (const p of props) for (const d of p.fills) {
  if (d.field === 'genre') continue // nunca se sumó solo
  const f = fila.get(p.fileId) as Fila
  const motivo = [p.confidence === 'media' ? 'media' : '', p.suspicious ? 'sospechoso' : '', pareceRecopilacion(p.album) ? 'recopilación por el nombre' : ''].filter(Boolean).join('+') || 'alta'
  const viejo = p.confidence === 'alta' && !p.suspicious ? 'tildar' : 'dudoso'
  filas.push(['MusicBrainz', d.field, 'llenar', motivo, viejo, criterioMb(p, d.field), f.rel, '', d.value, `score ${p.score} · disco MB "${p.album ?? ''}" · ${p.artist} - ${p.title}`])
}
// nombres oficiales dudosos (los que Arreglar nombres deja "para mirar a mano"), con las reglas guardadas y la oficial
const reglas = [...new Set([...reglasGuardadas((k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null), ...rulesOf('oficial')])]
const r = tidy(db, undefined, () => null, reglas)
const porRev = new Map(r.review.map((x) => [`${x.id}|${x.field}`, x]))
for (const d of oficialesDudosos(r.review)) {
  const x = porRev.get(`${d.id}|${d.field}`)!, f = fila.get(d.id) as Fila
  const antes = x.from ?? ''
  filas.push(['nombres oficiales', d.field, antes.trim() ? 'pisar' : 'llenar', 'confianza media', 'dudoso', 'dudoso', f.rel, antes, d.value ?? '', x.why])
}
fs.writeFileSync(path.join(salida, 'dudosos.tsv'), filas.map((l) => l.map((v) => String(v).replace(/[\t\n]/g, ' ')).join('\t')).join('\n'), 'utf8')

// resumen: por tipo y por lo que diría el criterio nuevo
const cuenta = new Map<string, number>()
for (const l of filas.slice(1)) { const k = `${l[0]} · ${l[1]} · ${l[2]} · ${l[3]}: ${l[4]} → ${l[5]}`; cuenta.set(k, (cuenta.get(k) ?? 0) + 1) }
const total = (col: number, v: string) => filas.slice(1).filter((l) => l[col] === v).length
const numeros = `antes del 13/11: ${total(4, 'tildar')} tildados, ${total(4, 'dudoso')} sin tildar · criterio nuevo: ${total(5, 'tildar')} tildados, ${total(5, 'dudoso')} sin tildar, ${total(5, 'descartar')} no se proponen`
const resumen = [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${String(n).padStart(4)}  ${k}`).join('\n')
fs.writeFileSync(path.join(salida, 'resumen.txt'), `${numeros}\n\n${resumen}\n`, 'utf8')
console.log(`${numeros}\n${resumen}`)
