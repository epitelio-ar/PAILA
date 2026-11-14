// El estado de la colección de una base (core/estado.ts), en la consola: cuánto falta en cada parte y cuánto tarda en contarlo.
// Nunca toca la base que le pasás: trabaja sobre una copia en el temporal (la copia se pone al día con las migraciones y se borra).
// No lee archivos de música (los repetidos se cuentan con las huellas del análisis, sin comparar archivos).
//
//   node scripts/run-ts.mjs scripts/estado.ts [--base <paila.db>]     (por defecto: PAILA_USER_DATA o la de esta PC)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDb } from '@paila/core/db'
import { Organizer } from '@paila/core/organizer'
import { Estado } from '@paila/core/estado'
import { GRUPOS_ESTADO } from '@paila/shared/types'

const i = process.argv.indexOf('--base')
const datos = process.env.PAILA_USER_DATA ?? path.join(process.env.APPDATA ?? os.homedir(), 'PAILA')
const base = i > 0 ? process.argv[i + 1] : path.join(datos, 'paila.db')
if (!fs.existsSync(base)) { console.error(`No encuentro la base en ${base}. Pasá --base <paila.db>.`); process.exit(2) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-estado-'))
const copia = path.join(tmp, 'paila.db')
fs.copyFileSync(base, copia)
for (const x of ['-wal', '-shm']) if (fs.existsSync(base + x)) fs.copyFileSync(base + x, copia + x)
const db = openDb(copia)
try {
  const estado = new Estado(db, { pathOf: () => null, organizer: new Organizer(db, () => null) })
  let t = performance.now()
  const primero = estado.leer()
  const ms1 = performance.now() - t
  t = performance.now()
  const e = await estado.listo()
  const ms2 = performance.now() - t
  t = performance.now(); estado.leer(); const ms3 = performance.now() - t
  console.log(`${e.total} temas · ${e.escuchados} escuchados · veredicto: ${e.hayVeredicto ? 'sí' : 'todavía no'} · regla: ${e.regla.dest}/${e.regla.rule}${e.reglaGuardada ? '' : ' (de fábrica)'}`)
  for (const g of GRUPOS_ESTADO) {
    const c = e.grupos[g]
    console.log(`  ${g.padEnd(10)} ${String(c.n ?? c.espera).padStart(7)}${c.aparte ? `  (aparte ${c.aparte})` : ''}${c.dejados ? `  (dejados ${c.dejados})` : ''}  ${c.filas.slice(0, 3).map((f) => f.texto).join(' | ')}`)
  }
  console.log(`tiempo: ${Math.round(ms1)} ms la primera vez (sin repetidos: ${primero.grupos.repetidos.espera ?? 'listos'}), ${Math.round(ms2)} ms los repetidos, ${Math.round(ms3)} ms otra vez sin cambios`)
} finally { db.close(); fs.rmSync(tmp, { recursive: true, force: true }) }
