// Reglas de nombres para "Arreglar nombres y tags": funciones puras (texto → texto), sin base ni archivos.
// Cada regla salió de un error real visto en la corrida supervisada del 20/10/2026 sobre una biblioteca real
// (docs/archivo/pruebas/2026-10-20-arreglar-nombres.md) y tiene su test en tests/names.test.ts.
import { changeCase, stripJunk } from './tagactions'
import { versionRe } from './versionwords'
import { textos } from '@paila/shared/idioma'

// Los mismos nombres (artistas, carpetas) se comparan cientos de miles de veces en una biblioteca grande: se recuerdan.
const folded = new Map<string, string>()
/** Para comparar nombres: sin acentos, sin mayúsculas, sin apóstrofos y con un solo espacio ("Champion's" = "champions"). */
export const fold = (s: string) => {
  let f = folded.get(s)
  if (f == null) {
    f = s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’'`´]/g, '').replace(/\s+/g, ' ').trim()
    if (folded.size >= 200_000) folded.clear()
    folded.set(s, f)
  }
  return f
}
/** Más flojo todavía: solo letras y números ("will.i.am" = "will i am"). Sirve para reconocer, no para agrupar. */
export const loose = (s: string) => fold(s).replace(/[^\p{L}\p{N}]/gu, '')

// Cómo terminan las páginas de descarga: las genéricas y las de país ("LanzamientosMp3.es", "FlowCumbiero.com.ar"; punto 1 real
// del 24/10). Sin las que también cierran un nombre con puntos: "will.i.am", "Let.It.Be", "Just.Do.It" ("Mr.Kitty" y "Bob.Dylan"
// no terminan en ninguna).
const TLD = '(?:com|net|org|info|biz|app|xyz|online|site|mobi|tv|fm|ws|su|is|cc|me|io|to|kz|ru|co|ar|es|mx|cl|uy|pe|ve|ec|bo|py|br|pt|fr|de|uk|eu|pl|ua|nl)'
// Prefijos de páginas de descarga que quedan pegados al nombre ("y2mate.com - Artista - Tema").
const SITE_PREFIX = new RegExp(String.raw`^\s*(?:www\.)?[\w-]+\.${TLD}\s*[-–_]\s*`, 'i')
const SITE = new RegExp(String.raw`^\s*[[(]?\s*(?:https?:\/\/)?(?:[\w-]+\.)+${TLD}(?:\.\w{2})?(?:[/_]\S*)?\s*[\])]?\s*$`, 'i')
/** Saca la página de descarga pegada al principio ("y2mate.com - "). */
export const stripSitePrefix = (v: string) => v.replace(SITE_PREFIX, '')
/**
 * ¿Es solo el nombre de una página ("m.youtube.com", "[Www.FlowCumbiero.Com.Ar]") o un "no sé" de otro programa
 * ("Unknown Artist", "Artista sconosciuto")? Eso no es un artista: cuenta como vacío.
 */
export const isSite = (v: string) =>
  SITE.test(v)
  || /^\s*https?[:_]\/?\/?_*/i.test(v) // "http___vk.com_usuario": una dirección con los signos cambiados por "_"
  // "www.delirandocumbia.ya.st" (cualquier terminación) y un mail ("dj.ejemplo@correo.com"): Organizar armaba carpetas con
  // esos nombres (repaso de criterios del 24/10); "vk.com/RealDJingNN", con la ruta, lo agarra la de arriba
  || /^\s*[[(]?\s*www\.[\w-]+(?:\.[\w-]+)+\S*\s*[\])]?\s*$/i.test(v)
  || /^\s*[\w.+-]+@[\w-]+(?:\.[\w-]+)+\s*$/.test(v)
  || isPlaceholder(v)
/** ¿Es un código de catálogo de un sello ("AL046", "FUN007")? Va adelante en algunos nombres y no es el artista. */
export const isCatalog = (v: string) => /^[A-Z]{2,6}\d{2,4}$/.test(v.trim())
/**
 * Lo que pone un programa cuando no sabe ("Unknown Artist", "Álbum desconocido", "Album", "Untitled"). El Reproductor de Windows le
 * pega la fecha, a veces cortada: "Álbum desconocido (03/05/2006 16:34:34)", "Álbum desconocido (14/12/2005". También cuenta
 * (punto 1 real del 24/10: Organizar armaba "El Bordo/2006 - Álbum desconocido (03_05_2006 16_34_34)/"). Lo usa también
 * core/albums.ts (realAlbum: Tapas, Discos completos, Duplicados y Géneros).
 */
export const isPlaceholder = (v: string) =>
  // "Track11", "Pista 12": un título que es un "no sé" (corrida supervisada de Ordenar, 13/11)
  /^\s*(?:<?unknown(?: artist| album)?>?|(?:artista?|[áa]lbum) (?:desconocid[oa]|sconosciuto)|desconocid[oa]|artista sconosciuto|album|untitled|sin t[íi]tulo|track\s*\d{1,3}|pista\s*\d{1,3})\s*(?:\(.*)?$/i.test(v)
  || /^\s*(?:unknown (?:artist|album)|(?:artista?|[áa]lbum) (?:desconocid[oa]|sconosciuto))\b/i.test(v) // con lo que venga después

/**
 * Limpia el nombre de un archivo (sin carpeta ni extensión) antes de leerle artista y título:
 * página de descarga al principio, basura de YouTube, "(1)" de copia, "_mp3" pegado, corazones, corchetes que envuelven todo
 * y guiones con espacio de un solo lado ("Tema- Artista", "Dj kass -SCOOBY").
 * Los espacios dobles se conservan: marcan caracteres que Windows no deja usar y sirven para leer el nombre.
 */
export function cleanBase(name: string): string {
  // nombres "de escena", sin espacios: "01-flowanastasia_and_nymfo-river_flows" → "01 - flowanastasia and nymfo - river flows"
  if (!/\s/.test(name) && name.includes('_') && name.includes('-')) name = name.replace(/_/g, ' ').replace(/-/g, ' - ')
  let s = name.replace(SITE_PREFIX, '').replace(/^(?:cd|disc|disco)\s*\d{1,2}\s+(?=\d{1,3}\b)/i, '') // "Cd2 05 - Cindy Lauper - …"
  s = s.replace(/[♥♡★☆✰♪♫♬❤]/gu, ' ')
  s = stripJunk(s, true)
  s = s.replace(/\s*\(\d\)$/, '') // "Tema (1)": copia hecha por el navegador o Windows
  s = s.replace(/\s*-\s*(?:copia|copy)(?:\s*\(\d+\))?$/i, '')
  s = s.replace(/[_ ]mp3$/i, '') // "Cuando Vendran_mp3" (el ".mp3" de verdad, como "Jagger.mp3", lleva punto y no se toca)
  s = s.replace(/^\[\s*(.+?)\s*\]$/, '$1') // "[ affkt - parafernalia ]"
  // "los redondos- a brillar", "Dj kass -SCOOBY" (solo si no hay otro " - ": en "Pity Alvarez- Viejas locas - Legalicenla" no se sabe)
  if (!/\s-\s/.test(s)) s = s.replace(/(\p{L}|\))- (?=\S)/gu, '$1 - ').replace(/(\S) -(?=\p{L})/gu, '$1 - ')
  s = s.replace(/\s+-\s+-\s+/g, ' - ').replace(/\s+-{2,}\s+/g, ' - ') // "KONGA -- La Cabaña"
  return s.replace(/^[\s\-–.]+|[\s\-–]+$/g, '')
}

/**
 * Los programas de descarga cambian por "_" cualquier signo que Windows no deja usar (: / ? " * < > |). El único caso seguro
 * es "_" pegado a una palabra y seguido de espacio, que era ":" ("Lalo Ebratt_ Bzrp" → "Lalo Ebratt: Bzrp"): ese se
 * arregla solo. Los demás los marca `underscoreDoubt` para mirarlos (o compararlos con internet en la Fase C).
 */
export function underscores(v: string, _field?: 'artist' | 'title'): string {
  return v.replace(/([\p{L}\p{N}])_ (?=[\p{L}\p{N}¿¡])/gu, '$1: ')
}

/**
 * Un "_" que no se sabe qué era: devuelve qué tipo es y la forma más probable, para proponerla a mano y no sola.
 * El disco ".mp3" de Emilia ("La_Original.mp3", "No_se_ve.mp3") lleva "_" en el título oficial: nunca se marca.
 */
// qué tipo de "_" es (se ve en "para mirar a mano")
const T = textos({
  numero: { es: 'Empieza con un número y "_" (el n.º de una lista, no parte del nombre)', en: 'It starts with a number and "_" (the number from a list, not part of the name)' },
  entreEspacios: { es: 'Tiene " _ " entre espacios: ahí había un signo que Windows no deja usar ("/", "|"…)', en: 'It has " _ " between spaces: there was a symbol there that Windows does not allow ("/", "|"…)' },
  entreArtistas: {
    es: 'Tiene " _ " entre dos artistas: ahí iba un "/", que Windows no deja en el nombre. Se propone "&", que todos los programas leen como un solo nombre',
    en: 'It has " _ " between two artists: a "/" went there, which Windows does not allow in names. "&" is proposed, which every program reads as a single name',
  },
  comillas: { es: 'Tiene palabras entre "_": ahí iban comillas', en: 'It has words between "_": quotes went there' },
  espacios: { es: 'Tiene "_" en lugar de los espacios', en: 'It has "_" instead of spaces' },
  termina: { es: 'Termina en "_": ahí había un signo, probablemente "?"', en: 'It ends in "_": there was a symbol there, probably "?"' },
  numeros: { es: 'Tiene "_" entre números: ahí había un signo, probablemente ":" o "/"', en: 'It has "_" between numbers: there was a symbol there, probably ":" or "/"' },
  letras: { es: 'Tiene "_" entre letras: ahí había un signo que Windows no deja usar ("/", ":", "*"…)', en: 'It has "_" between letters: there was a symbol there that Windows does not allow ("/", ":", "*"…)' },
})
/**
 * `field`: en el artista, " _ " entre dos nombres se propone "&" y no "/" (uso real del 24/10: «Big One, FMK / Ke Personajes» en un
 * MP3 se relee partido en dos artistas). "AC_DC" sigue siendo "AC/DC": es el nombre.
 */
export function underscoreDoubt(v: string, field?: string): { kind: string; to: string } | null {
  if (!v.includes('_') || /\.mp3\b/i.test(v)) return null
  const s = underscores(v)
  if (!s.includes('_')) return null
  if (/^\d{1,4}_(?=\p{L})/u.test(s)) return { kind: T.numero, to: s.replace(/^\d{1,4}_/, '') }
  if (/\s_\s/.test(s) && (field === 'artist' || field === 'albumArtist')) return { kind: T.entreArtistas, to: s.replace(/\s+_\s+/g, ' & ') }
  if (/\s_\s/.test(s)) return { kind: T.entreEspacios, to: s.replace(/\s+_\s+/g, ' / ') }
  if (/(^|[\s(])_[^_\s][^_]*[^_\s]_(?=$|[\s).,])/.test(s)) return { kind: T.comillas, to: s.replace(/(^|[\s(])_([^_\s][^_]*[^_\s])_(?=$|[\s).,])/g, '$1"$2"') }
  if (!/\s/.test(s) && (s.match(/_/g) ?? []).length >= 2 && !/__/.test(s)) return { kind: T.espacios, to: s.replace(/_/g, ' ') }
  if (/\p{L}_(?=\s*(?:[([]|$))/u.test(s)) return { kind: T.termina, to: s.replace(/(\p{L})_(?=\s*(?:[([]|$))/gu, '$1?') }
  if (/\d_\d/.test(s)) return { kind: T.numeros, to: s.replace(/(\d)_(?=\d)/g, '$1:') }
  if (/[^\s_]_[^\s_]/.test(s) && !/__/.test(s)) return { kind: T.letras, to: s.replace(/([^\s_])_(?=[^\s_])/g, '$1/') }
  return null
}

/** Espacios de más, espacios pegados a paréntesis y separadores sueltos en las puntas. */
export const tidySpaces = (v: string) =>
  v.replace(/\s{2,}/g, ' ').replace(/([([])\s+/g, '$1').replace(/\s+([)\]])/g, '$1').replace(/^[\s\-–.,;:]+|[\s\-–,;:]+$/g, '').trim()

// "Ven Bailalo - Reggaeton Mix" o "Cosas Imposibles  Digi & Gabo Remix" → "Ven Bailalo (Reggaeton Mix)"
/**
 * Palabras que cierran un nombre de versión ("Remix", "Edit", "VIP"…; core/versionwords.ts). "Extended", "Club" y "Radio"
 * solas al final no alcanzan: "Artista - Pirate Radio" es un título ("Radio Edit" igual termina en "Edit").
 */
export const VERSION_WORD = versionRe(['mezcla'], { except: ['extended', 'club', 'radio'], at: 'end' })
/** Pasa a paréntesis la versión que quedó suelta al final del título. */
export function versionParens(title: string): string {
  const m = title.match(/^(.+?)(?:\s+-\s+|\s{2,})([^()[\]\-–]{2,40})$/)
  if (!m) return title
  const tail = m[2].trim()
  if (!VERSION_WORD.test(tail) || tail.split(/\s+/).length > 5) return title
  return `${m[1].trim()} (${tail})`
}

/** Saca un año entre paréntesis o corchetes del final ("E.C. Scott (1995)", "85H [2015]"). */
export function trailingYear(v: string): { value: string; year: string | null } {
  const m = v.match(/^(.+?)\s*[([]((?:19|20)\d{2})[)\]]$/)
  return m ? { value: m[1].trim(), year: m[2] } : { value: v, year: null }
}

/** ¿Quedó un paréntesis o corchete abierto? ("El martillo de las brujas (Malleus": el nombre se cortó). */
export const unbalanced = (v: string) => (v.match(/[([]/g) ?? []).length !== (v.match(/[)\]]/g) ?? []).length
/** Saca un paréntesis abierto que quedó al final de un nombre cortado. */
export const dropOpenParen = (v: string) => (unbalanced(v) ? v.replace(/\s*[([][^)\]]*$/, '').trim() || v : v)

/** Números pegados al final de un nombre todo en minúscula ("no necesito nada401", "etiqueta negra16"): restos de la página. */
export const gluedNumber = (v: string) => v.replace(/(\p{Ll}{2,})\d{1,5}$/u, '$1')


// Nombres estilizados que se respetan tal cual ("TINI, WOS, Ca7riel"; DJ, MC y siglas aparte). CA7RIEL va como
// figura oficialmente y como está más veces en la biblioteca.
const STYLIZED = new Map(['TINI', 'WOS', 'CA7RIEL', 'YSY A', 'LOUTA', 'KAROL G'].map((s) => [fold(s), s]))
export const stylized = (name: string) => STYLIZED.get(fold(name)) ?? null

const VOWEL = /[aeiouáéíóúüàèìòùy]/i
const UPPER_WORDS = new Set(['AM', 'PM', 'OK', 'TV', 'UK', 'USA', 'EP', 'LP', 'VIP', 'RMX', 'DJ', 'MC', 'XD', 'NYC', 'BPM', 'II', 'III', 'IV'])
/**
 * Mayúsculas iniciales para nombres escritos todo en minúscula o todo en mayúscula, respetando siglas (DJ, RKT, N5, C.R.O, AM),
 * con mayúscula después de " - " y de "(", y la "x" entre nombres en minúscula ("Elaggume x Ecko").
 */
export function smartCase(v: string): string {
  const keep = new Map<number, string>()
  const words = v.split(/(\s+)/)
  words.forEach((w, i) => {
    const letters = w.replace(/[^\p{L}]/gu, '')
    if (!letters) return
    const up = w.toUpperCase()
    if (/\d/.test(w) || /^\p{L}(\.\p{L})+\.?$/u.test(w) || UPPER_WORDS.has(up.replace(/[^\p{L}]/gu, '')) || (letters.length >= 2 && !VOWEL.test(letters))) keep.set(i, up)
    else if (/^x$/i.test(w) && i > 0 && i < words.length - 1) keep.set(i, 'x')
  })
  const out = changeCase(v, 'title').split(/(\s+)/).map((w, i) => keep.get(i) ?? w)
  // después de " - " y al abrir paréntesis va mayúscula ("Rafaga - Una Rafaga de Amor", "(Ese Tren)")
  for (let i = 0; i < out.length; i++) {
    const prev = out.slice(0, i).join('').trimEnd()
    if (!keep.has(i) && /\p{L}/u.test(out[i]) && (prev.endsWith(' -') || /^[([]/.test(out[i]))) out[i] = out[i].replace(/\p{L}/u, (c) => c.toUpperCase())
  }
  return out.join('')
}

/** ¿Está todo en minúscula o todo en mayúscula? (sin contar "x", "ft", "feat", números y signos) */
export function caseKind(v: string): 'lower' | 'upper' | 'mixed' | 'none' {
  const letters = v.replace(/\b(?:x|ft|feat|featuring)\b\.?/gi, '').replace(/[^\p{L}]/gu, '')
  if (letters.length < 2) return 'none'
  if (letters === letters.toLowerCase() && letters !== letters.toUpperCase()) return 'lower'
  if (letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return 'upper'
  return 'mixed'
}

/**
 * ¿Dos formas del mismo nombre se diferencian solo en acentos y signos, con las mismas mayúsculas? ("Babasonicos" /
 * "Babasónicos", "Champion's" / "Champions"). Sirve para unificar sin tocar mayúsculas (decidido el 20/10).
 */
export const sameCase = (a: string, b: string) => {
  const sk = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '')
  return sk(a) === sk(b)
}

// Marcas propias que se agregan al exportar o masterizar ("New Dawn (Original Mix) MSTRD", "BENT COPPERS (FINAL)").
const MARK_WORD = String.raw`(?:pre-?master(?:ed)?|master(?:ed)?|mstrd|mstr|final|mixdown|(?:16|24|32)\s?-?bits?)`
const MARK_GROUP = new RegExp(String.raw`\s*[([]\s*${MARK_WORD}(?:[\s_\-]+${MARK_WORD})*\s*[)\]]`, 'gi')
const MARK_TAIL_SAFE = new RegExp(String.raw`[\s_\-]+(?:MSTRD|MSTR|PREMASTER|(?:16|24|32)\s?-?bits?)\s*$`, 'i')
const MARK_TAIL_UPPER = /[\s_-]+(?:MASTER(?:ED)?|FINAL|MIXDOWN)\s*$/
/**
 * Saca las marcas propias del título: "(FINAL)", "[MASTER 24bit]" entre paréntesis, y "MSTRD", "16bit" al final.
 * "MASTER" y "FINAL" sueltos al final solo si están en mayúsculas y el resto del título no ("LA BATALLA FINAL" queda).
 * "(Mastered with Aurora at 50pct)" tiene más palabras: queda.
 */
export function stripMarks(title: string): string {
  let t = title.replace(MARK_GROUP, '').trim()
  for (let i = 0; i < 3; i++) {
    const before = t
    t = t.replace(MARK_TAIL_SAFE, '').trim()
    const m = t.match(MARK_TAIL_UPPER)
    if (m && caseKind(t.slice(0, m.index)) !== 'upper') t = t.slice(0, m.index).trim()
    if (t === before) break
  }
  // sin marca no se toca nada: "Got Glint_" conserva su "_" (ahí iba un "?", queda para mirar a mano)
  return t === title ? title : t.replace(/[\s\-–]+$/, '') || title
}

/** "Tema (1)" con el archivo "Tema (1).mp3": el "(1)" lo agregó el navegador o Windows al bajar dos veces lo mismo. */
export function stripCopy(title: string, fileBase: string): string {
  const m = title.match(/\s*\((\d)\)$/)
  if (!m || !new RegExp(String.raw`\(${m[1]}\)\s*$`).test(fileBase)) return title
  return title.slice(0, m.index).trim() || title
}

/** Saca prefijos de DJ del nombre ("100 BPM - ", "8A - ", "124 - 8A - ") para que no se confundan con el artista. */
export function prepName(rel: string): string {
  const i = rel.lastIndexOf('/')
  const dir = rel.slice(0, i + 1)
  let base = rel.slice(i + 1)
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : ''
  let name = ext ? base.slice(0, -ext.length) : base
  name = name.replace(/^\d{2,3}\s*bpm\s*[-_]\s*/i, '').replace(/^(\d{1,2}[ab])\s*[-_]\s*/i, '').replace(/^\d{2,3}\s*[-_]\s*(\d{1,2}[ab])\s*[-_]\s*/i, '')
  base = name + ext
  return dir + base
}
