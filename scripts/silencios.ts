// Corrida supervisada de los silencios largos (masterplan 3, punto 3): mide el silencio del principio y del final de cada tema de
// una COPIA de la base con la pasada liviana de la app (core/analysis/silence.ts; los archivos solo se leen) y escribe la tabla
// para revisarla: los que se avisarían, los que quedan cerca del umbral y el nivel de los primeros y últimos segundos.
// Uso: node scripts/run-ts.mjs scripts/silencios.ts <copia.db> <carpeta-salida> [--hilos 4] [--limite N] [--escribir]
//   --escribir  guarda lo medido en esa COPIA de la base (para ver la app con los silencios sin esperar la pasada)
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { analyzeSilence, silenceFlags, LONG_END_S, LONG_START_S, type SilenceResult } from '@paila/core/analysis/silence'
import { openDb, transaction } from '@paila/core/db'
import { saveSilence, withSilenceFlags } from '@paila/core/silencepass'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const args = process.argv.slice(2)
const [dbFile, outDir] = args
if (!dbFile || !outDir) { console.error('Uso: silencios.ts <copia.db> <carpeta-salida> [--hilos 4] [--limite N]'); process.exit(2) }
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i > 0 ? Number(args[i + 1]) : 0 }
const threads = opt('hilos') || 4
const limit = opt('limite') || Infinity
const write = args.includes('--escribir')
if (write && /[\\/]PAILA[\\/]paila\.db$/i.test(dbFile)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }
fs.mkdirSync(outDir, { recursive: true })

interface Row { id: number; rel: string; root: string; kind: string; ext: string; duration: number | null; artist: string | null; title: string | null }
const db = new DatabaseSync(dbFile, { readOnly: true })
const rows = (db.prepare(
  `SELECT f.id, f.rel_path AS rel, v.last_mount || r.rel_path AS root, f.kind, f.ext, f.duration, f.artist, f.title
   FROM files f JOIN analysis a ON a.file_id = f.id JOIN roots r ON r.id = f.root_id JOIN volumes v ON v.id = r.volume_id
   WHERE f.kind != 'produccion' AND f.error IS NULL AND a.error IS NULL AND a.grade IS NOT NULL
     AND f.trashed_at IS NULL AND f.missing_at IS NULL AND f.excluded_at IS NULL ORDER BY f.kind = 'musica' DESC, f.id`,
).all() as unknown as Row[]).slice(0, limit)

const results: { r: Row; s: SilenceResult | null; error?: string; ms: number }[] = []
let next = 0
const t0 = Date.now()
async function worker() {
  while (next < rows.length) {
    const r = rows[next++]
    const file = path.join(r.root, r.rel)
    const t = Date.now()
    try { results.push({ r, s: await analyzeSilence({ ffmpeg, file, duration: r.duration }), ms: Date.now() - t }) }
    catch (e) { results.push({ r, s: null, error: (e as Error).message, ms: Date.now() - t }) }
    if (results.length % 200 === 0) console.log(`${results.length}/${rows.length} · ${Math.round((Date.now() - t0) / 1000)} s`)
  }
}
await Promise.all(Array.from({ length: threads }, worker))
results.sort((a, b) => a.r.id - b.r.id)

const tsv = ['id\ttipo\tinicio_s\tfinal_s\tmarcas\tduracion\tms\tarchivo']
for (const { r, s, error, ms } of results) {
  tsv.push([r.id, r.kind, s?.start ?? '', s ? (s.silent ? 'todo' : s.end) : '', s ? silenceFlags(s).join(',') : `error: ${error}`, Math.round(r.duration ?? 0), ms, r.rel].join('\t'))
}
fs.writeFileSync(path.join(outDir, 'silencios.tsv'), tsv.join('\n'))

if (write) {
  db.close()
  const w = openDb(dbFile) // con las migraciones: suma las columnas de los silencios
  const flagsOf = w.prepare('SELECT flags FROM analysis WHERE file_id = ?')
  const upd = w.prepare('UPDATE analysis SET flags = ? WHERE file_id = ?')
  transaction(w, () => {
    for (const { r, s } of results) {
      if (!s) continue
      saveSilence(w, r.id, s)
      upd.run(withSilenceFlags((flagsOf.get(r.id) as { flags: string | null }).flags, s), r.id)
    }
  })
  w.close()
  console.log(`Escrito en la copia: ${results.filter((x) => x.s).length} temas`)
}

// resumen: cuántos pasan cada umbral, y los cercanos para mirar a oído
const ok = results.filter((x) => x.s && !x.s.silent)
const count = (f: (s: SilenceResult) => boolean) => ok.filter((x) => f(x.s!)).length
const lines = [
  `Temas medidos: ${results.length} (errores: ${results.filter((x) => !x.s).length}, todo en silencio: ${results.filter((x) => x.s?.silent).length})`,
  `Tiempo: ${Math.round((Date.now() - t0) / 1000)} s con ${threads} hilos (${Math.round(results.reduce((a, x) => a + x.ms, 0) / Math.max(1, results.length))} ms por tema)`,
  '', 'Silencio al principio:',
  ...[0.5, 1, 1.5, 2, 3, 5, 10].map((t) => `  ≥ ${t} s: ${count((s) => s.start >= t)}`),
  '', 'Silencio al final:',
  ...[1, 2, 3, 4, 5, 8, 10, 30].map((t) => `  ≥ ${t} s: ${count((s) => s.end >= t)}`),
  '', `Se avisarían (≥ ${LONG_START_S} s al principio o ≥ ${LONG_END_S} s al final): ${ok.filter((x) => silenceFlags(x.s!).length).length}`,
]
const show = (x: (typeof results)[number]) => `  ${x.s!.start.toFixed(1).padStart(5)} | ${x.s!.end.toFixed(1).padStart(5)} | ${x.r.kind.padEnd(8)} | ${x.r.rel}`
lines.push('', 'Avisados (inicio | final):', ...ok.filter((x) => silenceFlags(x.s!).length).map(show))
lines.push('', 'Cerca del umbral (1–2 s al principio o 3–5 s al final), no avisados:', ...ok.filter((x) => !silenceFlags(x.s!).length && ((x.s!.start >= 1 && x.s!.start < LONG_START_S) || (x.s!.end >= 3 && x.s!.end < LONG_END_S))).map(show))
lines.push('', 'Todo en silencio o con error:', ...results.filter((x) => !x.s || x.s.silent).map((x) => `  ${x.error ?? 'silencio'} | ${x.r.rel}`))
fs.writeFileSync(path.join(outDir, 'resumen.txt'), lines.join('\n'))
console.log(lines.slice(0, 22).join('\n'))
