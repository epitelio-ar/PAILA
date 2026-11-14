// Prueba con Engine DJ de verdad (MASTERPLAN-4, 4B.5): copia la base de una biblioteca de prueba, le suma una carpeta de
// golpes cada medio segundo desde el segundo 1 (los mismos en WAV y en MP3, para medir en qué tiempo lee Engine los MP3) y
// exporta a la biblioteca de Engine DJ de esta compu (Música\Engine Library), con Engine cerrado. La música no se toca.
//
//   node scripts/run-ts.mjs scripts/engine-dj-prueba.ts exportar <carpeta de trabajo> [base.db de la biblioteca de prueba]
//   node scripts/run-ts.mjs scripts/engine-dj-prueba.ts medir     → dónde puso Engine la grilla de los golpes al analizarlos
//
// Los golpes: "golpes.wav" y "golpes.mp3" van sin grilla de PAILA (los analiza Engine); "golpes-con-grilla.mp3", con la grilla
// de PAILA justo en los golpes (se mira en Engine que las líneas caigan sobre ellos).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Rekordbox } from '@paila/core/rekordbox'
import { DjExport, engineDb } from '@paila/core/djexport'
import { unpack } from '@paila/core/enginedj'

// PAILA_ENGINE_HOME: otra biblioteca de Engine (una copia, para comparar lo escrito por PAILA con lo que después cambia Engine)
const engineHome = process.env.PAILA_ENGINE_HOME ?? path.join(os.homedir(), 'Music', 'Engine Library')
const [cmd, dirArg, baseArg] = process.argv.slice(2)
const SR = 44100
const FIRST = 1.0 // el primer golpe, en segundos
const BEAT = 0.5 // 120 BPM

if (cmd === 'exportar') await exportar(path.resolve(dirArg ?? 'D:/PAILA-trabajo/engine-dj/datos'), baseArg ?? 'D:/PAILA-trabajo/prueba-dj/paila.db')
else if (cmd === 'medir') medir()
else { console.error('Uso: exportar <carpeta> [base.db] | medir'); process.exit(2) }

async function exportar(dir: string, base: string) {
  if (/^f:[\\/]+música/i.test(dir)) throw new Error('La carpeta de trabajo no puede estar dentro de D:\\Música')
  fs.mkdirSync(dir, { recursive: true })
  for (const f of ['', '-wal', '-shm']) { fs.rmSync(path.join(dir, `paila.db${f}`), { force: true }); if (fs.existsSync(base + f)) fs.copyFileSync(base + f, path.join(dir, `paila.db${f}`)) }
  // los golpes: un bombo grave con un clic arriba, cada medio segundo desde el segundo 1, 40 segundos
  const golpes = path.join(dir, 'golpes')
  fs.mkdirSync(golpes, { recursive: true })
  const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
  const expr = `if(gte(t,${FIRST}),0.6*sin(2*PI*60*t)*exp(-30*mod(t-${FIRST},${BEAT}))+0.3*sin(2*PI*2000*t)*exp(-400*mod(t-${FIRST},${BEAT})),0)`
  const make = (name: string, extra: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}':s=${SR}:d=40`, ...extra, '-metadata', `title=${name}`, '-metadata', 'artist=PAILA prueba', path.join(golpes, name)])
  make('golpes.wav', [])
  make('golpes.mp3', ['-c:a', 'libmp3lame', '-b:a', '320k'])
  make('golpes-con-grilla.mp3', ['-c:a', 'libmp3lame', '-b:a', '320k'])

  const lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  if (!lib.roots().some((r) => path.resolve(r.path) === path.resolve(golpes))) await lib.addRoot(golpes, [{ rel: '', kind: 'musica' }])
  await lib.scan()
  const pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  const rb = new Rekordbox(lib.db, (i) => lib.trackPath(i), pl)
  const idOf = (n: string) => lib.tracks().find((r) => String(r[2]).endsWith(n))![0] as number
  rb.dj.saveGrid(idOf('golpes-con-grilla.mp3'), 'beatthis', { grid: { bpm: 60 / BEAT, segments: [{ start: FIRST, bpm: 60 / BEAT, beat: 1 }], errorMs: 1, variable: false }, barEnergy: [] }, null)
  if (!pl.tree().some((n) => n.name === 'Golpes')) pl.addTracks(pl.create('Golpes', 'list'), ['golpes.wav', 'golpes.mp3', 'golpes-con-grilla.mp3'].map(idOf))

  const dj = new DjExport(rb, os.homedir(), path.join(dir, 'vdj'), '', engineHome)
  const r = await dj.engine({ scope: 'todo', playlistIds: [], grid: true, suggestedCues: false, pailaWhenMoving: false })
  console.log(`Engine DJ: ${r.tracks} temas, ${r.playlists} playlists, ${r.grids} con grilla, ${r.cues} con cues, ${r.kept} ya eran tuyos, ${r.simplified} con un solo BPM`)
  console.log(`  escrito: ${r.written.join(', ')}`)
  console.log(`  respaldo: ${r.backups.join(', ')}`)
  for (const s of r.skipped) console.log(`  afuera: ${s.rel} (${s.reason})`)
  lib.close()
}

/** La fase de la grilla que analizó Engine, contra los golpes (en milisegundos: 0 = justo; positivo = Engine la ve más tarde). */
function medir() {
  const db = new DatabaseSync(engineDb(engineHome), { readOnly: true })
  const rows = db.prepare("SELECT t.filename AS f, t.isAnalyzed AS a, t.bpmAnalyzed AS bpm, p.beatData AS b FROM Track t LEFT JOIN PerformanceData p ON p.trackId = t.id WHERE t.filename LIKE 'golpes%'").all() as { f: string; a: number; bpm: number | null; b: Uint8Array | null }[]
  for (const r of rows) {
    const b = unpack(r.b)
    if (b.length < 25) { console.log(`${r.f}: sin grilla todavía (analizado: ${r.a})`); continue }
    const sr = b.readDoubleBE(0)
    const n = Number(b.readBigInt64BE(17))
    const m = Array.from({ length: n }, (_, i) => ({ sample: b.readDoubleLE(25 + i * 24), index: Number(b.readBigInt64LE(33 + i * 24)) }))
    if (m.length < 2) { console.log(`${r.f}: grilla con ${m.length} marcador`); continue }
    const spb = (m[1].sample - m[0].sample) / (m[1].index - m[0].index)
    const at = (FIRST * sr - m[0].sample) / spb // en qué tiempo de la grilla cae el primer golpe
    const off = -(at - Math.round(at)) * spb / sr * 1000
    console.log(`${r.f}: ${(60 * sr / spb).toFixed(3)} BPM, marcadores ${JSON.stringify(m.map((x) => [x.index, +(x.sample / sr).toFixed(5)]))}, la grilla cae ${off.toFixed(1)} ms ${off >= 0 ? 'después' : 'antes'} del golpe`)
  }
  db.close()
}
