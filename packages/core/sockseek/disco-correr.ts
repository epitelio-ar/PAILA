// "Un disco", el primer intento (DECISIONES 07/11): la carpeta entera de una sola persona. sockseek busca el disco y baja la carpeta que
// tiene la cantidad exacta de temas de la edición elegida (disco.ts, filaCarpeta). Lo que llega pasa por el control de calidad de
// siempre (lo trucho va a <lista>/descartados) y por los nombres de la lista; lo bueno queda en la carpeta "Artista - Disco" y se anota
// en el índice de la lista: después NAPIA baja tema por tema solo lo que falta (sockseek saltea lo anotado). Se prueba con el sockseek
// de mentira (tests/napia-disco.test.ts).
import fs from 'node:fs'
import path from 'node:path'
import { AUDIO_EXT } from '../files'
import { anotarBajados, DESCARTADOS, entregar, rutasTrabajo } from './carpetas'
import { emparejar, filaCarpeta, nombreDisco } from './disco'
import type { NapiaList, IntentoCarpeta, TemaDisco } from '@paila/shared/napia'

export interface CorridaCarpeta { done: Promise<{ cancelled: boolean }>; cancel: () => Promise<unknown> }

export interface CarpetaDeps {
  /** La carpeta de datos de NAPIA (ahí trabaja sockseek). */
  datos: string
  /** Dónde queda la lista ("Música\NAPIA\Plan B - Love and Sex"). */
  carpeta: string
  /** Corre sockseek con ese CSV, esa carpeta de trabajo y ese índice (en la app: los argumentos de siempre más ARGS_CARPETA). */
  correr: (csv: string, trabajo: string, indice: string) => CorridaCarpeta
  /** La revisión de la calidad (null: sin ffmpeg, pasa sin revisar). `motivo`: por qué es trucho, o null si sirve. */
  revisar?: ((archivo: string) => Promise<{ motivo: string | null }>) | null
  /** El nombre con que llega (los tags de la lista): core/sockseek/nombres.ts. */
  arreglar?: (pedido: { artist: string; title: string }, archivo: string) => Promise<string | null>
  /** Cortar: si vuelve true, no sigue. */
  cortado?: () => boolean
  /** Lo que se va viendo ("Buscando la carpeta entera…", "3 de 12 llegaron"). */
  onCambio?: (i: IntentoCarpeta) => void
}

const audios = (dir: string): string[] => {
  try { return (fs.readdirSync(dir, { recursive: true }) as string[]).map((f) => path.join(dir, String(f))).filter((f) => AUDIO_EXT.has(path.extname(f).slice(1).toLowerCase()) && fs.statSync(f).isFile()) } catch { return [] }
}
const CABEZA = 'filepath,artist,album,title,length,tracktype,state,failurereason\n'

/** El primer intento de un disco. Devuelve cuántos llegaron bien y cuántos truchos, de cuántos tiene la edición. */
export async function bajarCarpetaEntera(list: NapiaList, d: CarpetaDeps): Promise<IntentoCarpeta> {
  const disco = list.disco!
  const oficial: TemaDisco[] = list.tracks.map((t, i) => ({ n: i + 1, artist: t.artist, title: t.title, duration: t.duration }))
  const nombre = `${nombreDisco(disco.artista, disco.titulo)} - carpeta entera`
  const rt = rutasTrabajo(d.datos, nombre)
  fs.mkdirSync(rt.carpeta, { recursive: true }); fs.mkdirSync(path.dirname(rt.indice), { recursive: true })
  const csv = path.join(d.datos, 'listas', `${nombre}.csv`)
  fs.mkdirSync(path.dirname(csv), { recursive: true })
  fs.writeFileSync(csv, filaCarpeta(disco.artista, disco.titulo, oficial.length))
  const intento: IntentoCarpeta = { llegaron: 0, truchos: 0, de: oficial.length }
  d.onCambio?.(intento)
  const r = d.correr(csv, rt.trabajo, rt.indice)
  const fin = await r.done
  try {
    if (fin.cancelled || d.cortado?.()) return intento
    const pares = emparejar(oficial, audios(rt.carpeta), disco.artista)
    const entregados: { artist: string; title: string; album: string; duration: number | null; path: string }[] = []
    for (const tema of oficial) {
      const f = pares.get(tema.n)
      if (!f || d.cortado?.()) continue
      const rev = d.revisar ? await d.revisar(f).catch(() => ({ motivo: null })) : { motivo: null }
      if (rev.motivo) { entregar(f, path.join(d.carpeta, DESCARTADOS)); intento.truchos++; d.onCambio?.(intento); continue }
      const como = d.arreglar ? await d.arreglar(tema, f).catch(() => null) : null
      entregados.push({ artist: tema.artist, title: tema.title, album: disco.titulo, duration: tema.duration, path: entregar(f, d.carpeta, como) })
      intento.llegaron++; d.onCambio?.(intento)
    }
    // al índice de la lista: tema por tema, sockseek saltea lo que ya llegó
    const indiceLista = rutasTrabajo(d.datos, list.name).indice
    if (entregados.length) {
      fs.mkdirSync(path.dirname(indiceLista), { recursive: true })
      if (!fs.existsSync(indiceLista)) fs.writeFileSync(indiceLista, CABEZA)
      anotarBajados(indiceLista, entregados)
    }
    return intento
  } finally {
    // lo que sobró de la carpeta (bonus, tapas, lo que no se pareció a ningún tema) y el pedido: fuera, era solo para este intento
    if (!fin.cancelled) for (const x of [rt.carpeta, rt.indice, csv]) fs.rmSync(x, { recursive: true, force: true })
  }
}

/** La lista de un disco para la tanda: los temas oficiales, con el disco y la duración (así se busca mejor tema por tema). */
export function listaDeDisco(disco: NapiaList['disco'] & object, temas: TemaDisco[]): NapiaList {
  return { name: nombreDisco(disco.artista, disco.titulo), source: disco.edicion.fuente === 'musicbrainz' ? 'MusicBrainz' : 'Deezer', skipped: [], disco,
    tracks: temas.map((t) => ({ artist: t.artist, title: t.title, album: disco.titulo, duration: t.duration })) }
}

