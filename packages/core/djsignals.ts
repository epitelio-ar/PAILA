// Señales de que la persona pincha (para ofrecerle "Herramientas para DJ y producción" una sola vez): cuántos temas ya traen
// BPM o tono, qué carpetas tiene ("Sets", "Rekordbox", "PIONEER"…) y si trajo un rekordbox.xml o lo de Serato. Solo lee la base.
import { visible, type Db } from './db'
import type { DjSignals } from '@paila/shared/profile'

export function djSignals(db: Db): DjSignals {
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n
  const tracks = one(`SELECT COUNT(*) AS n FROM files f WHERE ${visible('f')}`)
  // 'tag' = el BPM o el tono venían escritos en el tag; 'nombre' = en el nombre del archivo ("128 - 8A - Tema")
  const withBpmOrKey = one(`SELECT COUNT(*) AS n FROM files f JOIN analysis a ON a.file_id = f.id
    WHERE ${visible('f')} AND a.bpm_source IN ('tag', 'nombre')`)
  // los nombres de las carpetas de las colecciones (cada una en su tramo) y de la carpeta raíz
  const paths = [
    ...(db.prepare('SELECT rel_prefix AS p FROM rules').all() as { p: string }[]).map((r) => r.p),
    ...(db.prepare('SELECT rel_path AS p FROM roots').all() as { p: string }[]).map((r) => r.p),
  ]
  const folders = [...new Set(paths.flatMap((p) => p.split(/[\\/]/)).filter(Boolean))]
  const imported = one(`SELECT (EXISTS (SELECT 1 FROM rb_ids WHERE source = 'rekordbox') OR EXISTS (SELECT 1 FROM dj_grid WHERE method IN ('rekordbox', 'serato'))) AS n`) === 1
  return { tracks, withBpmOrKey, folders, imported }
}
