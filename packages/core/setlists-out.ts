// Lo que sale del tracklist de un set (core/setlists.ts): texto con minutos, hoja .cue, planilla CSV, el comentario del
// tag del set (va a Cambios pendientes) y los cue points para Rekordbox (dj_cues, fuente 'tracklist'). Solo la base.
import { transaction, type Db } from './db'
import { clock } from './tracklist'
import type { SetTracklist, TrackInSet, TracklistFormat } from '@paila/shared/types'

/** Fuente de los cue points del tracklist (en Rekordbox, memory cues con el nombre del tema). */
export const CUE_SOURCE = 'tracklist'
const WHERE: Record<string, string> = { biblioteca: 'Tu biblioteca', acoustid: 'AcoustID', audd: 'Reconocedor', mano: 'A mano' }

/** Los temas que salen (los reconocidos o escritos, sin los quitados ni los dudosos sin confirmar), en orden. */
export function shownTracks(t: SetTracklist): TrackInSet[] {
  return t.entries.filter((e) => e.source && !e.hidden && (e.confidence !== 'baja' || e.confirmed || e.source === 'mano') && (e.artist || e.title))
}

/** El tracklist como texto (con minutos), hoja .cue o planilla CSV. */
export function tracklistExport(t: SetTracklist, format: TracklistFormat): string {
  const list = shownTracks(t)
  const name = (e: TrackInSet) => [e.artist, e.title].filter(Boolean).join(' - ')
  if (format === 'csv') {
    const q = (s: string | null | undefined) => `"${(s ?? '').replace(/"/g, '""')}"`
    return ['Entra;Artista;Título;De dónde;Seguridad', ...list.map((e) => [clock(e.start), q(e.artist), q(e.title), WHERE[e.source!], e.confidence].join(';'))].join('\r\n') + '\r\n'
  }
  if (format === 'cue') {
    // hoja .cue: los reproductores (foobar2000, VLC…) muestran el set dividido en sus temas
    const file = t.rel.split('/').pop()!
    const ext = file.split('.').pop()!.toLowerCase()
    const type = ext === 'mp3' ? 'MP3' : ext === 'wav' ? 'WAVE' : ext === 'aiff' || ext === 'aif' ? 'AIFF' : 'WAVE'
    const q = (s: string | null) => (s ?? '').replace(/"/g, "'")
    const idx = (s: number) => { const fr = Math.round(s * 75), m = Math.floor(fr / 4500), x = Math.floor((fr % 4500) / 75), f = fr % 75; return `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}:${String(f).padStart(2, '0')}` }
    const lines = [`REM COMMENT "Tracklist armado por PAILA"`, `TITLE "${q(file.replace(/\.[^.]+$/, ''))}"`, `FILE "${q(file)}" ${type}`]
    // el primer tema arranca en 0 (la hoja .cue lo necesita así); si hay algo antes, queda adentro del primero
    list.forEach((e, i) => lines.push(`  TRACK ${String(i + 1).padStart(2, '0')} AUDIO`, `    TITLE "${q(e.title)}"`, `    PERFORMER "${q(e.artist)}"`, `    INDEX 01 ${idx(i === 0 ? 0 : e.start)}`))
    return lines.join('\r\n') + '\r\n'
  }
  return list.map((e) => `${clock(e.start)}  ${name(e)}`).join('\n') + '\n'
}

/** El comentario que va en el tag del set: "Tracklist (PAILA):" y un renglón por tema. Si ya tenía otro comentario, va arriba. */
export function commentFor(t: SetTracklist, current: string | null): string | null {
  const list = tracklistExport(t, 'txt').trim()
  if (!list) return null
  const mine = `Tracklist (PAILA):\n${list}`
  // un comentario que ya era un tracklist de PAILA se reemplaza; cualquier otro se conserva arriba
  const keep = current && !current.startsWith('Tracklist (PAILA):') ? current.replace(/\n*Tracklist \(PAILA\):[\s\S]*$/, '').trim() : ''
  return keep ? `${keep}\n\n${mine}` : mine
}

/** Cue points para Rekordbox: un memory cue con el nombre de cada tema donde entra (reemplaza los del tracklist anterior). */
export function saveCues(db: Db, t: SetTracklist): number {
  const list = shownTracks(t)
  transaction(db, () => {
    db.prepare('DELETE FROM dj_cues WHERE file_id = ? AND source = ?').run(t.fileId, CUE_SOURCE)
    const ins = db.prepare('INSERT INTO dj_cues (file_id, source, kind, num, start, end_at, name, color) VALUES (?, ?, ?, -1, ?, NULL, ?, ?)')
    for (const e of list) ins.run(t.fileId, CUE_SOURCE, 'memory', e.start, [e.artist, e.title].filter(Boolean).join(' - ').slice(0, 60), '#28E214')
  })
  return list.length
}

/** Saca los cue points del tracklist (los de Rekordbox, Serato o sugeridos no se tocan). */
export function clearCues(db: Db, fileId: number): number {
  return Number(db.prepare('DELETE FROM dj_cues WHERE file_id = ? AND source = ?').run(fileId, CUE_SOURCE).changes)
}

/** Cuántos cue points del tracklist tiene guardados el set. */
export function cuesSaved(db: Db, fileId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM dj_cues WHERE file_id = ? AND source = ?').get(fileId, CUE_SOURCE) as { n: number }).n
}
