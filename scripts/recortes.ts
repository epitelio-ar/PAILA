// Corrida supervisada de recortar silencios (masterplan 4, 4A.3): arma la propuesta de core/trim.ts sobre una COPIA de la base
// (los archivos solo se leen) y escribe una tabla para revisarla caso por caso: cuánto se corta de cada lado, el nivel justo antes
// y después de cada corte (que no muerda un fade), si hay un silencio largo en el medio (un tema oculto) y los que no se tocan.
// Uso: node scripts/run-ts.mjs scripts/recortes.ts <copia.db> <salida.md> [--limite N]   (la propuesta queda también en <salida.md>.json)
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { Library } from '@paila/core/library'
import { planTrims } from '@paila/core/trim'
import { BLOCK_SECONDS, readLevels } from '@paila/core/analysis/silence'
import { VERIFICANDO, leerAvisos, quienSoy, tomarAviso } from './turnos.mjs'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const [base, out] = process.argv.slice(2)
if (!base || !out) { console.error('Uso: recortes.ts <copia.db> <salida.md> [--limite N]'); process.exit(2) }
if (/[\\/]PAILA[\\/]paila\.db$/i.test(base)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }
const lim = process.argv.indexOf('--limite')
const limit = lim > 0 ? Number(process.argv[lim + 1]) : Infinity

// lee enteros los temas con aviso: es trabajo pesado, de a uno (toma el turno de "Verificación" y espera al laboratorio)
const soltar = await tomarAviso(VERIFICANDO, 'verificar', JSON.stringify({ pid: process.pid, quien: quienSoy(), que: 'corrida supervisada de recortar silencios', desde: new Date().toISOString() }), { esperar: 3 * 3600_000 })
if (!soltar) { console.error('No hubo turno en 3 horas'); process.exit(1) }
while (leerAvisos().activos.some((a) => a.tipo === 'laboratorio')) await new Promise((r) => setTimeout(r, 15_000))
const lib = new Library(base, null)
const pathOf = (id: number) => lib.trackPath(id)
const t0 = Date.now()
const ids = (lib.db.prepare('SELECT file_id AS id FROM silence WHERE silence_start >= 2 OR silence_end >= 5').all() as { id: number }[]).map((r) => r.id).slice(0, limit)
const plan = await planTrims(lib.db, pathOf, ffmpeg, { ids, onProgress: (d, t) => process.stdout.write(`\r${d}/${t}`) })
const secs = (Date.now() - t0) / 1000
fs.writeFileSync(`${out}.json`, JSON.stringify(plan))
const dB = (e: number) => (e > 0 ? Math.round(10 * Math.log10(e)) : -200)
const s = (x: number) => (Math.round(x * 10) / 10).toFixed(1)
const mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`

const lines: string[] = []
let middle = 0
for (const p of plan.items) {
  const levels = await readLevels({ ffmpeg, file: pathOf(p.fileId)!, duration: null }, Infinity, false)
  const at = (t: number) => Math.max(0, Math.min(levels.length - 1, Math.floor(t / BLOCK_SECONDS)))
  /** El nivel más alto (dB) entre dos tiempos. */
  const peak = (a: number, b: number) => dB(Math.max(0, ...levels.slice(at(a), Math.max(at(a) + 1, at(b)))))
  // el silencio más largo (debajo de −80 dB) que no está en los bordes: un tema escondido después de un hueco
  let run = 0, longest = 0
  for (let i = at(p.silenceStart); i < at(p.duration - p.silenceEnd); i++) { if (levels[i] < 1e-8) { run++; longest = Math.max(longest, run) } else run = 0 }
  const hole = longest * BLOCK_SECONDS
  if (hole >= 10) middle++
  lines.push(`| ${p.rel.split('/').slice(-2).join('/')} | ${mmss(p.duration)} | ${p.cutStart ? `${s(p.from)} s (corte: ${peak(0, p.from)} dB; suena: ${peak(p.from, p.from + 1)} dB)` : '—'} | ${p.cutEnd ? `${s(p.duration - p.to)} s (antes del corte: ${peak(p.to - 2, p.to)} dB; corte: ${peak(p.to, p.duration)} dB)` : '—'} | ${hole >= 10 ? `**${s(hole)} s**` : ''} | ${p.note ?? ''} |`)
}
lib.close()
soltar()

const why = new Map<string, string[]>()
for (const k of plan.skipped) why.set(k.why, [...(why.get(k.why) ?? []), k.rel])
fs.writeFileSync(out, [
  `# Recortar silencios — corrida sobre ${base}`, '',
  `${plan.items.length} para recortar y ${plan.skipped.length} que no se tocan, en ${Math.round(secs)} s. Con un silencio de 10 s o más en el medio: ${middle}.`, '',
  '| Tema | Dura | Al empezar | Al terminar | Hueco en el medio | Nota |', '|---|---|---|---|---|---|', ...lines, '',
  '## No se tocan', '', ...[...why].flatMap(([w, rels]) => [`### ${w} (${rels.length})`, '', ...rels.map((r) => `- \`${r}\``), '']),
].join('\n'))
console.log(`\n${plan.items.length} para recortar, ${plan.skipped.length} no se tocan → ${out}`)
