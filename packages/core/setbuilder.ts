// Armado de set (Fase F): cómo pega cada tema con el siguiente (tono en la rueda Camelot, BPM y energía), la curva de
// energía de una playlist y qué tema poner después de uno. Solo lee la base.
import { visible, type Db } from './db'
import { parseKey } from './analysis/bench'
import type { Combina, NextSuggestion, SetCurve, SetTrack, SetTransition } from '@paila/shared/types'
import { fold } from './names'
import { titleCore } from './dupnames'
import { num, textos } from '@paila/shared/idioma'

// Lo que se ve en Armar set y en la ficha ("mismo tono (8A) · BPM +1,2 % · sube 1 de energía")
const T = textos({
  igual: { es: 'mismo tono', en: 'same key' },
  vecino: { es: 'tono vecino', en: 'neighboring key' },
  relativo: { es: 'tono relativo', en: 'relative key' },
  diagonal: { es: 'tono en diagonal', en: 'diagonal key' },
  choca: { es: 'el tono choca', en: 'the key clashes' },
  mismoBpm: { es: 'mismo BPM', en: 'same BPM' },
  bpm: { es: (pct: string) => `BPM ${pct} %`, en: (pct: string) => `BPM ${pct}%` },
  mismaEnergia: { es: 'misma energía', en: 'same energy' },
  energia: { es: (sube: boolean, n: number) => `${sube ? 'sube' : 'baja'} ${n} de energía`, en: (sube: boolean, n: number) => `energy ${sube ? 'up' : 'down'} ${n}` },
  mismoEstilo: { es: ' · mismo estilo', en: ' · same style' },
})

const strip = ({ id, artist, title, bpm, camelot, energy, duration }: SetTrack): SetTrack => ({ id, artist, title, bpm, camelot, energy, duration })

// el BPM del análisis o, si falta, el de la grilla (la de Rekordbox primero)
const GRID_BPM = `(SELECT g.bpm FROM dj_grid g WHERE g.file_id = f.id ORDER BY CASE g.method WHEN 'rekordbox' THEN 0 WHEN 'serato' THEN 1 WHEN 'beatthis' THEN 2 ELSE 3 END LIMIT 1)`
const COLS = `f.id, COALESCE(NULLIF(f.artist, ''), '') AS artist, COALESCE(NULLIF(f.title, ''), f.rel_path) AS title, COALESCE(a.bpm, ${GRID_BPM}) AS bpm, a.camelot, a.energy, f.duration`

/** Qué tan bien se mezclan dos tonos (Camelot): igual, vecino (±1), relativo (otra letra), diagonal (±1 y otra letra) o choca. */
export function keyRelation(a: string | null, b: string | null): SetTransition['key'] {
  const x = parseKey(a), y = parseKey(b)
  if (!x || !y) return null
  const d = Math.min(Math.abs(x.n - y.n), 12 - Math.abs(x.n - y.n))
  if (d === 0) return x.minor === y.minor ? 'igual' : 'relativo'
  if (d === 1) return x.minor === y.minor ? 'vecino' : 'diagonal'
  return 'choca'
}

/** Diferencia de BPM en %, contando el doble y la mitad (un 70 se mezcla con un 140). */
export function bpmDiff(a: number | null, b: number | null): number | null {
  if (!a || !b) return null
  const opts = [b, b * 2, b / 2].map((v) => ((v - a) / a) * 100)
  return Math.round(opts.reduce((m, v) => (Math.abs(v) < Math.abs(m) ? v : m)) * 10) / 10
}

/** Puntaje de 0 a 100 de pasar de `a` a `b`. `want`: la energía que se busca (+1 subir, -1 bajar, 0 mantener). */
export function transition(a: SetTrack, b: SetTrack, want = 0): SetTransition {
  const key = keyRelation(a.camelot, b.camelot)
  const bpmPct = bpmDiff(a.bpm, b.bpm)
  const energyJump = a.energy != null && b.energy != null ? b.energy - a.energy : null
  const k = key == null ? 15 : { igual: 40, vecino: 35, relativo: 30, diagonal: 20, choca: 0 }[key]
  const ab = bpmPct == null ? null : Math.abs(bpmPct)
  const t = ab == null ? 10 : ab <= 2 ? 35 : ab <= 4 ? 25 : ab <= 6 ? 15 : ab <= 8 ? 5 : 0
  const off = energyJump == null ? null : Math.abs(energyJump - want)
  const e = off == null ? 10 : off === 0 ? 25 : off === 1 ? 18 : off === 2 ? 8 : 0
  return { key, bpmPct, energyJump, score: k + t + e }
}

const KEY_WORDS: Record<NonNullable<SetTransition['key']>, () => string> = {
  igual: () => T.igual, vecino: () => T.vecino, relativo: () => T.relativo, diagonal: () => T.diagonal, choca: () => T.choca,
}

/** La explicación corta de un pase ("mismo tono (8A) · BPM +1,2 % · sube 1 de energía"). */
export function transitionText(b: SetTrack, t: SetTransition): string {
  const parts: string[] = []
  if (t.key) parts.push(`${KEY_WORDS[t.key]()}${b.camelot ? ` (${b.camelot})` : ''}`)
  if (t.bpmPct != null) parts.push(t.bpmPct === 0 ? T.mismoBpm : T.bpm(`${t.bpmPct > 0 ? '+' : ''}${num(t.bpmPct)}`))
  if (t.energyJump != null) parts.push(t.energyJump === 0 ? T.mismaEnergia : T.energia(t.energyJump > 0, Math.abs(t.energyJump)))
  return parts.join(' · ')
}

/**
 * "Combinan para pasar después" (la ficha del tema): temas de la Música con tono vecino en la rueda Camelot (el mismo, ±1 o
 * la otra letra) y BPM a ±6 % (contando el doble y la mitad), los de mejor nota primero. Sin el mismo tema en otra copia.
 */
export function combinan(db: Db, fileId: number, limit = 7): Combina[] {
  const from = db.prepare(`SELECT ${COLS} FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE f.id = ?`).get(fileId) as unknown as SetTrack | undefined
  if (!from?.camelot || !from.bpm) return []
  const pool = db.prepare(`SELECT ${COLS}, a.grade FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND f.error IS NULL AND f.kind = 'musica' AND a.camelot IS NOT NULL AND f.id <> ?`).all(fileId) as unknown as (SetTrack & { grade: string | null })[]
  const song = (t: SetTrack) => `${fold(t.artist)}|${titleCore(t.title, t.artist)}`
  const same = song(from)
  const rank = (g: string | null) => (g ? ['A+', 'A', 'B', 'C', 'D', 'F'].indexOf(g) : 9)
  return pool.map((t) => ({ t, key: keyRelation(from.camelot, t.camelot), d: bpmDiff(from.bpm, t.bpm) }))
    .filter((x) => x.d != null && Math.abs(x.d) <= 6 && (x.key === 'igual' || x.key === 'vecino' || x.key === 'relativo') && song(x.t) !== same)
    .sort((a, b) => rank(a.t.grade) - rank(b.t.grade) || Math.abs(a.d!) - Math.abs(b.d!))
    .slice(0, limit)
    .map(({ t }) => ({ id: t.id, artist: t.artist, title: t.title, bpm: t.bpm, camelot: t.camelot, grade: t.grade }))
}

export class SetBuilder {
  constructor(private db: Db) {}

  /** Los temas de una playlist en orden, con cómo pega cada uno con el siguiente. */
  curve(trackIds: number[]): SetCurve {
    const q = this.db.prepare(`SELECT ${COLS} FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE f.id = ?`)
    const tracks = trackIds.map((id) => q.get(id) as unknown as SetTrack | undefined).filter((t): t is SetTrack => !!t)
    return { tracks, transitions: tracks.slice(1).map((b, i) => transition(tracks[i], b)) }
  }

  /**
   * Qué poner después de `fromId`: los temas de la Música con BPM y tono que mejor pegan, primero los de la playlist que
   * se está armando (si hay). `energy`: +1 para subir, -1 para bajar, 0 para mantener. Sin los que ya están en `exclude`.
   */
  next(fromId: number, opts: { playlistIds?: number[]; exclude?: number[]; energy?: number; limit?: number } = {}): NextSuggestion[] {
    type Row = SetTrack & { genre: string | null; rel: string }
    const cols = `${COLS}, f.genre, f.rel_path AS rel`
    const from = this.db.prepare(`SELECT ${cols} FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE f.id = ?`).get(fromId) as unknown as Row | undefined
    if (!from) return []
    const pool = this.db.prepare(`SELECT ${cols} FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${visible('f')} AND f.error IS NULL AND f.kind = 'musica' AND a.camelot IS NOT NULL AND COALESCE(a.bpm, ${GRID_BPM}) IS NOT NULL`).all() as unknown as Row[]
    const inList = new Set(opts.playlistIds ?? [])
    const skip = new Set([fromId, ...(opts.exclude ?? [])])
    const want = opts.energy ?? 0
    // el mismo tema (otra copia u otra versión) no es una sugerencia (corrida supervisada 21/10: "Conjure Sex" después de "Conjure Sex")
    const song = (t: Row) => `${fold(t.artist)}|${titleCore(t.title, t.artist)}`
    const same = song(from)
    // mismo estilo: el mismo género o la misma carpeta de arriba ("Electronica/House"); sin esto salía La Renga en un set de techno
    const style = (t: Row) => ({ g: fold(t.genre ?? ''), d: t.rel.split('/').slice(0, 2).join('/').toLowerCase() })
    const fs0 = style(from)
    const near = (t: Row) => { const x = style(t); return (!!x.g && x.g === fs0.g) || (x.d.includes('/') && x.d === fs0.d) }
    const bonus = (t: Row) => (inList.has(t.id) ? 8 : 0) + (near(t) ? 10 : 0)
    return pool.filter((t) => !skip.has(t.id) && song(t) !== same)
      .map((t) => { const tr = transition(from, t, want); return { row: t, track: strip(t), transition: tr, why: transitionText(t, tr) + (near(t) ? T.mismoEstilo : ''), inPlaylist: inList.has(t.id) } })
      // los de la playlist y los del mismo estilo suben: es lo que la persona ya eligió para esta noche
      .sort((x, y) => (y.transition.score + bonus(y.row)) - (x.transition.score + bonus(x.row)) || (x.track.duration ?? 0) - (y.track.duration ?? 0))
      .slice(0, opts.limit ?? 12)
      .map(({ row: _row, ...rest }) => rest)
  }

}
