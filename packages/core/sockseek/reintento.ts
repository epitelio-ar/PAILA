// NAPIA: otra búsqueda para lo que "no se encontró". Puro (texto → texto), con tests en tests/napia-tanda.test.ts.
// En Soulseek los archivos casi nunca se llaman como en Spotify: "Con Calma (feat. Snow)", "Ship of Fools - 2009 Remaster"
// o "Chris Lake, Fisher" no aparecen así. Para cada tema se proponen, de menos a más, otras formas de buscarlo, cada una
// diciendo qué cambió, y la persona elige:
// - "Sin agregados": sin el "feat." (en el título o en el artista) ni "(Remastered 2011)", "(Original Mix)", "(Album Version)"…
// - "Solo título y artista principal": además, solo el primer artista y sin lo que va entre paréntesis (salvo la versión).
// - "La versión original": si era un remix, edit, en vivo o acústico, el tema original (y sin el remixador en el artista).
// Las que dan la misma búsqueda que la original (o que otra anterior) no se proponen.
import { fold, loose } from '../names'
import { versionRe } from '../versionwords'
import type { Busqueda, TipoVariante, Variante } from '@paila/shared/napia'
import { textos } from '@paila/shared/idioma'

export type { Busqueda, TipoVariante, Variante }

/** El nombre de cada variante (se lee en el idioma de ahora). La búsqueda en sí (artista y título) no se traduce. */
export const ETIQUETA: Record<TipoVariante, string> = textos({
  limpia: { es: 'Sin agregados', en: 'Without extras' },
  principal: { es: 'Solo título y artista principal', en: 'Just the title and main artist' },
  original: { es: 'La versión original', en: 'The original version' },
})

/** Qué cambió en cada variante (lo que va entre «» es parte del nombre del tema: no se traduce). */
const T = textos({
  sin: { es: (x: string) => `Sin ${x}`, en: (x: string) => `Without ${x}` },
  sinEnArtista: { es: (x: string) => `Sin ${x} en el artista`, en: (x: string) => `Without ${x} in the artist` },
  solo: { es: (p: string, resto: string) => `Solo ${p} como artista (sin ${resto})`, en: (p: string, resto: string) => `Only ${p} as the artist (without ${resto})` },
  original: { es: (vs: string[]) => `Sin ${vs.join(' ni ')}: busca el tema original`, en: (vs: string[]) => `Without ${vs.join(' or ')}: searches for the original track` },
  sinRemixador: {
    es: (x: string) => `Sin ${x} en el artista (es quien hizo la versión)`,
    en: (x: string) => `Without ${x} in the artist (they made that version)`,
  },
})

const FEAT = /^(?:feat\.?|ft\.?|featuring|with|con)\s/
/** Lo que se agrega a un título y no cambia el tema: remasters, años, "explicit", "Original Mix" (Beatport), "Album Version"… */
const RUIDO = /^(?:(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?(?:stereo\s+)?re ?master(?:ed)?(?:\s+(?:version|edition))?(?:\s+\d{4})?|\d{4}(?:\s+version)?|explicit(?:\s+version)?|clean(?:\s+version)?|original(?:\s+mix|\s+version)?|album(?:\s+version|\s+edit)?|single(?:\s+version)?|lp\s+version|mono|stereo|mono\s+version|stereo\s+version|bonus(?:\s+track)?|deluxe(?:\s+edition|\s+version)?|(?:\d+(?:st|nd|rd|th)\s+)?anniversary(?:\s+edition)?|from\s.+|taken\s+from\s.+|del\s+film\s.+|de\s+la\s+pelicula\s.+|banda\s+sonora.*|soundtrack.*)$/
/** Otra versión del tema: remix, edit, en vivo, acústico… ("la versión original" los saca; core/versionwords.ts). */
const VERSION = versionRe(['mezcla', 'vivo', 'grabacion', 'tipo'], { except: ['radio'] })
/** Desde la palabra de versión hasta el final: lo de adelante es quien la hizo ("Furz Reworx" → "Furz"). */
const PALABRA_VERSION = new RegExp(`\\s*${versionRe(['mezcla'], { except: ['extended', 'club', 'radio'] }).source}.*$`, 'i')
/** Artistas en una misma celda: "Chris Lake, Fisher", "Bad Bunny x Jhay Cortez", "A feat. B". No "&" ni "y": suelen ser dúos. */
const SEP_ARTISTAS = /\s*(?:,|;|\s\/\s|\s+x\s+|\s+vs\.?\s+|\s+(?:feat\.?|ft\.?|featuring)\s+)\s*/i
const FEAT_ARTISTA = /\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i

type Clase = 'feat' | 'ruido' | 'version' | 'otro'
interface Grupo { texto: string; dentro: string; clase: Clase }

const plano = (s: string) => fold(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
function clase(dentro: string): Clase {
  const f = plano(dentro)
  if (FEAT.test(fold(dentro) + ' ')) return 'feat'
  if (!f || RUIDO.test(f)) return 'ruido'
  if (VERSION.test(f)) return 'version'
  return 'otro'
}

/** El título partido: lo principal y cada agregado (entre paréntesis o corchetes, después de " - " o un "feat." suelto). */
function partes(title: string): { base: string; grupos: Grupo[] } {
  const [head, ...colas] = title.split(/\s+[-–—]\s+/)
  const grupos: Grupo[] = []
  let base = head.replace(/\s*[([{]([^)\]}]*)[)\]}]/g, (m, g: string) => { grupos.push({ texto: m.trim(), dentro: g, clase: clase(g) }); return ' ' })
  const suelto = base.match(/\s+((?:feat\.?|ft\.?|featuring)\s+.+)$/i)
  if (suelto) { grupos.push({ texto: suelto[1].trim(), dentro: suelto[1], clase: 'feat' }); base = base.slice(0, suelto.index) }
  for (const c of colas) grupos.push({ texto: `- ${c.trim()}`, dentro: c, clase: clase(c) })
  return { base: base.replace(/\s+/g, ' ').trim(), grupos }
}

const armar = (base: string, grupos: Grupo[]) => [base, ...grupos.map((g) => (g.texto.startsWith('- ') ? g.texto : `(${g.dentro.trim()})`))].join(' ').trim()
const comillas = (s: string) => `«${s}»`
const nombres = (artist: string) => artist.split(SEP_ARTISTAS).map((s) => s.trim()).filter(Boolean)

/** Otras formas de buscar un tema que no se encontró, de la más parecida a la más distinta (sin repetidas). */
export function variantes(t: Busqueda): Variante[] {
  const { base, grupos } = partes(t.title)
  if (!base) return []
  const out: Variante[] = []
  const vistas = new Set([loose(`${t.artist}|${t.title}`)])
  const sumar = (tipo: TipoVariante, artist: string, title: string, cambios: string[]) => {
    const k = loose(`${artist}|${title}`)
    if (!title.trim() || !cambios.length || vistas.has(k)) return
    vistas.add(k)
    out.push({ tipo, etiqueta: ETIQUETA[tipo], artist, title, cambios })
  }

  // sin agregados: sin feat. (título y artista) ni remasters y parecidos
  const featArtista = t.artist.match(FEAT_ARTISTA)
  const artistaLimpio = featArtista ? t.artist.slice(0, featArtista.index).trim() : t.artist.trim()
  const sacados = grupos.filter((g) => g.clase === 'feat' || g.clase === 'ruido')
  const quedan = grupos.filter((g) => g.clase === 'version' || g.clase === 'otro')
  const cambiosLimpia = [...sacados.map((g) => T.sin(comillas(g.texto))), ...(featArtista ? [T.sinEnArtista(comillas(featArtista[0].trim()))] : [])]
  sumar('limpia', artistaLimpio, armar(base, quedan), cambiosLimpia)

  // solo título y artista principal (la versión, si hay, se queda: es otro tema)
  const todos = nombres(artistaLimpio)
  const principal = todos[0] ?? artistaLimpio
  const versiones = quedan.filter((g) => g.clase === 'version')
  const otros = quedan.filter((g) => g.clase === 'otro')
  sumar('principal', principal, armar(base, versiones), [
    ...cambiosLimpia,
    ...otros.map((g) => T.sin(comillas(g.texto))),
    ...(todos.length > 1 ? [T.solo(comillas(principal), todos.slice(1).map(comillas).join(', '))] : []),
  ])

  // la versión original: sin remix, edit, en vivo… y sin el remixador en el artista
  if (versiones.length) {
    const remixadores = new Set(versiones.map((g) => loose(g.dentro.replace(PALABRA_VERSION, ''))).filter(Boolean))
    const sinRemixador = todos.filter((n) => !remixadores.has(loose(n)))
    const artista = sinRemixador.length && sinRemixador.length < todos.length ? sinRemixador.join(', ') : artistaLimpio
    sumar('original', artista, armar(base, otros), [
      T.original(versiones.map((g) => comillas(g.texto))),
      ...cambiosLimpia,
      ...(artista !== artistaLimpio ? [T.sinRemixador(todos.filter((n) => remixadores.has(loose(n))).map(comillas).join(', '))] : []),
    ])
  }
  return out
}

/** La que se propone de entrada: la primera que no cambia de versión (si era un remix, la persona lo quería así). */
export const sugerida = (vs: Variante[]): Variante | null => vs.find((v) => v.tipo !== 'original') ?? null
