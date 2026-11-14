// Medición del año original de MusicBrainz (docs/pruebas/mp5-internet-dudoso.md; pedido del autor, 13/11): sobre una COPIA de la
// base, vuelve a preguntarle a MusicBrainz (un pedido por segundo) por dos grupos de temas y vuelca lo que contesta, SIN guardar
// nada en la base ni tocar archivos: (a) los que no tienen año y antes recibían el de una recopilación; (b) unos de referencia que ya
// tienen disco y año en el tag, para comparar el año original y el disco de confianza media contra lo que ya está. Mide cuánto tarda.
//
//   node scripts/run-ts.mjs scripts/mb-anio-original.ts --base <copia de paila.db> --salida <carpeta> [--referencia 200] [--solo referencia]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDb, visible } from '@paila/core/db'
import { MusicBrainz, type MbResult } from '@paila/core/musicbrainz'
import { realAlbum } from '@paila/core/albums'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const base = arg('--base'), salida = arg('--salida'), cuantos = Number(arg('--referencia') ?? 200), solo = arg('--solo') // 'sin año' | 'referencia'
if (!base || !salida || !fs.existsSync(base)) { console.error('Uso: --base <copia de paila.db> --salida <carpeta>'); process.exit(2) }
const real = path.resolve(process.env.APPDATA ?? os.homedir(), 'PAILA', 'paila.db').toLowerCase()
if (path.resolve(base).toLowerCase() === real) { console.error('Pasale una COPIA de la base, no la real.'); process.exit(2) }
fs.mkdirSync(salida, { recursive: true })

const db = openDb(base) // la copia se pone al día si es vieja; no se escribe nada más
const mb = new MusicBrainz(db, 'PAILA/medicion (https://github.com/epitelio-ar/PAILA)')
type Tema = { id: number; artist: string; title: string; duration: number | null; album: string | null; year: string | null }
// (a) sin año, con una respuesta guardada de un disco sospechoso
const sinAnio = (db.prepare(`SELECT f.id, f.artist, f.title, f.duration, f.album, f.year, m.result FROM mb_lookup m JOIN files f ON f.id = m.file_id
  WHERE m.status = 'ok' AND COALESCE(f.year, '') = '' AND ${visible('f')}`).all() as (Tema & { result: string })[]).filter((t) => (JSON.parse(t.result) as MbResult).suspicious)
// (b) de referencia: con disco de verdad y año en el tag, repartidos (cada tantos, no los primeros)
const conTodo = (db.prepare(`SELECT id, artist, title, duration, album, year FROM files WHERE ${visible()} AND error IS NULL AND kind = 'musica'
  AND COALESCE(artist, '') != '' AND COALESCE(title, '') != '' AND year GLOB '[12][0-9][0-9][0-9]*' ORDER BY rel_path`).all() as Tema[]).filter((t) => realAlbum(t.album))
const paso = Math.max(1, Math.floor(conTodo.length / cuantos))
const referencia = conTodo.filter((_, i) => i % paso === 0).slice(0, cuantos)

const filas = [['grupo', 'artista', 'titulo', 'tag disco', 'tag año', 'mb confianza', 'mb sospechoso', 'mb disco', 'mb año del disco', 'mb año original', 'segundos'].join('\t')]
const t0 = Date.now()
let hechos = 0
for (const [grupo, lista] of [['sin año', sinAnio], ['referencia', referencia]] as const) {
  if (solo && solo !== grupo) continue
  for (const t of lista) {
    const a = Date.now()
    let r: MbResult | null = null
    try { r = await mb.lookup(t.artist, t.title, t.duration) } catch (e) { console.error(`${t.artist} - ${t.title}: ${(e as Error).message}`) }
    filas.push([grupo, t.artist, t.title, t.album ?? '', t.year ?? '', r?.confidence ?? 'sin resultado', r ? String(r.suspicious) : '', r?.album ?? '', r?.year ?? '', r?.anioOriginal ?? '', ((Date.now() - a) / 1000).toFixed(1)].map((v) => String(v).replace(/[\t\n]/g, ' ')).join('\t'))
    if (++hechos % 25 === 0) { console.log(`${hechos} de ${sinAnio.length + referencia.length} (${Math.round((Date.now() - t0) / 1000)} s)`); fs.writeFileSync(path.join(salida, 'anio-original.tsv'), filas.join('\n'), 'utf8') }
  }
}
fs.writeFileSync(path.join(salida, 'anio-original.tsv'), filas.join('\n'), 'utf8')
console.log(`Listo: ${hechos} temas en ${Math.round((Date.now() - t0) / 1000)} s (${sinAnio.length} sin año, ${referencia.length} de referencia)`)
db.close()
