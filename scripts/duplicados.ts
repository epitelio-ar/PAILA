// Corrida supervisada de Duplicados (MASTERPLAN-2, 0.1): corre la búsqueda sobre una COPIA de la base de PAILA y escribe
// cada grupo en un archivo para revisarlo uno por uno (falsos positivos, falsos negativos). No mueve ni escribe nada.
//
//   node scripts/run-ts.mjs scripts/duplicados.ts --base <copia de paila.db> --salida <grupos.md> [--sin-leer]
//
// --sin-leer: no lee los archivos de música (se saltea el hash de los idénticos por tamaño; el mismo audio exacto se
// sigue viendo por la huella del sonido guardada). Sirve mientras otra sesión mide velocidades.
import fs from 'node:fs'
import { Library } from '@paila/core/library'
import { findDuplicates } from '@paila/core/duplicates'
import type { DupGroup } from '@paila/shared/types'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--base'), out = arg('--salida')
if (!base || !out) { console.error('Uso: --base <copia de paila.db> --salida <grupos.md> [--sin-leer]'); process.exit(2) }
if (/\\PAILA\\paila\.db$|\/PAILA\/paila\.db$/i.test(base)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }

const min = (s: number | null) => (s == null ? '?' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
const line = (g: DupGroup) => g.items.map((i) => {
  const k = g.keep === i.id ? '**se queda**' : g.keep == null ? '·' : 'papelera'
  return `  - ${k} · ${i.grade ?? '–'} · ${i.ext.toUpperCase()}${i.kbps ? ` ${i.kbps}` : ''} · ${min(i.duration)} · \`${i.rel}\`${i.artist || i.title ? ` — ${i.artist ?? '¿?'} / ${i.title ?? '¿?'}` : ''}${i.playlists.length ? ` · listas: ${i.playlists.join(', ')}` : ''}`
}).join('\n')

const lib = new Library(base, null)
const t = performance.now()
const groups = await findDuplicates(lib.db, process.argv.includes('--sin-leer') ? () => null : (id) => lib.trackPath(id), (msg, done, total) => {
  if (done == null || done % 500 === 0) process.stdout.write(`\r${msg.slice(0, 60).padEnd(60)} ${done ?? ''}${total ? `/${total}` : ''}`)
})
const secs = (performance.now() - t) / 1000
lib.close()
const by = (l: DupGroup['level']) => groups.filter((g) => g.level === l)
const md = [
  `# Duplicados — corrida sobre ${base}`,
  '',
  `${groups.length} grupos en ${secs.toFixed(1)} s: ${by('exact').length} idénticos, ${by('quality').length} mismo audio en otra calidad, ${by('probable').length} probables por nombre, ${by('version').length} de versiones.`,
  `Se proponen para la papelera ${groups.filter((g) => g.keep != null).reduce((s, g) => s + g.items.length - 1, 0)} archivos.`,
  '',
  ...(['exact', 'quality', 'probable', 'version'] as const).flatMap((l) => [
    `## ${by(l)[0]?.label ?? l} (${by(l).length})`, '',
    ...by(l).map((g, i) => `${i + 1}. ${g.why}${g.similarity != null ? ` (parecido ${Math.round(g.similarity * 100)} %)` : ''}${g.warning ? ` — ⚠ ${g.warning}` : ''}\n${line(g)}`), '',
  ]),
].join('\n')
fs.writeFileSync(out, md)
console.log(`\n${groups.length} grupos en ${secs.toFixed(1)} s → ${out}`)
