// Arma una carpeta de datos de prueba (temas sintéticos, nunca la Música de verdad) para mirar las pantallas del respaldo
// liviano (capturas en docs/pruebas/respaldo-liviano-2026-10-24): una tanda con su respaldo, otra cuyo respaldo está en la
// papelera, un respaldo de copias completas de hace 40 días ("Borrar respaldos viejos", la tarjeta Para hacer) y dos temas en la
// papelera. Después: npm run build y npm run captura -- "Papelera" --datos <carpeta>.
//   node scripts/run-ts.mjs scripts/respaldo-pantallas.ts <carpeta>
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { Playlists } from '@paila/core/playlists'
import { Trash } from '@paila/core/trash'
import { listBackups, trashBackups } from '@paila/core/ops/backup'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const out = path.resolve(process.argv[2])
fs.rmSync(out, { recursive: true, force: true })
const M = path.join(out, 'Música')
const discos: [string, string, string[]][] = [
  ['Fulano', 'Disco del sol', ['Amanecer', 'Mediodía', 'Siesta', 'Atardecer', 'Noche', 'Madrugada']],
  ['Mengana', 'Otro disco', ['Uno', 'Dos', 'Tres', 'Cuatro']],
]
for (const [artista, disco, temas] of discos) {
  for (const [i, t] of temas.entries()) {
    const f = path.join(M, `${artista} - ${disco}`, `0${i + 1} ${t}.mp3`)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 40}:duration=40`, '-c:a', 'libmp3lame', '-b:a', '192k',
      '-metadata', `title=${t}`, '-metadata', `artist=${artista}`, '-metadata', `album=${disco}`, '-metadata', 'genre=Rock', '-metadata', `track=${i + 1}`, f])
  }
}
fs.mkdirSync(out, { recursive: true })
const lib = new Library(path.join(out, 'paila.db'), findFfprobe())
await lib.addRoot(M, [{ rel: '', kind: 'musica' }])
await lib.scan()
const id = (rel: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path LIKE ?').get(`%${rel}`) as { id: number }).id
const ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(out, 'resguardo'))
const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
// un respaldo de la 0.5.3 (copias enteras de dos temas), de hace 40 días
const old = path.join(M, '_PAILA', 'respaldos', 'tags-20260914-213000', 'Mengana - Otro disco')
fs.mkdirSync(old, { recursive: true })
let bytes = 0
for (const n of ['01 Uno.mp3', '02 Dos.mp3']) { fs.copyFileSync(path.join(M, 'Mengana - Otro disco', n), path.join(old, n)); bytes += fs.statSync(path.join(old, n)).size }
lib.db.prepare("INSERT INTO backups (op, ref, root_id, dir, files, bytes, created_at, complete) VALUES ('tags', NULL, ?, ?, 2, ?, '2026-09-14T21:30:00.000Z', 1)")
  .run(lib.roots()[0].id, path.dirname(old), bytes)
// tanda 1: el género de un disco (respaldo liviano, queda en su lugar)
ch.stage(discos[0][2].map((t, i) => id(`0${i + 1} ${t}.mp3`)), 'genre', 'Folklore')
const r1 = await ch.apply()
// tanda 2: dos títulos; su respaldo, a la papelera (como "Todo bien" desde el Historial)
ch.stage([id('03 Tres.mp3')], 'title', 'Tres (en vivo)')
ch.stage([id('04 Cuatro.mp3')], 'title', 'Cuatro (versión larga)')
const r2 = await ch.apply()
const roots = lib.roots().map((r) => ({ id: r.id, path: r.path }))
trashBackups(lib.db, listBackups(lib.db).filter((b) => b.ref === r2.batchId).map((b) => b.id), roots)
// dos temas a la papelera
await new Trash(lib.db, rootPath, new Playlists(lib.db, (i) => lib.trackPath(i))).trash([id('05 Noche.mp3'), id('06 Madrugada.mp3')], 'Duplicados')
console.log('tandas', r1.batchId, r2.batchId, 'respaldos', JSON.stringify(listBackups(lib.db).map((b) => [b.op, b.files, b.bytes, b.light])))
lib.close()
console.log('listo', out)
