// Arma un pendrive de CDJ de prueba (PIONEER con export.pdb y análisis con grilla y cues) con temas de una COPIA de la base:
// solo usa sus nombres y tamaños, no copia música. Sirve para probar "Traer tus playlists" y para capturas sin un pendrive de
// verdad. Usa el armador de los tests (tests/fixtures/pendrive.ts); PAILA no arma pendrives.
//
//   node scripts/run-ts.mjs scripts/pendrive-de-prueba.ts --base <copia de paila.db> --salida <carpeta vacía>
//
// Los últimos 4 temas van con otro tamaño (para que se busquen por nombre) y el último con un título que no está.
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { buildAnlz, buildPdb, type FxTrack } from '../tests/fixtures/pendrive'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : '' }
const base = arg('--base'), out = arg('--salida')
if (!base || !out) { console.error('Uso: --base <copia de paila.db> --salida <carpeta vacía>'); process.exit(2) }
if (fs.existsSync(out) && fs.readdirSync(out).length) { console.error('La carpeta de salida tiene que estar vacía.'); process.exit(2) }

const db = new DatabaseSync(base, { readOnly: true })
const rows = db.prepare(`SELECT f.rel_path AS rel, f.size, f.artist, f.title, f.duration, a.bpm FROM files f JOIN analysis a ON a.file_id = f.id
  WHERE f.kind = 'musica' AND f.artist IS NOT NULL AND f.title IS NOT NULL AND a.bpm IS NOT NULL ORDER BY f.id LIMIT 60`).all() as { rel: string; size: number; artist: string; title: string; duration: number; bpm: number }[]
db.close()
const artists = [...new Set(rows.map((r) => r.artist))].map((name, i) => ({ id: i + 1, name }))
const aid = new Map(artists.map((a) => [a.name, a.id]))
fs.mkdirSync(path.join(out, 'PIONEER', 'rekordbox'), { recursive: true })
const tracks: FxTrack[] = rows.map((r, i) => {
  const id = i + 1, folder = String(id).padStart(8, '0')
  const dir = path.join(out, 'PIONEER', 'USBANLZ', 'P000', folder)
  fs.mkdirSync(dir, { recursive: true })
  const beat = 60000 / r.bpm
  fs.writeFileSync(path.join(dir, 'ANLZ0000.DAT'), buildAnlz({ beats: Array.from({ length: 16 }, (_, k) => [(k % 4) + 1, r.bpm, Math.round(120 + k * beat)] as [number, number, number]), cues: [{ hot: 0, ms: 120 }] }))
  if (i % 2 === 0) fs.writeFileSync(path.join(dir, 'ANLZ0000.EXT'), buildAnlz({ ext: true, cues: [{ hot: 1, ms: 120, name: 'Entra', rgb: [40, 226, 20] }, { hot: 2, ms: 30120, name: 'Drop', rgb: [230, 40, 40] }] }))
  const odd = i >= rows.length - 4
  return {
    id, title: i === rows.length - 1 ? 'Un tema que no tenés' : r.title, artistId: aid.get(r.artist)!, path: `/Contents/${r.artist}/${path.posix.basename(r.rel)}`,
    analyze: `/PIONEER/USBANLZ/P000/${folder}/ANLZ0000.DAT`, size: odd ? r.size + 1 : r.size, seconds: Math.round(r.duration), bpm: r.bpm, rating: i % 5, color: i % 9,
  }
})
fs.writeFileSync(path.join(out, 'PIONEER', 'rekordbox', 'export.pdb'), buildPdb({
  tracks, artists, lists: [
    { id: 1, parent: 0, name: 'Fechas', folder: true, sort: 0 },
    { id: 2, parent: 1, name: 'Sábado en Casa Fiesta', sort: 0, tracks: tracks.slice(0, 25).map((t) => t.id) },
    { id: 3, parent: 1, name: 'Previa', sort: 1, tracks: tracks.slice(20, 45).map((t) => t.id) },
    { id: 4, parent: 0, name: 'Cierres', sort: 1, tracks: tracks.slice(40).map((t) => t.id) },
  ],
}))
console.log(`Pendrive de prueba con ${tracks.length} temas en ${out}`)
