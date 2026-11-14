// "Un disco" en NAPIA (DECISIONES 07/11): la lista oficial del disco y lo que hace falta para bajarlo entero. Puro salvo `pedir` (el pedido
// a internet, que pone quien llama): se prueba con respuestas guardadas (tests/napia-disco.test.ts).
// - `buscarDisco` / `buscarEdiciones`: MusicBrainz (reintenta si contesta 503) (las ediciones de verdad: país, formato, año) y Deezer (lo que hay en digital), sin repetir.
// - `sugerida` y `claseEdicion`: con varias ediciones, cuál se parece más a lo escrito y cuál es la original, la remasterizada o la de lujo.
// - `temasDe`: la lista oficial de una edición, con la duración (mejora la búsqueda en Soulseek).
// - `filaCarpeta`: el pedido a sockseek de la carpeta entera ("rows without a title are album downloads", con la cantidad exacta de temas).
// - `emparejar`: qué archivo de la carpeta que llegó es cada tema de la lista oficial (por el título, sin número ni artista adelante).
import path from 'node:path'
import { loose } from '../names'
import { listFileName } from './args'
import type { BusquedaDisco, EdicionDisco, TemaDisco } from '@paila/shared/napia'

/** Pide un JSON a internet (en la app, con el nombre de PAILA y buenos modales con MusicBrainz). */
export type Pedir = (url: string) => Promise<unknown>

const MB = 'https://musicbrainz.org/ws/2'
const DZ = 'https://api.deezer.com'
const q = (s: string) => s.replace(/"/g, '')

type MbRelease = { id: string; title: string; date?: string; country?: string; status?: string; disambiguation?: string; 'track-count'?: number; media?: { format?: string; 'track-count'?: number }[]
  'artist-credit'?: { name: string }[]; 'release-group'?: { 'primary-type'?: string } }
type DzAlbum = { id: number; title: string; nb_tracks?: number; record_type?: string; artist?: { name: string }; release_date?: string }

/**
 * "Remasterizado 2007", "(Remastered)", "- 2011 Remaster" pegado al final de un título: se saca (del disco y de cada tema; en Soulseek
 * se busca mejor sin eso) y, en el disco, queda dicho en la etiqueta de la edición ("Remasterizada"). Soda Stereo, Canción animal (13/11).
 */
const REMASTER_FIN = /\s*[-–([]?\s*(?:(?:19|20)\d{2}\s+)?remaster(?:ed|izad[oa])?(?:\s+(?:version|versi[oó]n|(?:19|20)\d{2}))*\s*[)\]]?\s*$/i
export const sinRemaster = (t: string) => { const x = t.replace(REMASTER_FIN, '').trim(); return x || t }
/** El título sin el "Remastered" pegado; si lo tenía, la edición es una remasterizada. */
const limpio = (t: string): { titulo: string; clase?: 'remaster' } => { const x = sinRemaster(t); return x === t ? { titulo: t } : { titulo: x, clase: 'remaster' } }

/** MusicBrainz contesta 503 cuando se le pide seguido (también si otra NAPIA o PAILA acaba de preguntar): se espera y se prueba otra vez. */
async function conReintento(pedir: Pedir, url: string, esperar: (ms: number) => Promise<void>, veces = 3): Promise<unknown> {
  for (let i = 1; ; i++) {
    try { return await pedir(url) } catch (e) { if (i >= veces || !/\b(503|429)\b/.test((e as Error).message)) throw e; await esperar(1500 * i) }
  }
}
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Las ediciones de "artista - disco", primero las de MusicBrainz (oficiales, de la más vieja a la más nueva), después las de Deezer.
 * `sinMusicbrainz`: MusicBrainz no contestó (ni reintentando): puede haber más ediciones que las de Deezer, y la pantalla no elige sola.
 */
export async function buscarDisco(artista: string, titulo: string, pedir: Pedir, esperar = dormir): Promise<BusquedaDisco> {
  const out: EdicionDisco[] = []
  let sinMusicbrainz = false
  try {
    const r = await conReintento(pedir, `${MB}/release/?query=${encodeURIComponent(`artist:"${q(artista)}" AND release:"${q(titulo)}"`)}&fmt=json&limit=15`, esperar) as { releases?: MbRelease[] }
    // de la más vieja a la más nueva (la primera suele ser la original)
    for (const x of [...(r.releases ?? [])].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))) {
      if (x.status && x.status !== 'Official') continue
      const temas = x['track-count'] ?? (x.media ?? []).reduce((a, m) => a + (m['track-count'] ?? 0), 0)
      if (!temas) continue
      const formatos = [...new Set((x.media ?? []).map((m) => m.format).filter((f): f is string => !!f))]
      out.push({ fuente: 'musicbrainz', id: x.id, artista: x['artist-credit']?.map((a) => a.name).join(' & ') || artista, ...limpio(x.title), anio: x.date?.slice(0, 4) || null,
        pais: x.country ?? null, formato: formatos.join(' + ') || null, temas, tipo: x['release-group']?.['primary-type'] ?? null, nota: x.disambiguation || null })
    }
  } catch { sinMusicbrainz = true /* queda Deezer, y se avisa */ }
  try {
    const r = await pedir(`${DZ}/search/album?q=${encodeURIComponent(`artist:"${q(artista)}" album:"${q(titulo)}"`)}`) as { data?: DzAlbum[] }
    const dz = (r.data ?? []).slice(0, 8).filter((x) => x.nb_tracks)
    // la búsqueda de Deezer no trae el año: lo dice cada disco
    const anios = await Promise.all(dz.map((x) => (x.release_date ? x.release_date : pedir(`${DZ}/album/${x.id}`).then((d) => (d as DzAlbum).release_date ?? null, () => null))))
    dz.forEach((x, i) => out.push({ fuente: 'deezer', id: String(x.id), artista: x.artist?.name ?? artista, ...limpio(x.title), anio: anios[i]?.slice(0, 4) || null, pais: null, formato: 'Digital', temas: x.nb_tracks!, tipo: x.record_type ?? null }))
  } catch { /* sin Deezer */ }
  // solo las que se parecen a lo pedido (MusicBrainz trae también los que se llaman parecido), sin los "2 en 1" (dos discos juntos)
  // sin repetidas: Deezer suele tener la misma edición dos veces ("Love And Sex" y "Love and Sex")
  const pedido = loose(sinRemaster(titulo)), vistas = new Set<string>()
  const eds = out.filter((e) => {
    const k = [e.fuente, loose(e.titulo), e.anio, e.pais, e.formato, e.temas, e.clase].join('|')
    if (vistas.has(k)) return false
    vistas.add(k)
    if (e.titulo.includes('/') && !titulo.includes('/')) return false
    return loose(e.titulo).includes(pedido) || pedido.includes(loose(e.titulo))
  })
  // con varias, se dice cuál es cuál y cuál se parece más a lo escrito (sin elegirla)
  const s = eds.length > 1 ? sugerida(eds, artista, titulo) : -1
  return { ediciones: eds.map((e, i) => ({ ...e, clase: e.clase ?? claseEdicion(e, eds), ...(i === s ? { sugerida: true } : {}) })), sinMusicbrainz }
}

/** Solo las ediciones (ver `buscarDisco`). */
export const buscarEdiciones = async (artista: string, titulo: string, pedir: Pedir, esperar = dormir) => (await buscarDisco(artista, titulo, pedir, esperar)).ediciones

/** La lista oficial de una edición, en orden (con el disco 2 a continuación del 1). */
export async function temasDe(e: EdicionDisco, pedir: Pedir): Promise<TemaDisco[]> {
  if (e.fuente === 'musicbrainz') {
    const r = await pedir(`${MB}/release/${e.id}?inc=recordings+artist-credits&fmt=json`) as { media?: { tracks?: { title: string; length?: number | null; 'artist-credit'?: { name: string }[] }[] }[] }
    const ts = (r.media ?? []).flatMap((m) => m.tracks ?? [])
    return ts.map((t, i) => ({ n: i + 1, artist: t['artist-credit']?.map((a) => a.name).join(' & ') || e.artista, title: sinRemaster(t.title), duration: t.length ? Math.round(t.length / 1000) : null }))
  }
  const r = await pedir(`${DZ}/album/${e.id}`) as { tracks?: { data?: { title: string; duration?: number; artist?: { name: string } }[] } }
  return (r.tracks?.data ?? []).map((t, i) => ({ n: i + 1, artist: t.artist?.name ?? e.artista, title: sinRemaster(t.title), duration: t.duration ?? null }))
}

/** El nombre de la lista y de su carpeta: "Plan B - Love and Sex". */
export const nombreDisco = (artista: string, titulo: string) => listFileName(`${artista} - ${titulo}`)

/** El CSV para pedirle a sockseek la carpeta entera de una persona: una fila sin título es un disco, con la cantidad exacta de temas. */
export const COLUMNA_CANTIDAD = 'TrackCount'
export function filaCarpeta(artista: string, titulo: string, temas: number): string {
  const c = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return `Artist,Title,Album,${COLUMNA_CANTIDAD}\r\n${c(artista)},,${c(titulo)},${temas}\r\n`
}

/** Lo que se le suma a sockseek para la carpeta entera: la columna con la cantidad, y que todos los archivos cumplan la calidad pedida. */
export const ARGS_CARPETA = ['--album-track-count-col', COLUMNA_CANTIDAD, '--strict-album-quality']

/** "07 - Plan B - Si No Le Contesto (Remix).flac" → "sinolecontestoremix" (sin número, sin el artista, sin la extensión). */
export function tituloDeArchivo(archivo: string, artista: string): string {
  let s = path.basename(archivo, path.extname(archivo)).replace(/^\s*(?:\d{1,2}[-.]?)?\d{1,2}\s*[-._)]?\s*/, '')
  const a = artista.toLowerCase()
  if (s.toLowerCase().startsWith(a)) s = s.slice(a.length).replace(/^\s*[-–_]\s*/, '')
  return loose(s)
}

/**
 * Qué archivo es cada tema de la lista oficial: el mismo título (o uno que lo contiene, por un "(Remastered)" de más). Cada archivo
 * va a un solo tema y cada tema a un solo archivo; lo que no se parece a ninguno (un bonus, una tapa) queda afuera.
 */
export function emparejar(oficial: TemaDisco[], archivos: string[], artista: string): Map<number, string> {
  const out = new Map<number, string>(), usados = new Set<string>()
  const t = archivos.map((f) => ({ f, k: tituloDeArchivo(f, artista) }))
  for (const exacto of [true, false]) {
    for (const tema of oficial) {
      if (out.has(tema.n)) continue
      const k = loose(tema.title)
      const hit = t.find((x) => !usados.has(x.f) && x.k && (exacto ? x.k === k : Math.min(x.k.length, k.length) >= 4 && (x.k.startsWith(k) || k.startsWith(x.k))))
      if (hit) { out.set(tema.n, hit.f); usados.add(hit.f) }
    }
  }
  return out
}

// Varias ediciones (el autor, 13/11): NAPIA no elige sola. Lista cada una con año y cantidad de temas, marca como sugerida la que más
// se parece a lo que se escribió y no baja nada hasta que la persona elige.
const sinTildes = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const VACIAS = new Set(['the', 'and', 'a', 'el', 'la', 'los', 'las', 'y', 'de', 'of'])
const palabras = (s: string) => sinTildes(s).split(/[^a-z0-9]+/).filter((w) => w && !VACIAS.has(w))
const LUJO = /\b(deluxe|lujo|expanded|special|especial|anniversary|aniversario|super)\b/, REMAS = /\b(remaster(ed|izad[oa])?|reissue|reedicion)\b/
const DE_LUJO = { test: (t: string) => LUJO.test(sinTildes(t)) }, REMASTER = { test: (t: string) => REMAS.test(sinTildes(t)) }

/** El índice de la edición que más se parece a lo escrito (las palabras que faltan pesan más que las de más; si empatan, la más vieja). */
export function sugerida(eds: EdicionDisco[], artista: string, titulo: string): number {
  if (!eds.length) return -1
  const pedidas = new Set(palabras(titulo)), art = loose(artista)
  const puntos = (e: EdicionDisco) => {
    const tiene = new Set(palabras(e.titulo))
    const faltan = [...pedidas].filter((w) => !tiene.has(w)).length, sobran = [...tiene].filter((w) => !pedidas.has(w)).length
    const a = loose(e.artista), otroArtista = art && !(a.includes(art) || art.includes(a)) ? 1 : 0
    return faltan * 3 + sobran + otroArtista * 2
  }
  let mejor = 0
  eds.forEach((e, i) => {
    const b = eds[mejor], d = puntos(e) - puntos(b)
    if (d < 0 || (d === 0 && (e.anio ?? '9999') < (b.anio ?? '9999'))) mejor = i
  })
  return mejor
}

/** Qué clase de edición es, para decirlo en palabras: la original (la más vieja sin agregados), una remasterizada o una de lujo. */
export function claseEdicion(e: EdicionDisco, eds: EdicionDisco[]): 'original' | 'remaster' | 'deLujo' | null {
  if (e.clase === 'remaster' || e.clase === 'deLujo') return e.clase
  if (DE_LUJO.test(e.titulo)) return 'deLujo'
  if (REMASTER.test(e.titulo)) return 'remaster'
  // la primera sin agregados de las más viejas (MusicBrainz ya viene de la más vieja a la más nueva, por fecha entera)
  const lisas = eds.filter((x) => !x.clase && !DE_LUJO.test(x.titulo) && !REMASTER.test(x.titulo) && x.anio)
  if (eds.length < 2 || !lisas.length) return null
  const anio = lisas.reduce((m, x) => (x.anio! < m ? x.anio! : m), lisas[0].anio!)
  return lisas.find((x) => x.anio === anio) === e ? 'original' : null
}
