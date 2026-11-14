// NAPIA: ¿lo que bajó es el tema que se pidió, y la misma versión? (el autor, 1/11: "al comparar, ¿revisa con la herramienta
// tipo Shazam que sean la misma versión?"). Antes NAPIA solo miraba la calidad y la duración: un en vivo o un remix que duraba
// parecido pasaba, y recién la Bandeja de PAILA se daba cuenta, con el tema ya bajado y la búsqueda terminada. Ahora, apenas
// baja cada tema (control.ts):
// - si viene a reemplazar una copia tuya, se compara su huella acústica con la de tu copia (la que PAILA guardó al
//   analizarla): tiene que ser el mismo audio, como pide la Bandeja para reemplazar;
// - si es un tema que no tenés, se le pregunta a AcoustID qué tema es, y tiene que ser ese artista y ese título.
// Si no, se trata como un trucho: a descartados y otra fuente.
import { decodeFingerprint } from '../analysis/chromaprint'
import { FRAMES_PER_SECOND, bestAlignment, soundRelation, type Alignment } from '../soundmatch'
import { normalize } from '../dupnames'
import type { AcoustHit } from '../online/sources'

export type Parecido = 'mismo' | 'version' | 'otro'

/**
 * Cómo suena lo bajado al lado de tu copia: el mismo audio, otra versión (comparten un pedazo largo: en vivo, remix, otro
 * master) u otro tema. null: no alcanza para decir (huellas de menos de 10 s o rotas).
 */
export function compararHuellas(nueva: string | Uint32Array, durNueva: number | null, tuya: string | Uint32Array, durTuya: number | null): Parecido | null {
  let a: Uint32Array, b: Uint32Array
  try { a = typeof nueva === 'string' ? decodeFingerprint(nueva) : nueva; b = typeof tuya === 'string' ? decodeFingerprint(tuya) : tuya } catch { return null }
  if (a.length < 10 * FRAMES_PER_SECOND || b.length < 10 * FRAMES_PER_SECOND) return null
  // se prueban corrimientos de ±10 s (un tema con más silencio al principio), como los pedidos de la Bandeja (printmatch.ts)
  let al: Alignment = bestAlignment(a, b, 0)
  for (let o = -80; o <= 80; o += 4) { const x = bestAlignment(a, b, o); if (x.matched > al.matched || (x.matched === al.matched && x.sim > al.sim)) al = x }
  const rel = soundRelation(al, durNueva, durTuya, a.length, b.length)
  return rel === 'same' ? 'mismo' : rel === 'version' ? 'version' : 'otro'
}

const limpio = (s: string) => normalize(s).replace(/\s+/g, ' ').trim()
/** "Bad Bunny feat. Drake" contiene a "Bad Bunny"; "Tití me preguntó" es "Titi Me Pregunto". */
const contiene = (a: string, b: string) => { const x = limpio(a), y = limpio(b); return !!x && !!y && (x.includes(y) || y.includes(x)) }

/**
 * Para un tema que no tenés: ¿AcoustID dice que el audio bajado es ese artista y ese título? true: sí (algún resultado con
 * buen puntaje coincide); false: AcoustID lo reconoce con seguridad y es otra cosa; null: no lo conoce o no está seguro (se
 * deja pasar: AcoustID no tiene todo, y un tema raro no tiene por qué fallar).
 */
export function esElPedido(hits: AcoustHit[], artist: string, title: string): boolean | null {
  const seguros = hits.filter((h) => h.score >= 0.8 && h.recordings.length)
  if (!seguros.length) return null
  const coincide = seguros.some((h) => h.recordings.some((r) => contiene(r.title, title) && (!artist.trim() || r.credit.some((c) => contiene(c.name, artist)))))
  return coincide
}
