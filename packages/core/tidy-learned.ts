// Paso del asistente "Arreglar nombres y tags" con las palabras que PAILA aprendió a sacar (regla `aprendidas`, ver
// core/junkwords.ts): las saca del título y del artista (y, en el paso de nombres de archivo, del nombre), siempre con el
// motivo a la vista. Lo aprendido se recuerda por base mientras nada cambie.
import type { Db } from './db'
import { JunkWords, learnedNote, stripLearned } from './junkwords'
import type { TidyCtx } from './tidy'
import type { LearnedWord } from '@paila/shared/types'

const byDb = new WeakMap<Db, JunkWords>()
/** El aprendizaje de esta base (uno solo, así el asistente no lo recalcula en cada perfil). */
export const junkWordsOf = (db: Db) => { let j = byDb.get(db); if (!j) { j = new JunkWords(db); byDb.set(db, j) } return j }
export const learnedFor = (db: Db): LearnedWord[] => junkWordsOf(db).active()

/** Saca las palabras aprendidas de un texto; devuelve también el motivo (null si no había ninguna). */
export function learnedStrip(text: string, words: LearnedWord[]): { text: string; note: string | null } {
  if (!words.length) return { text, note: null }
  const r = stripLearned(text, words)
  if (!r.used.length || !r.text) return { text, note: null }
  return { text: r.text, note: r.used.map((k) => learnedNote(words.find((w) => w.key === k)!)).join(' · ') }
}

export function applyLearned(c: TidyCtx) {
  if (!c.learned.length) return
  for (const r of c.rows) {
    if (c.isSet.has(r.id)) continue
    for (const f of ['title', 'artist'] as const) {
      const v = c.val(r.id, f)
      if (!v) continue
      const s = learnedStrip(v, c.learned)
      if (s.note) c.setField(r, f, s.text, 'junk', s.note, 'aprendidas')
    }
  }
}
