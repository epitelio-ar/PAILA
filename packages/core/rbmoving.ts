// Los temas que están en Rekordbox (vinieron del rekordbox.xml o PAILA ya los exportó): Rekordbox los reconoce por dónde están (la carpeta y el nombre del archivo), así que
// si Organizar los mueve o Arreglar nombres les cambia el nombre, Rekordbox los pierde hasta que se vuelve a importar. Las dos
// vistas previas los cuentan para avisar antes de aplicar (pedido del autor del 24/10). Tests: tests/rekordbox-mover.test.ts.
import type { Db } from './db'

/** Cuántos de estos temas están en Rekordbox: vinieron de su rekordbox.xml o PAILA ya los exportó allá. */
export function inRekordbox(db: Db, fileIds: Iterable<number>): number {
  const ids = [...new Set(fileIds)]
  if (!ids.length) return 0
  return (db.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT file_id FROM rb_ids WHERE source = 'rekordbox' UNION SELECT file_id FROM rb_exports)
     WHERE file_id IN (SELECT value FROM json_each(?))`,
  ).get(JSON.stringify(ids)) as { n: number }).n
}
