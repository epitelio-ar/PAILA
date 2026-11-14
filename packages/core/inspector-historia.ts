// Inspector de un tema, segunda parte (core/inspector.ts): el historial de cambios del tema y lo que propondría cada asistente
// (Arreglar nombres y tags, nombres oficiales, volumen parejo, sets, faltan o suenan mal). Solo lee. Textos: inspector.textos.ts.
import type { InspectSection } from '@paila/shared/types'
import { DEFAULT_PROFILE, rulesOf, type TidyRule } from '@paila/shared/tidy-profiles'
import type { Db } from './db'
import { officialFindings } from './official-findings'
import { gainFor } from './replaygain'
import { setReason } from './sets'
import { tidy } from './tidy'
import { oneOf, row, rowsOf, show, type Rec } from './inspector-base'
import { T } from './inspector.textos'

const LIMITE = 25
const dia = (t: unknown) => String(t ?? '').replace('T', ' ').slice(0, 19)
const deshecho = (t: unknown) => (t ? T.deshecho(dia(t)) : '')

/** Lo que PAILA hizo con este archivo, del más nuevo al más viejo (tags, papelera, movimientos, reemplazos, operaciones a medias). */
export function historySections(db: Db, f: Rec): InspectSection[] {
  const id = Number(f.id)
  const hechos: { at: string; text: string }[] = []
  for (const j of rowsOf(db, 'SELECT batch_id, field, before, after, applied_at, undone_at FROM journal WHERE file_id = ? ORDER BY id DESC LIMIT 60', id)) {
    hechos.push({ at: dia(j.applied_at), text: T.tanda(String(j.batch_id), String(j.field), show(j.before), show(j.after)) + deshecho(j.undone_at) })
  }
  for (const t of rowsOf(db, 'SELECT batch_id, orig_rel, trash_rel, reason, created_at, restored_at, purged_at FROM trash_log WHERE file_id = ? ORDER BY id DESC', id)) {
    hechos.push({ at: dia(t.created_at), text: `${T.aPapelera(String(t.batch_id), show(t.reason), String(t.orig_rel))}${t.restored_at ? T.restaurado(dia(t.restored_at)) : ''}${t.purged_at ? T.borrado(dia(t.purged_at)) : ''}` })
  }
  for (const m of rowsOf(db, 'SELECT batch_id, from_rel, to_rel, created_at, undone_at FROM moves_log WHERE file_id = ? ORDER BY id DESC', id)) {
    hechos.push({ at: dia(m.created_at), text: T.movido(String(m.batch_id), String(m.from_rel), String(m.to_rel)) + deshecho(m.undone_at) })
  }
  for (const r of rowsOf(db, 'SELECT id, old_trash_rel, new_rel, created_at, undone_at FROM replacements WHERE file_id = ? ORDER BY id DESC', id)) {
    hechos.push({ at: dia(r.created_at), text: T.reemplazado(String(r.id), String(r.old_trash_rel), String(r.new_rel)) + deshecho(r.undone_at) })
  }
  for (const r of rowsOf(db, 'SELECT playlist_id, old_file, new_file, created_at, undone_at FROM improve_log WHERE old_file = ? OR new_file = ? ORDER BY id DESC', id, id)) {
    hechos.push({ at: dia(r.created_at), text: T.mejorar(r.old_file === id, String(r.old_file === id ? r.new_file : r.old_file), String(r.playlist_id)) + deshecho(r.undone_at) })
  }
  hechos.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const enCurso = rowsOf(db, 'SELECT op, phase, result, message, started_at FROM op_journal WHERE file_id = ? ORDER BY id DESC LIMIT 10', id)
  return [{
    key: 'historial', title: T.historial, help: T.historialAyuda,
    rows: [row(T.cambiosHistorial, hechos.length), row(T.operacionesDiario, enCurso.length)],
    items: [...hechos.slice(0, LIMITE).map((h) => `${h.at}  ${h.text}`), ...enCurso.map((o) => `${dia(o.started_at)}  ${T.diario(String(o.op), String(o.phase))}${o.result ? `, ${o.result}` : ''}${o.message ? ` — ${o.message}` : ''}`)],
    empty: T.nuncaCambio,
  }]
}

function reglasGuardadas(db: Db): TidyRule[] {
  try { const v = oneOf(db, "SELECT value FROM settings WHERE key = 'tidy.reglas'")?.value; return v ? (JSON.parse(String(v)) as TidyRule[]) : rulesOf(DEFAULT_PROFILE) } catch { return rulesOf(DEFAULT_PROFILE) }
}

/** Qué propondría cada asistente para este tema, con las reglas que la persona tiene elegidas. */
export function assistantSections(db: Db, f: Rec, a: Rec | undefined): InspectSection[] {
  const id = Number(f.id)
  const out: InspectSection[] = []

  // Arreglar nombres y tags: corre completo (los pasos miran las carpetas y los otros temas), pero muestra solo lo de este tema
  const items: string[] = []
  let rows = [row(T.reglas, T.noCalcular)]
  try {
    const reglas = reglasGuardadas(db)
    const r = tidy(db, undefined, undefined, reglas)
    const mios = r.changes.filter((c) => c.id === id)
    for (const c of mios) items.push(`${T.propone(String(c.field), show(c.from), show(c.to))}${c.note ? ` — ${c.note}` : ''}${c.rules?.length ? T.conReglas(c.rules.join(', ')) : ''}`)
    for (const v of r.review.filter((x) => x.id === id && !x.staged)) items.push(T.aMano(String(v.field), show(v.from), show(v.to), String(v.why)))
    const set = r.sets.find((s) => s.id === id)
    if (set) items.push(T.pareceSet(String(set.minutes), String(set.why)))
    rows = [row(T.reglasElegidas, reglas.join(', ')), row(T.cambiosPropone, mios.length)]
  } catch (e) { rows = [row(T.reglas, T.noCalcularPor((e as Error).message))] }
  out.push({ key: 'asist-nombres', title: T.asistNombres, help: T.asistNombresAyuda, rows, items, empty: T.nadaPropone })

  // Nombres oficiales: solo lo que ya contestó internet (la caché), sin pedir nada
  const found = officialFindings(db, [{ id, artist: f.artist as string | null, title: f.title as string | null, duration: f.duration as number | null, chromaprint: (a?.chromaprint as string | null) ?? null, hasPrint: !!a?.chromaprint, file: String(f.rel_path) }]).get(id) ?? []
  const mb = oneOf(db, 'SELECT status, looked_at FROM mb_lookup WHERE file_id = ?', id)
  out.push({
    key: 'asist-oficial', title: T.asistOficial, help: T.asistOficialAyuda,
    rows: [row(T.consultaMb, mb ? `${mb.status} (${dia(mb.looked_at)})` : null)],
    items: found.map((x) => T.oficial(String(x.field), String(x.to), String(x.conf), String(x.why), x.sources.join(', '))), empty: T.sinOficial,
  })

  // Volumen parejo
  const gain = a?.lufs != null && Number.isFinite(Number(a.lufs)) ? gainFor(Number(a.lufs)) : null
  out.push({ key: 'asist-volumen', title: T.asistVolumen, help: T.asistVolumenAyuda, rows: [row(T.ganancia, gain != null ? `${gain > 0 ? '+' : ''}${gain} dB` : null)] })

  // Sets
  const set = setReason(String(f.rel_path), f.duration as number | null, { artist: f.artist as string | null, title: f.title as string | null })
  if (set) out.push({ key: 'asist-sets', title: T.asistSets, rows: [row(T.pareceSetFila, set)] })

  // Faltan o suenan mal
  const w = rowsOf(db, 'SELECT status, reason, note, added_at FROM wanted WHERE file_id = ? OR ref_file_id = ?', id, id)
  if (w.length) out.push({ key: 'asist-lista', title: T.listaConseguir, rows: [], items: w.map((x) => `${x.status}: ${x.reason}${x.note ? ` — ${x.note}` : ''}${T.desde(dia(x.added_at))}`) })
  return out
}
