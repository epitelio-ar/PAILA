// Ordenar e internet, una sola vez (MASTERPLAN-5, 2.2 y etapa 3): después de las carpetas, PAILA pregunta si busca en internet lo
// que falta (el nombre oficial, el disco y la tapa). Con el OK, que queda guardado en la base, corren solos los trabajos de siempre
// (nombres oficiales, MusicBrainz, tapas: ipc/ordenar-internet.ts) y lo seguro se suma a la lista tildado. Lo dudoso también se
// suma, pero sin tildar: queda a la vista en "De internet", no se aplica si no lo tildás y se acepta de una por tipo. Lo que casi
// siempre está mal (el disco y el año de una recopilación) no se propone (`criterioMb`). El género de MusicBrainz entra si llena
// uno vacío (el autor, 13/11). Nada de esto toca archivos: escribe Aplicar.
import type { Db } from './db'
import type { Changes } from './changes'
import { enLetrasLatinas, type MbProposal } from './musicbrainz'
import type { Proposal } from './tagactions'
import type { TidyReview } from '@paila/shared/types'
import type { TidyRule } from '@paila/shared/tidy-profiles'
import { CLAVE_REGLAS_NOMBRES, reglasGuardadas } from './tidy-reglas'
import { apagar, claveCambio } from './revision-apagados'

const CLAVE = 'ordenar.internet'
const CUANDO = 'ordenar.internet.at'
/** Cada cuánto vuelve a buscar sola lo nuevo al entrar a Ordenar (lo ya buscado no se vuelve a pedir). */
export const CADA = 24 * 60 * 60 * 1000

const leer = (db: Db, k: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null
const guardar = (db: Db, k: string, v: string) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(k, v)

/** Qué contestó: 'si' (buscá), 'no' (ahora no) o null (todavía no se le preguntó). */
export function internetElegido(db: Db): 'si' | 'no' | null {
  const v = leer(db, CLAVE)
  return v === 'si' || v === 'no' ? v : null
}

/**
 * Guarda la respuesta. Con el OK, los nombres oficiales pasan a estar entre las reglas de nombres: el perfil de fábrica no la trae,
 * y sin ella lo que encuentra internet no se proponía nunca.
 */
export function elegirInternet(db: Db, si: boolean) {
  guardar(db, CLAVE, si ? 'si' : 'no')
  if (!si) return
  const reglas = reglasGuardadas((k) => leer(db, k))
  if (reglas.includes('oficial')) return
  guardar(db, CLAVE_REGLAS_NOMBRES, JSON.stringify([...reglas, 'oficial' satisfies TidyRule]))
  // las que reglasGuardadas suma sola a las guardadas viejas ya van en la lista: que no se vuelvan a sumar
  for (const k of ['tidy.reglas.dicc', 'tidy.reglas.aprendidas', 'tidy.reglas.vinilo']) guardar(db, k, '1')
}

/** ¿Toca buscar de nuevo? Con el OK y si pasó un día desde la última vez (o nunca terminó una vuelta). */
export function tocaBuscar(db: Db, ahora = Date.now()): boolean {
  if (internetElegido(db) !== 'si') return false
  const at = Number(leer(db, CUANDO) ?? 0)
  return !at || ahora - at >= CADA
}
export const anotarBusqueda = (db: Db, ahora = Date.now()) => guardar(db, CUANDO, String(ahora))

/**
 * El criterio de lo que trae MusicBrainz (docs/pruebas/mp5-internet-dudoso.md, 13/11). Revisado a mano con la base del autor:
 * de un disco "sospechoso" (recopilación, en vivo, remix, pirata) el disco salía bien 1 de cada 24 y el año 7 de cada 28 (es el de
 * la recopilación: "Thriller" 1992, "Comfortably Numb" 2008): no se propone, ni siquiera sin tildar (eran 456 de 472 dudosos). Lo
 * mismo con un disco que por el nombre es una recopilación aunque MusicBrainz no lo marque ("Tektones #3 (Selected By T78)").
 * Confianza alta y disco normal: tildado. Confianza media y disco normal (3 de 4 bien): sin tildar, para aceptar de una por tipo.
 * El género que llena uno vacío, como el resto (el autor, 13/11: varios géneros por tema, uno a la vista; shared/generos.ts). Solo
 * llena lo vacío: nunca pisa un dato (lo escrito a mano manda).
 */
export type QueHacer = 'tildar' | 'dudoso' | 'descartar'
const RECOPILACION = /\b(?:selected by|presents|mixed by|compiled by|vol\.?\s*\d+|volume\s*\d+|#\s?\d+|hits|best of|greatest|collection|essentials|sampler|anthems|clubland|bravo|now that|megamix)\b/i
export const pareceRecopilacion = (album: string | null) => !!album && RECOPILACION.test(album)
export function criterioMb(p: Pick<MbProposal, 'confidence' | 'suspicious' | 'album'>, campo: string, original = false): QueHacer {
  // el género sale de los tags del tema en MusicBrainz, no del disco: un vivo o una recopilación no lo cambian. Llena uno vacío
  // (MusicBrainz nunca pisa): con confianza alta, tildado (el autor, 13/11); media, sin tildar
  if (campo === 'genre') return p.confidence === 'alta' ? 'tildar' : 'dudoso'
  // el año en que salió el tema (no el de la recopilación): sin tildar hasta que una muestra diga que acierta (el autor, 13/11)
  if (campo === 'year' && original) return 'dudoso'
  if (p.suspicious || pareceRecopilacion(p.album)) return 'descartar'
  // si la única edición está en otro alfabeto (la japonesa), su disco y su año no entran tildados aunque la confianza sea alta
  if (!enLetrasLatinas(p.album)) return 'dudoso'
  return p.confidence === 'alta' ? 'tildar' : 'dudoso'
}

/** Lo que trae MusicBrainz, repartido con el criterio: seguro (tildado), dudoso (sin tildar) y lo que no se propone. */
export function deMusicBrainz(props: MbProposal[]): { seguros: Proposal[]; dudosos: Proposal[]; descartados: Proposal[] } {
  const out = { seguros: [] as Proposal[], dudosos: [] as Proposal[], descartados: [] as Proposal[] }
  const lista = { tildar: out.seguros, dudoso: out.dudosos, descartar: out.descartados }
  for (const p of props) for (const f of p.fills) lista[criterioMb(p, f.field, !!f.original)].push({ id: p.fileId, field: f.field, value: f.value, source: 'internet' })
  return out
}

/**
 * Lo que una versión anterior sumó sin tildar y con el criterio de hoy no se propone (los discos y años de recopilaciones): sale de
 * la lista. Solo lo destildado que sigue igual a lo que dijo MusicBrainz: si lo tildaste o lo cambiaste, es tuyo y no se toca.
 * `cache(id)` es lo que MusicBrainz contestó por ese tema (musicbrainz.ts, cached). Devuelve cuántos sacó.
 */
export function limpiarDescartados(db: Db, changes: Changes, cache: (id: number) => Pick<MbProposal, 'confidence' | 'suspicious' | 'album' | 'year'> | null): number {
  const filas = db.prepare(`SELECT p.id, p.file_id AS fileId, p.field, p.after FROM pending_changes p JOIN pending_meta m ON m.file_id = p.file_id AND m.field = p.field
    WHERE m.source = 'internet' AND p.field IN ('album', 'year') AND EXISTS (SELECT 1 FROM revision_apagados ra WHERE ra.clave = 'c|' || p.file_id || '|' || p.field)`).all() as { id: number; fileId: number; field: 'album' | 'year'; after: string | null }[]
  const sacar = filas.filter((f) => { const r = cache(f.fileId); return !!r && r[f.field] === f.after && criterioMb(r, f.field) === 'descartar' }).map((f) => f.id)
  if (sacar.length) changes.discard(sacar)
  return sacar.length
}

/** Los nombres oficiales con confianza media o baja (lo que Arreglar nombres deja "para mirar a mano"). */
export const oficialesDudosos = (review: TidyReview[]): Proposal[] => repartirOficiales(review).dudosos

const letras = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
/** Mismas letras: cambian solo acentos, signos o mayúsculas ("Paso" → "Pasó", "Voyage voyage" → "Voyage, voyage"). */
export const soloAcentosYSignos = (antes: string | null, despues: string) => !!antes?.trim() && antes !== despues && letras(antes) === letras(despues)

/**
 * Los nombres oficiales de confianza media: con las mismas letras (solo acentos y signos) van tildados; si cambia una palabra,
 * sin tildar (el autor, 13/11). Lo escrito a mano igual manda: Changes no deja que lo de internet lo pise (core/confianza.ts).
 */
export function repartirOficiales(review: TidyReview[]): { seguros: Proposal[]; dudosos: Proposal[] } {
  const out = { seguros: [] as Proposal[], dudosos: [] as Proposal[] }
  for (const r of review) {
    if (r.origin !== 'oficial' || r.staged || r.blocked) continue
    out[soloAcentosYSignos(r.from, r.to) ? 'seguros' : 'dudosos'].push({ id: r.id, field: r.field, value: r.to, source: 'oficial' })
  }
  return out
}

/**
 * Suma lo dudoso sin tildar. Solo lo que todavía no está en la lista: si ya está (tildado o no), lo decidió la persona o vino por
 * otro lado, y no se toca. Devuelve cuántos sumó.
 */
export function sumarSinTildar(db: Db, changes: Changes, items: Proposal[]): number {
  const ya = db.prepare('SELECT 1 FROM pending_changes WHERE file_id = ? AND field = ?')
  const nuevos = items.filter((i) => !ya.get(i.id, i.field))
  if (!nuevos.length) return 0
  changes.stageMany(nuevos, 'internet') // lo que no dice de dónde vino, cuenta como de internet (va a su grupo)
  const puestos = nuevos.filter((i) => ya.get(i.id, i.field))
  apagar(db, puestos.map((i) => claveCambio(i.id, i.field)))
  return puestos.length
}
