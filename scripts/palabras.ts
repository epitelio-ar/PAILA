// Corrida supervisada de "Palabras que sobran, aprendidas de la biblioteca" (MASTERPLAN-2, 0.1 y 4.5): sobre una COPIA de
// la base (con lo buscado en internet), escribe cada palabra que aprende con sus números y ejemplos, las que casi entran y
// por qué no, y cada cambio que propondría el asistente con esa regla. No escribe nada en la Música.
//
//   node scripts/run-ts.mjs scripts/palabras.ts --base <copia de paila.db> --salida <revision.md>
import fs from 'node:fs'
import { openDb } from '@paila/core/db'
import { JunkWords } from '@paila/core/junkwords'
import { tidy } from '@paila/core/tidy'
import { rulesOf } from '@paila/shared/tidy-profiles'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--base'), out = arg('--salida')
if (!base || !out) { console.error('Uso: --base <copia de paila.db> --salida <revision.md>'); process.exit(2) }
if (/\\PAILA\\paila\.db$|\/PAILA\/paila\.db$/i.test(base)) { console.error('Esa parece la base real: usá una copia.'); process.exit(2) }

const db = openDb(base)
const t0 = performance.now()
const r = new JunkWords(db).report()
const secs = (performance.now() - t0) / 1000
const prolijo = rulesOf('prolijo')
const sin = tidy(db, ['mojibake', 'filename', 'junk', 'style', 'filenames'], undefined, prolijo.filter((x) => x !== 'aprendidas')).changes
const con = tidy(db, ['mojibake', 'filename', 'junk', 'style', 'filenames'], undefined, prolijo).changes
const key = (c: { id: number; field: string; to: string }) => `${c.id}|${c.field}|${c.to}`
const before = new Set(sin.map(key))
const extra = con.filter((c) => !before.has(key(c)) || c.rules?.includes('aprendidas'))
const md = [
  `# Palabras aprendidas — corrida sobre ${base}`, '',
  `${r.identified} temas identificados con seguridad (huella acústica y duración). ${r.words.length} palabras aprendidas en ${secs.toFixed(1)} s.`, '',
  '## Lo que aprende', '',
  ...r.words.flatMap((w) => [
    `- **${w.shown}** (${w.where}) · sobra en ${w.tracks} temas de ${w.artists} artistas y ${w.folders} carpetas · ${Math.round(w.ratio * 100)} % · se sacaría en ${w.applies} temas`,
    ...w.examples.map((e) => `  - \`${e.from}\` → \`${e.to}\``),
  ]),
  '', '## Las que casi entran (y por qué no)', '',
  ...r.rejected.map((x) => `- ${x.shown}: ${x.why}`),
  '', `## Cambios que agrega la regla en el asistente (${extra.length})`, '',
  ...extra.map((c) => `- ${c.field} · \`${c.from ?? ''}\` → \`${c.to}\`${c.note ? ` — ${c.note}` : ''} · \`${c.rel}\``),
  '',
]
fs.writeFileSync(out, md.join('\n'), 'utf8')
console.log(`Listo: ${out} (${r.identified} identificados, ${r.words.length} palabras, ${extra.length} cambios)`)
db.close()
