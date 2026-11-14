// Lo que PAILA guardó en la base con palabras (la nota de calidad, sus motivos, los errores de lectura) en el idioma elegido.
// La nota se guarda en los dos idiomas (gradeEnLosDos): las columnas de siempre en el de ahora y el otro en `analysis_otro`
// (en los ZIP y RAR, `archive_otro`). Al cambiar de idioma se intercambian, así todo lo que lee esas columnas (la tabla, la
// ficha, las listas) no cambia. Lo guardado antes, en un solo idioma, se traduce con enEsteIdioma (los textos fijos y los que
// llevan datos, por su molde); lo que no se reconoce queda como estaba hasta que se vuelva a analizar.
// Corre al abrir PAILA y al cambiar de idioma; si ya está en ese idioma, no hace nada.
import { enEsteIdioma, idioma, textos, type Idioma } from '@paila/shared/idioma'
import { transaction, type Db } from './db'
// los textos que pueden haber quedado guardados: importarlos los anota para enEsteIdioma
import './analysis/grade.textos'
import './analysis/clues'
import './probe'
import './archive/textos'

const AJUSTE = 'textos_idioma'

// Textos que PAILA ya no dice pero pueden haber quedado guardados de antes (se cambió la redacción): solo para pasarlos al
// otro idioma. El de vuelta es el de ahora (enEsteIdioma toma el primero que se anotó con ese texto).
textos({
  bajaParaPinchar: {
    es: 'Es una calidad baja para pinchar en un equipo grande: conviene conseguir una versión mejor.',
    en: "It's low quality: you'll notice it on headphones or a good sound system. It's worth getting a better version.",
  },
})

/** Los textos de la nota en el otro idioma (gradeEnLosDos), tal como se guardan. */
export interface OtroIdioma { i: Idioma; says?: string; is: string; why: string[]; sound?: string[] }

/** Guarda la nota de un tema en el otro idioma (null: la borra, por ejemplo si la lectura dio error). */
export function guardarOtro(db: Db, fileId: number, otro: OtroIdioma | null) {
  if (!otro) db.prepare('DELETE FROM analysis_otro WHERE file_id = ?').run(fileId)
  else db.prepare('INSERT OR REPLACE INTO analysis_otro (file_id, textos) VALUES (?, ?)').run(fileId, JSON.stringify(otro))
}
/** Lo mismo para un tema adentro de un ZIP o RAR (solo la etiqueta y el porqué). */
export function guardarOtroZip(db: Db, entryId: number, otro: OtroIdioma | null) {
  if (!otro) db.prepare('DELETE FROM archive_otro WHERE entry_id = ?').run(entryId)
  else db.prepare('INSERT OR REPLACE INTO archive_otro (entry_id, textos) VALUES (?, ?)').run(entryId, JSON.stringify({ i: otro.i, is: otro.is, why: otro.why }))
}

const lista = (json: string | null): string[] | null => { if (!json) return null; try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String) : null } catch { return null } }

/** Pasa la nota, sus motivos y los errores guardados al idioma `i`. Devuelve cuántas filas cambió. */
export function pasarTextosAlIdioma(db: Db, i: Idioma): number {
  const ahora = (db.prepare('SELECT value FROM settings WHERE key = ?').get(AJUSTE) as { value?: string } | undefined)?.value
  if (ahora === i) return 0
  const otro: Idioma = i === 'es' ? 'en' : 'es'
  let cambios = 0
  transaction(db, () => {
    // 1) lo analizado con los dos idiomas: se intercambian. Primero se anota lo de ahora (que pasa a ser "el otro") y lo nuevo.
    db.exec('DROP TABLE IF EXISTS temp.cambio_idioma')
    db.prepare(`CREATE TEMP TABLE cambio_idioma AS SELECT a.file_id AS id, o.textos AS nuevo,
      json_object('i', ?, 'says', a.says, 'is', a.is_label, 'why', json(COALESCE(a.why, '[]')), 'sound', json(COALESCE(a.sound, '[]'))) AS viejo
      FROM analysis a JOIN analysis_otro o ON o.file_id = a.file_id WHERE a.is_label IS NOT NULL AND json_extract(o.textos, '$.i') = ?`).run(otro, i)
    cambios += Number(db.prepare(`UPDATE analysis SET says = (SELECT json_extract(nuevo, '$.says') FROM cambio_idioma WHERE id = analysis.file_id),
      is_label = (SELECT json_extract(nuevo, '$.is') FROM cambio_idioma WHERE id = analysis.file_id),
      why = (SELECT json_extract(nuevo, '$.why') FROM cambio_idioma WHERE id = analysis.file_id),
      sound = (SELECT json_extract(nuevo, '$.sound') FROM cambio_idioma WHERE id = analysis.file_id)
      WHERE file_id IN (SELECT id FROM cambio_idioma)`).run().changes)
    db.prepare('UPDATE analysis_otro SET textos = (SELECT viejo FROM cambio_idioma WHERE id = analysis_otro.file_id) WHERE file_id IN (SELECT id FROM cambio_idioma)').run()
    db.exec('DROP TABLE temp.cambio_idioma')
    db.prepare(`CREATE TEMP TABLE cambio_idioma AS SELECT e.id AS id, o.textos AS nuevo, json_object('i', ?, 'is', e.grade_is, 'why', json(COALESCE(e.grade_why, '[]'))) AS viejo
      FROM archive_entries e JOIN archive_otro o ON o.entry_id = e.id WHERE e.grade_is IS NOT NULL AND json_extract(o.textos, '$.i') = ?`).run(otro, i)
    cambios += Number(db.prepare(`UPDATE archive_entries SET grade_is = (SELECT json_extract(nuevo, '$.is') FROM cambio_idioma WHERE id = archive_entries.id),
      grade_why = (SELECT json_extract(nuevo, '$.why') FROM cambio_idioma WHERE id = archive_entries.id) WHERE id IN (SELECT id FROM cambio_idioma)`).run().changes)
    db.prepare('UPDATE archive_otro SET textos = (SELECT viejo FROM cambio_idioma WHERE id = archive_otro.entry_id) WHERE entry_id IN (SELECT id FROM cambio_idioma)').run()
    db.exec('DROP TABLE temp.cambio_idioma')

    // 2) lo guardado en un solo idioma (y los errores, que siempre son de uno): se traduce lo que se reconoce
    const uno = (t: string | null) => (t == null ? t : enEsteIdioma(t, i))
    const varios = (json: string | null) => { const v = lista(json); return v ? JSON.stringify(v.map((t) => enEsteIdioma(t, i))) : json }
    const ana = db.prepare('UPDATE analysis SET says = ?, is_label = ?, why = ?, sound = ?, error = ? WHERE file_id = ?')
    for (const r of db.prepare(`SELECT a.file_id, a.says, a.is_label, a.why, a.sound, a.error, (o.file_id IS NOT NULL) AS doble FROM analysis a
      LEFT JOIN analysis_otro o ON o.file_id = a.file_id WHERE a.is_label IS NOT NULL OR a.error IS NOT NULL`).all() as
      { file_id: number; says: string | null; is_label: string | null; why: string | null; sound: string | null; error: string | null; doble: number }[]) {
      const n = r.doble ? [r.says, r.is_label, r.why, r.sound, uno(r.error)] : [uno(r.says), uno(r.is_label), varios(r.why), varios(r.sound), uno(r.error)]
      if (n[0] !== r.says || n[1] !== r.is_label || n[2] !== r.why || n[3] !== r.sound || n[4] !== r.error) { ana.run(...n, r.file_id); cambios++ }
    }
    const arc = db.prepare('UPDATE archive_entries SET grade_is = ?, grade_why = ?, error = ? WHERE id = ?')
    for (const r of db.prepare(`SELECT e.id, e.grade_is, e.grade_why, e.error, (o.entry_id IS NOT NULL) AS doble FROM archive_entries e
      LEFT JOIN archive_otro o ON o.entry_id = e.id WHERE e.grade_is IS NOT NULL OR e.error IS NOT NULL`).all() as
      { id: number; grade_is: string | null; grade_why: string | null; error: string | null; doble: number }[]) {
      const n = r.doble ? [r.grade_is, r.grade_why, uno(r.error)] : [uno(r.grade_is), varios(r.grade_why), uno(r.error)]
      if (n[0] !== r.grade_is || n[1] !== r.grade_why || n[2] !== r.error) { arc.run(...n, r.id); cambios++ }
    }
    const fil = db.prepare('UPDATE files SET error = ? WHERE id = ?')
    for (const r of db.prepare('SELECT id, error FROM files WHERE error IS NOT NULL').all() as { id: number; error: string }[]) {
      const t = enEsteIdioma(r.error, i)
      if (t !== r.error) { fil.run(t, r.id); cambios++ }
    }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(AJUSTE, i)
  })
  return cambios
}

/**
 * La nota de una fila de `analysis` en el idioma `i`, sin escribir nada (para lo que lee la base de afuera, como `npm run tema`,
 * que puede pedir el otro idioma que el de la app): con `otro` (la fila de analysis_otro) usa esos textos si son de ese idioma,
 * y si no traduce lo que se reconoce.
 */
export function notaEnIdioma(a: Record<string, unknown>, otroJson: string | null, i: Idioma = idioma()): { says: string | null; is: string | null; why: string[]; sound: string[]; error: string | null } {
  let otro: Partial<OtroIdioma> | null = null
  try { otro = otroJson ? JSON.parse(otroJson) : null } catch { /* rota: se traduce lo que se reconozca */ }
  const t = (v: unknown) => (v == null ? null : enEsteIdioma(String(v), i))
  if (otro?.i === i) return { says: otro.says ?? null, is: otro.is ?? null, why: (otro.why ?? []).map(String), sound: (otro.sound ?? []).map(String), error: t(a.error) }
  return { says: t(a.says), is: t(a.is_label), why: (lista(a.why as string | null) ?? []).map((x) => enEsteIdioma(x, i)), sound: (lista(a.sound as string | null) ?? []).map((x) => enEsteIdioma(x, i)), error: t(a.error) }
}
