// NAPIA: "Saltear lo que ya tenés en PAILA". Mira la base de PAILA en solo lectura (nunca escribe) y empareja la lista con
// ListMatcher (el mismo de la lista «Faltan o suenan mal»): lo que ya está en tu biblioteca no se baja de nuevo. Solo se saltea lo
// seguro o probable (mismo artista y título, misma duración); "otra versión" (en vivo, remix) se baja. Si la base de PAILA
// no está o no se puede abrir, no se saltea nada. Lo que viene a reemplazar una copia tuya (la lista «Faltan o suenan mal», con
// `reemplaza`) nunca se saltea: lo tenés, pero se busca uno mejor.
// Solo se saltea lo que tenés en buena calidad (nota A+, A o B, sin inflado ni sin pérdida falso; la misma vara que la Lista
// para conseguir): lo que tenés en C, D o F se baja igual, como "para reemplazar" esa copia (pedido del autor, 24/10).
// Lo que viene marcado "otra versión" (en la lista «Faltan o suenan mal» dijiste "No es" a la copia que se parecía) tampoco se
// saltea: el emparejador cree que lo tenés, pero vos dijiste que no.
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { visible } from '../db'
import { flagList } from '../better'
import { ListMatcher, lowQuality, type LibTrack } from '../listmatch'
import { setReason } from '../sets'
import type { CopiaTuya, NapiaList, YaTenes } from '@paila/shared/napia'
import { textos } from '@paila/shared/idioma'

const T = textos({
  que: { es: (ext: string, nota: string) => `${ext} · nota ${nota}`, en: (ext: string, nota: string) => `${ext} · grade ${nota}` },
})

/** Un tema de la biblioteca de PAILA, con lo que dice su análisis (para reemplazarlo si está en mala calidad). */
export interface TemaPaila extends LibTrack { effKbps?: number | null; clipEvents?: number | null; lufs?: number | null }

/** Los temas de la biblioteca de PAILA (música y "para revisar", sin sample packs), leídos de su base sin tocarla. */
export function readPailaLibrary(dbFiles: string[]): TemaPaila[] | null {
  for (const f of dbFiles) {
    if (!fs.existsSync(f)) continue
    try {
      const db = new DatabaseSync(f, { readOnly: true })
      try {
        const rows = db.prepare(
          `SELECT f.id, f.rel_path AS rel, f.ext, f.artist, f.title, f.duration, a.grade, a.flags, a.eff_kbps AS effKbps, a.clip_events AS clipEvents, a.lufs, i.isrc
           FROM files f LEFT JOIN analysis a ON a.file_id = f.id LEFT JOIN file_isrc i ON i.file_id = f.id
           WHERE ${visible('f')} AND f.error IS NULL AND f.kind IN ('musica', 'revisar')`,
        ).all() as unknown as TemaPaila[]
        return rows.filter((r) => !setReason(r.rel, r.duration, r))
      } finally { db.close() }
    } catch { /* base ocupada o de otra versión: se prueba la siguiente */ }
  }
  return null
}

const RANK: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4, F: 5 }
/**
 * ¿Lo que tenés está en buena calidad? Nota A+, A o B y sin las marcas de la lista «Faltan o suenan mal» (inflado, sin pérdida falso).
 * Sin analizar todavía: no se sabe, y se saltea (como antes; la lista «Faltan o suenan mal» tampoco lo pide).
 */
export const buenaCalidad = (t: LibTrack) => !t.grade || ((RANK[t.grade] ?? 9) <= RANK.B && !lowQuality(t))

/** La copia tuya que viene a reemplazarse (la misma forma que manda la lista «Faltan o suenan mal», core/wanted.ts). */
export const copiaDe = (t: TemaPaila): CopiaTuya => ({
  nota: t.grade!, kbps: t.effKbps ?? null, que: T.que(t.ext.toUpperCase(), t.grade!), marcas: flagList(t.flags), recortes: t.clipEvents ?? null, lufs: t.lufs ?? null, duracion: t.duration,
})

/**
 * Qué temas de la lista ya están en la biblioteca en buena calidad (`tenes`), cuáles hay que bajar (`faltan`) y, de esos,
 * cuáles tenés en mala calidad (`mejorar`: se bajan con `reemplaza`, para quedarse solo con una copia claramente mejor).
 */
export function saltearTenes(tracks: NapiaList['tracks'], lib: TemaPaila[] | null): YaTenes {
  if (!lib?.length) return { faltan: tracks, tenes: [], mejorar: [] }
  const matcher = new ListMatcher(lib)
  const byId = new Map(lib.map((t) => [t.id, t]))
  const faltan: NapiaList['tracks'] = [], tenes: YaTenes['tenes'] = [], mejorar: YaTenes['mejorar'] = []
  for (const t of tracks) {
    if (t.reemplaza || t.otraVersion) { faltan.push(t); continue }
    const m = matcher.match({ position: 0, artist: t.artist, title: t.title, album: t.album, duration: t.duration, isrc: null, path: null })
    const f = m.fileId != null ? byId.get(m.fileId) : null
    if (!f || !(m.kind === 'isrc' || m.kind === 'ruta' || m.kind === 'exacto' || m.kind === 'probable')) faltan.push(t)
    else if (buenaCalidad(f)) tenes.push({ artist: t.artist, title: t.title, enPaila: f.rel })
    else {
      const reemplaza = copiaDe(f)
      faltan.push({ ...t, reemplaza })
      mejorar.push({ artist: t.artist, title: t.title, enPaila: f.rel, nota: reemplaza.nota })
    }
  }
  return { faltan, tenes, mejorar }
}
