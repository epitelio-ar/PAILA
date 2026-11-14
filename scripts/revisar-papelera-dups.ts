// Solo lectura (no se usa en la app): de lo que Duplicados mandó a la papelera, qué pares son el mismo audio, otra versión u
// otro tema según la huella del sonido (core/sockseek/huella.ts). Para revisar después del hallazgo 1 de la revisión integral
// (02/11): con el análisis a medias, "probables por nombre" podía juntar dos temas distintos con el mismo título.
// Uso: node scripts/run-ts.mjs scripts/revisar-papelera-dups.ts [base.db]
import { DatabaseSync } from 'node:sqlite'
import { compararHuellas } from '@paila/core/sockseek/huella'

const db = new DatabaseSync(process.argv[2] ?? `${process.env.APPDATA}/PAILA/paila.db`, { readOnly: true })
const rows = db.prepare(`SELECT t.id, t.orig_rel AS tiro, t.restored_at AS rest, t.purged_at AS purg, f.duration AS d1, k.rel_path AS queda, k.duration AS d2,
  a1.chromaprint AS p1, a2.chromaprint AS p2, a1.audio_md5 AS m1, a2.audio_md5 AS m2
  FROM trash_log t JOIN files f ON f.id = t.file_id LEFT JOIN files k ON k.id = t.kept_id
  LEFT JOIN analysis a1 ON a1.file_id = f.id LEFT JOIN analysis a2 ON a2.file_id = k.id
  WHERE t.reason = 'Duplicados' AND t.restored_at IS NULL ORDER BY t.id`).all() as Record<string, string | number | null>[]
const cuenta: Record<string, number> = {}
const dudosos: string[] = []
for (const r of rows) {
  let que: string
  if (r.m1 && r.m1 === r.m2) que = 'idéntico'
  else if (!r.p1 || !r.p2) que = 'sin huella'
  else que = compararHuellas(r.p1 as string, r.d1 as number, r.p2 as string, r.d2 as number) ?? 'no se sabe'
  cuenta[que] = (cuenta[que] ?? 0) + 1
  if (que !== 'idéntico' && que !== 'mismo') dudosos.push(`${que.padEnd(10)} ${r.purg ? '[YA BORRADO] ' : ''}${r.tiro} (${Number(r.d1).toFixed(0)} s) ↔ queda ${r.queda} (${Number(r.d2).toFixed(0)} s)`)
}
console.log('en la papelera por Duplicados:', rows.length, JSON.stringify(cuenta))
for (const d of dudosos) console.log(d)
