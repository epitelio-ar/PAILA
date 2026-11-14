// Pistas de dónde salió un archivo, además del sonido: los nombres que tuvo (el de hoy y los de antes en el Historial), lo
// que dicen sus etiquetas (el link de YouTube, el programa que lo armó) y el año. La nota de calidad las junta con lo que
// se midió (core/analysis/grade.ts) para decidir sola, sin mandar a nadie a mirar el espectrograma (decidido el 22/10/2026).
import type { Db } from '../db'
import { textos } from '@paila/shared/idioma'

// Las frases de cada pista (van a la explicación de la nota y se guardan con el análisis; solo se muestran).
const T = textos({
  paginaYoutube: { es: 'una página que baja el audio de YouTube', en: 'a website that downloads audio from YouTube' },
  spotdl: { es: 'spotDL (baja de YouTube con los datos de Spotify)', en: "spotDL (it downloads from YouTube using Spotify's data)" },
  paginaMp3: { es: 'una página de MP3', en: 'an MP3 website' },
  etiquetaYoutube: { es: (k: string) => `Su etiqueta "${k}" tiene el link de YouTube de donde se bajó.`, en: (k: string) => `Its "${k}" tag has the YouTube link it was downloaded from.` },
  etiquetaSitio: { es: (k: string, name: string) => `Su etiqueta "${k}" dice que viene de ${name}.`, en: (k: string, name: string) => `Its "${k}" tag says it comes from ${name}.` },
  ffmpeg: {
    es: (v: string) => `Lo armó ffmpeg (${v}), un conversor que usan las páginas y programas de descarga, no un programa para sacar música de un CD.`,
    en: (v: string) => `It was made by ffmpeg (${v}), a converter used by download websites and programs, not a program for ripping music from a CD.`,
  },
  ripper: { es: (p: string) => `Lo sacó de un CD un programa hecho para eso (${p}).`, en: (p: string) => `It was ripped from a CD by a program made for that (${p}).` },
  tienda: { es: (s: string) => `Viene de una tienda que vende sin pérdida (${s}).`, en: (s: string) => `It comes from a store that sells lossless (${s}).` },
  suNombre: { es: 'Su nombre', en: 'Its name' },
  suTag: { es: (t: string) => `Su tag ("${t}")`, en: (t: string) => `Its tag ("${t}")` },
  nombreAntes: { es: (t: string) => `El nombre que tenía antes ("${t}")`, en: (t: string) => `The name it had before ("${t}")` },
  diceSitio: { es: (quien: string, name: string) => `${quien} dice que viene de ${name}.`, en: (quien: string, name: string) => `${quien} says it comes from ${name}.` },
  esVideo: { es: (quien: string) => `${quien} es el de un video de YouTube.`, en: (quien: string) => `${quien} is the one from a YouTube video.` },
})

/**
 * Lo que se sabe de un archivo fuera del sonido: los nombres (`from`: el del archivo hoy, los de sus tags o uno que tuvo
 * antes) y el año. Las etiquetas del archivo vienen aparte, con la lectura del sonido (`RawAnalysis.meta`).
 */
export interface Clues { names: { text: string; from: 'archivo' | 'tags' | 'antes' }[]; year: number | null }

/** Una pista encontrada, con la frase para el usuario. */
export interface Clue { kind: 'youtube' | 'site' | 'converter' | 'ripper' | 'store'; what: string }

// Páginas y programas de descarga (de YouTube, de VK como slider.kz, de sitios de MP3). Lo que bajan es siempre comprimido.
// (el nombre de cada una se lee al usarlo: va en el idioma de ahora)
const SITES: [RegExp, () => string][] = [
  [/slider\.kz|\bslider\s*kz\b/i, () => 'slider.kz'],
  [/y2mate|ytmp3|yt1s|savefrom|flvto|onlinevideoconverter|mp3juices?|ytmp3\.cc|320ytmp3|notube|ssyoutube|loader\.to|cnvmp3/i, () => T.paginaYoutube],
  [/\bspotdl\b|open\.spotify\.com/i, () => T.spotdl],
  [/soundcloud\.com|\bscdl\b/i, () => 'SoundCloud'],
  [/\bvk\.com|zaycev|muzofond|hitmo|mp3xa|musify|mp3party|mp3-?direct|goldenmp3|freemp3|mp3skull|mp3clan/i, () => T.paginaMp3],
]
// Tiendas y sitios de datos: un link a estos no es un rastro de MP3 (al contrario: venden sin pérdida, o solo dan datos).
const TRUSTED_SITE = /discogs|musicbrainz|bandcamp|beatport|traxsource|junodownload|qobuz|7digital|hdtracks|boomkat|bleep\.com|deezer|apple\.com|itunes|amazon|wikipedia/i
// Programas para sacar la música de un CD tal cual (si lo dicen, el corte es del disco).
const RIPPERS = /\b(?:XLD|X Lossless Decoder|Exact Audio Copy|EAC|dBpoweramp|CUERipper|CUETools|whipper|morituri|cyanrip|cdparanoia|abcde|fre:ac)\b/i
// Tiendas que venden sin pérdida y lo escriben en el archivo.
const STORES = /\b(?:Traxsource|Beatport|Bandcamp|Juno ?Download|Qobuz|7digital|HDtracks|Bleep)\b/i
// ffmpeg (y lo que lo usa adentro: las páginas y programas de descarga, conversores en línea).
const CONVERTER = /^\s*(?:Lavf|Lavc|libavformat|ffmpeg)/i
// Nombres de YouTube: el código del video entre corchetes y lo que se le agrega a los títulos de los videos.
const YT_ID = /[[(]([\w-]{11})[\])]/
const YT_WORDS = /[([]\s*(?:official\s*(?:music\s*|hd\s*|4k\s*)?(?:video|audio|visuali[sz]er)|video\s*oficial|videoclip(?:\s*oficial)?|audio\s*oficial|lyrics?(?:\s*video)?|letra|visuali[sz]er)\s*[)\]]/i
const YT_URL = /youtube\.com|youtu\.be|\byt-?dlp\b|youtube-dl/i

// un código de video tiene minúsculas y números o mayúsculas pegadas ("dQw4w9WgXcQ"); "[Underground]" o "[Rendr-Recs]" no
const isYtId = (s: string) => /[a-z]/.test(s) && (/\d/.test(s) || /[a-z][A-Z]/.test(s))

/** Las pistas que hay en los nombres y en las etiquetas de un archivo, sin repetir. */
export function readClues(clues: Clues | undefined, meta: Record<string, string> | null | undefined): Clue[] {
  const out: Clue[] = []
  const add = (c: Clue) => { if (!out.some((x) => x.kind === c.kind)) out.push(c) }
  const tags = Object.entries(meta ?? {})
  const names = clues?.names ?? []
  // etiquetas
  for (const [k, v] of tags) {
    if (YT_URL.test(v) && !TRUSTED_SITE.test(v)) add({ kind: 'youtube', what: T.etiquetaYoutube(k) })
    for (const [re, name] of SITES) if (re.test(v)) add({ kind: 'site', what: T.etiquetaSitio(k, name()) })
    if (/^(?:encoder|encoded_by|encoded by|software|tsse|isft|encoding_tool)$/i.test(k) && CONVERTER.test(v)) add({ kind: 'converter', what: T.ffmpeg(v.trim()) })
    if (RIPPERS.test(v)) add({ kind: 'ripper', what: T.ripper(v.match(RIPPERS)![0]) })
    if (/^(?:encoder|encoded_by|encoded by|publisher|organization|copyright|comment|description|purl|url|www|wxxx)$/i.test(k) && STORES.test(v)) add({ kind: 'store', what: T.tienda(v.match(STORES)![0]) })
  }
  // nombres (el de hoy y los que tuvo antes)
  const whose = (n: Clues['names'][number]) => (n.from === 'archivo' ? T.suNombre : n.from === 'tags' ? T.suTag(n.text) : T.nombreAntes(n.text))
  for (const n of names) {
    if (TRUSTED_SITE.test(n.text)) continue
    for (const [re, name] of SITES) if (re.test(n.text)) add({ kind: 'site', what: T.diceSitio(whose(n), name()) })
    const id = n.text.match(YT_ID)?.[1]
    if ((id && isYtId(id)) || YT_URL.test(n.text) || YT_WORDS.test(n.text)) add({ kind: 'youtube', what: T.esVideo(whose(n)) })
  }
  return out
}

/** Pistas que dicen que el archivo salió de algo comprimido (YouTube, una página de descarga, ffmpeg). */
export const lossyClues = (cs: Clue[]) => cs.filter((c) => c.kind === 'youtube' || c.kind === 'site' || c.kind === 'converter')
/** Pistas que dicen que salió del disco o de una tienda tal cual. */
export const trustedClues = (cs: Clue[]) => cs.filter((c) => c.kind === 'ripper' || c.kind === 'store')

/**
 * Lo que se sabe de un tema de la biblioteca: su nombre de hoy y los que tuvo (Organizar, Arreglar nombres, títulos y
 * artistas de antes en el Historial), y el año de sus tags.
 */
export function cluesFor(db: Db, fileId: number): Clues {
  const f = db.prepare('SELECT rel_path AS rel, year, title, artist, album FROM files WHERE id = ?').get(fileId) as { rel: string; year: string | null; title: string | null; artist: string | null; album: string | null } | undefined
  if (!f) return { names: [], year: null }
  const base = (rel: string) => rel.split('/').pop()!
  const names: Clues['names'] = [{ text: base(f.rel), from: 'archivo' }]
  for (const t of [f.title, f.artist, f.album]) if (t) names.push({ text: t, from: 'tags' })
  for (const r of db.prepare('SELECT from_rel AS rel FROM moves_log WHERE file_id = ?').all(fileId) as { rel: string }[]) names.push({ text: base(r.rel), from: 'antes' })
  for (const r of db.prepare(`SELECT before FROM journal WHERE file_id = ? AND field IN ('title', 'artist', 'album', 'filename') AND before IS NOT NULL`).all(fileId) as { before: string }[]) names.push({ text: r.before, from: 'antes' })
  const seen = new Set<string>()
  const y = Number((f.year ?? '').slice(0, 4))
  return { names: names.filter((n) => !seen.has(n.text) && !!seen.add(n.text)), year: y >= 1900 && y <= 2100 ? y : null }
}
