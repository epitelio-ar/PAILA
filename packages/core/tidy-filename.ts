// "Arreglar nombres y tags", paso 2: artista, título, n.º de tema, año y álbum desde el nombre del archivo, solo donde faltan.
// Cada carpeta acepta los formatos que encajan en varios de sus archivos; lo que podría estar al revés o es dudoso no se
// propone: va a "para mirar a mano". Las reglas de texto están en names.ts y artists.ts.
import path from 'node:path'
import { ArtistSpelling, nameList } from './artists'
import { caseKind, cleanBase, dropOpenParen, fold, gluedNumber, isCatalog, isSite, trailingYear, tidySpaces, unbalanced, underscoreDoubt, underscores, versionParens, prepName } from './names'
import { parsePattern } from './tagactions'
import { titleMatch } from './official'
import type { TagField } from './tagio'
import { blank, folderOf } from './tidy-steps'
import { fixBrokenTags } from './tidy-broken'
import type { TidyCtx, TidyRow as Row } from './tidy'
import { textos } from '@paila/shared/idioma'

// los motivos y avisos que se ven en "para mirar a mano" y en "se proponen con un aviso"
const T = textos({
  dosEspacios: { es: 'Artista y título estaban separados solo por dos espacios (ahí había un signo que Windows no deja usar)', en: 'Artist and title were only separated by two spaces (there was a symbol there that Windows does not allow)' },
  guionBajo: { es: 'El nombre tenía "_" en lugar de los espacios: se puede leer, pero no es seguro', en: 'The name had "_" instead of spaces: it can be read, but it is not certain' },
  rehecho: { es: (d: string) => `Lo había completado PAILA el ${d} con reglas que tenían errores; ahora sale distinto`, en: (d: string) => `PAILA had filled it in on ${d} with rules that had mistakes; now it comes out different` },
  trackArtista: { es: (a: string) => `El artista era "${a}": es el n.º de tema, no un artista`, en: (a: string) => `The artist was "${a}": that is the track number, not an artist` },
  enCarpeta: { es: (d: string) => `; el disco está en la carpeta de ${d}`, en: (d: string) => `; the album is in the folder for ${d}` },
  carpetaArriba: { es: (d: string) => `. ¿Es de "${d}", la carpeta de arriba?`, en: (d: string) => `. Is it by "${d}", the folder above?` },
  cortado30: { es: 'El título estaba cortado en 30 letras (tags viejos); el nombre del archivo lo trae entero', en: 'The title was cut off at 30 letters (old tags); the file name has it whole' },
  cortadoExt: { es: 'El título estaba cortado en 30 letras (tags viejos) y arrastraba un pedazo de la extensión del archivo', en: 'The title was cut off at 30 letters (old tags) and carried a piece of the file extension' },
  empiezaNum: { es: 'El título empezaba con el n.º de tema', en: 'The title started with the track number' },
  numPegados: { es: 'Tenía números pegados al final del nombre: se sacaron', en: 'It had numbers stuck to the end of the name: they were removed' },
  nombresDosEsp: { es: 'Los nombres estaban separados por dos espacios (ahí había un signo que Windows no deja usar, como "/" o "+"): revisá cómo se unen', en: 'The names were separated by two spaces (there was a symbol there that Windows does not allow, like "/" or "+"): check how they are joined' },
  archivoCortado: { es: 'El nombre del archivo estaba cortado: revisá el título', en: 'The file name was cut off: check the title' },
  alReves: { es: 'Estaba al revés (Título - Artista): se dio vuelta', en: 'It was backwards (Title - Artist): it was flipped' },
  esElDisco: { es: (x: string) => `Decía «(${x})» junto al artista: ¿es el disco?`, en: (x: string) => `It said «(${x})» next to the artist: is that the album?` },
  pareceAlReves: { es: 'Parece estar al revés (Título - Artista), pero no es seguro', en: 'It looks backwards (Title - Artist), but it is not certain' },
  bpm: { es: 'Con el BPM adelante no se sabe si es "Artista - Título" o "Título - Artista", y ninguno de los dos es un artista conocido', en: 'With the BPM at the start, it is not clear whether it is "Artist - Title" or "Title - Artist", and neither one is a known artist' },
  iguales: { es: 'El artista y el título salen iguales del nombre del archivo', en: 'The artist and the title come out the same from the file name' },
  typeBeat: { es: 'Es un "type beat": el nombre que figura no es el del autor', en: 'It is a "type beat": the name shown is not the author\'s' },
  justo30: { es: 'El título tiene justo 30 letras: puede estar cortado (los tags viejos cortaban ahí)', en: 'The title has exactly 30 letters: it may be cut off (old tags cut there)' },
  otroGuion: { es: 'El título quedó con otro guion en el medio: revisá que esté bien cortado', en: 'The title ended up with another dash in the middle: check that it is split right' },
  guionSuelto: { es: 'El artista tiene un guion suelto ("Pity Alvarez- Viejas locas"): revisá si son dos nombres', en: 'The artist has a loose dash ("Pity Alvarez- Viejas locas"): check whether they are two names' },
  marca: { es: 'El título tiene una marca propia ("MASTER", "16bit"…): ¿va en el título?', en: 'The title has your own mark ("MASTER", "16bit"…): does it belong in the title?' },
})

// Del más específico al más general. Los que no traen artista solo completan título y n.º de tema.
const PATTERNS = [
  '%n% - %artista% - %titulo%', '%n%. %artista% - %titulo%', '%n% %artista% - %titulo%', '%artista% - %titulo%',
  '%n%. %titulo%', '%n% - %titulo%', '%n% %titulo%', '%n%-%titulo%',
]

const MARKS = /\b(?:MASTER|MSTRD|MASTERED|16 ?bit|24 ?bit|FINAL)\b/ // marcas propias en el título ("MASTER", "16bit")
const STRONG = new Set(['%n% - %artista% - %titulo%', '%artista% - %titulo%'])

/** Artista y título leídos de un nombre de archivo, ya limpios, con avisos. */
interface FromName { artist?: string; title?: string; track?: string; year?: string; album?: string; notes: string[]; doubt: string | null; doubtFields?: ('artist' | 'title')[]
  /** El aviso de la marca propia ("MASTER") va aparte: con la regla "marcas" no hace falta (la marca se saca). */
  markNote?: string }

// 2) del nombre del archivo, solo donde faltan artista o título. En cada carpeta se aceptan los formatos que encajan en
//    varios archivos y cada archivo usa el más específico que le sirve ("1. Plan B - Tema" y "Otro - Tema" conviven).
export function fillFromFilenames(c: TidyCtx) {
  const { rows, on, isSet, val, setField, doubt, authored, pailas } = c
  // un "artista" que es el nombre de una página ("m.youtube.com") o el n.º de tema ("Track01", con el título "Track01 - Billy":
  // un disco de Luca Prodan, 22/10) cuenta como vacío
  const missing = (id: number, f: TagField) => blank(val(id, f)) || (f === 'artist' && (isSite(val(id, f)!) || TRACK_ARTIST.test(val(id, f)!.trim())))
    || (f === 'title' && TRACK_TITLE.test(val(id, f)!)) || pailas(id, f)
  const byDir = new Map<string, Row[]>()
  for (const r of rows) if (!isSet.has(r.id) && (missing(r.id, 'artist') || missing(r.id, 'title'))) byDir.set(folderOf(r.rel), [...(byDir.get(folderOf(r.rel)) ?? []), r])
  const ambiguous = new Set<number>() // "100 BPM - A - B": no se sabe cuál es el artista; se decide más abajo con los artistas conocidos
  const parse = (t: Row, p: string) => {
    try {
      const prepped = prepName(t.rel)
      const bpm = prepped !== t.rel && p.includes('%artista%') && p.includes('%titulo%')
      if (bpm && p !== '%artista% - %titulo%') return null
      const file = prepped.slice(prepped.lastIndexOf('/') + 1)
      const ext = path.extname(file)
      const r = parsePattern(cleanBase(file.slice(0, file.length - ext.length)) + ext, p)
      // un artista que es solo un número ("01 - Tema") o "Track03" es en realidad el n.º de tema
      if (r?.artist && /^(?:track|pista)?\s*\d{1,3}$/i.test(r.artist.trim())) {
        if (p !== '%artista% - %titulo%' || !/^(?:track|pista)/i.test(r.artist.trim())) return null
        return { track: r.artist.replace(/\D/g, ''), title: r.title } as Partial<Record<TagField, string>>
      }
      // "1 - Fragilidad (Malpaso - Para otro lado)": un corte adentro de un paréntesis no separa artista y título
      if (r?.artist && unbalanced(r.artist)) return null
      if (r && bpm) ambiguous.add(t.id)
      return r
    } catch { return null }
  }
  // Si no encaja ningún formato: "Las Pastillas Del Abuelo-La Doctora II" (empieza con el nombre de la carpeta, que es el
  // artista) o "Rusherking  LOBA" (dos espacios donde había un signo; eso no es seguro y queda para mirar a mano).
  const fallbackDoubt = new Map<number, string>()
  const fallback = (t: Row): Partial<Record<TagField, string>> | null => {
    const file = t.rel.slice(t.rel.lastIndexOf('/') + 1)
    const name = cleanBase(file.slice(0, file.length - path.extname(file).length))
    const dir = folderOf(t.rel).split('/').pop() ?? ''
    if (dir && name.length > dir.length && fold(name.slice(0, dir.length)) === fold(dir)) {
      const rest = name.slice(dir.length).match(/^\s*-\s*(.+)$|^\s{2,}(.+)$/)
      if (rest) return { artist: dir, title: rest[1] ?? rest[2] }
    }
    const gaps = name.match(/\S\s{2,}\S/g) ?? []
    if (gaps.length === 1 && !/\s-\s/.test(name)) {
      const [a, b] = name.split(/\s{2,}/)
      fallbackDoubt.set(t.id, T.dosEspacios)
      return { artist: a, title: b }
    }
    return null
  }
  // primera pasada: qué formato le toca a cada archivo
  const parsed = new Map<number, Partial<Record<TagField, string>>>()
  const dirTrackOk = new Map<string, boolean>()
  for (const [dir, targets] of byDir) {
    // los dos formatos de siempre valen aunque haya un solo archivo así; los otros, si encajan en varios de la carpeta
    const accepted = PATTERNS.filter((p) => STRONG.has(p) || targets.filter((t) => parse(t, p)).length >= Math.min(2, targets.length))
    const nums: number[] = []
    for (const t of targets) {
      const p = accepted.find((q) => parse(t, q))
      const x = p ? parse(t, p)! : fallback(t)
      if (!x) continue
      parsed.set(t.id, x)
      if (x.track) nums.push(parseInt(x.track, 10))
    }
    // números repetidos ("01 - Paja brava", "01 - Panic show"…): la carpeta no es un disco y esos números no son el n.º de tema
    dirTrackOk.set(dir, nums.length - new Set(nums).size <= Math.floor(nums.length * 0.2))
  }
  // los artistas que ya se conocen (tags, carpetas y lo leído de los nombres) sirven para ver si un nombre está al revés
  const spell = new ArtistSpelling()
  // (lo que puso PAILA y se va a recalcular no cuenta: si estaba al revés, "SOLTERO" parecería un artista conocido)
  for (const r of rows) { if (!pailas(r.id, 'artist')) spell.addTag(r.artist); for (const seg of folderOf(r.rel).split('/')) spell.addFolder(seg) }
  for (const x of parsed.values()) if (x.artist && x.title) spell.addTag(cleanArtist(x.artist))

  for (const t of rows) {
    const x = parsed.get(t.id)
    if (!x) continue
    const tagArtist = missing(t.id, 'artist') ? null : val(t.id, 'artist')
    const fn = fromName(x, t, tagArtist, spell, dirTrackOk.get(folderOf(t.rel)) ?? true, ambiguous.has(t.id))
    if (!fn.doubt && fallbackDoubt.has(t.id)) fn.doubt = fallbackDoubt.get(t.id)!
    // "01-flowanastasia_and_nymfo-river_flows": "_" en lugar de los espacios; se lee, pero no es seguro (para mirar a mano)
    const raw = path.basename(t.rel, path.extname(t.rel))
    if (!fn.doubt && !/\s/.test(raw) && raw.includes('_') && raw.includes('-')) fn.doubt = T.guionBajo
    const fill = (f: TagField, v: string | undefined, note?: string) => {
      if (!v || !missing(t.id, f)) return
      const before = val(t.id, f)
      // lo que puso PAILA ya estaba bien y lo nuevo solo le suma un "_" (un signo que Windows no deja en el nombre): se deja como
      // está y lo que iba ahí ("?", ":") queda para mirar a mano. "CUÁNTOS TÉRMINOS" no pasa a "CUÁNTOS TÉRMINOS_".
      if (pailas(t.id, f) && before && tidySpaces(v.replace(/_/g, ' ')) === tidySpaces(before)) {
        const u = underscoreDoubt(v, f)
        if (u && u.to !== before) doubt(t, f, u.to, u.kind)
        return
      }
      const redo = pailas(t.id, f) && before !== v
        ? T.rehecho(authored.get(`${t.id}|${f}`)!.date) : undefined
      setField(t, f, v, 'filename', [note, redo].filter(Boolean).join(' · ') || undefined)
    }
    if (fn.doubt) {
      const fields: ('artist' | 'title')[] = fn.doubtFields ?? ['artist', 'title']
      for (const f of fields) { const v = fn[f]; if (v && missing(t.id, f)) doubt(t, f, v, fn.doubt) }
      if (!fn.doubtFields) continue
    }
    // con la regla "marcas" la marca se saca más abajo: no hace falta avisarla
    const note = [...fn.notes, ...(fn.markNote && !on.has('marcas') ? [fn.markNote] : [])].join(' · ') || undefined
    if (!fn.doubtFields?.includes('artist')) fill('artist', fn.artist, note)
    if (!fn.doubtFields?.includes('title')) fill('title', fn.title, note)
    fill('track', fn.track)
    fill('year', fn.year)
    fill('album', fn.album)
  }

  // El artista "Track01": si la carpeta del disco dice de quién es ("Luca Prodan/PERDEDORES HERMOSOS - LUCA PRODAN"), ese es
  // el artista; si no, queda para mirar a mano (lo que diga la carpeta de arriba puede ser un género: "Rock").
  for (const t of rows) {
    const a = val(t.id, 'artist')
    if (isSet.has(t.id) || !a || !TRACK_ARTIST.test(a.trim())) continue
    const parts = folderOf(t.rel).split('/'), albumDir = parts[parts.length - 1] ?? '', artistDir = parts.length > 1 ? parts[parts.length - 2] : ''
    const why = T.trackArtista(a.trim())
    if (artistDir && fold(albumDir).includes(fold(artistDir))) setField(t, 'artist', artistDir.trim(), 'filename', why + T.enCarpeta(artistDir.trim()))
    else if (artistDir) doubt(t, 'artist', artistDir.trim(), why + T.carpetaArriba(artistDir.trim()))
  }

  // Títulos cortados en 30 letras (tags viejos ID3v1: "Voy A Bailar A La Nave Del Olv") cuando el nombre del archivo trae
  // el mismo título entero: se completa sin internet. Solo si el artista del nombre es el del tag (o el nombre es solo el título).
  for (const t of rows) {
    const cur = val(t.id, 'title')?.trim()
    if (isSet.has(t.id) || !cur || cur.length < 29 || cur.length > 30) continue
    const x = parse(t, '%n% - %artista% - %titulo%') ?? parse(t, '%artista% - %titulo%')
    const file = t.rel.slice(t.rel.lastIndexOf('/') + 1)
    const tagArtist = val(t.id, 'artist')
    const full = x?.title && x.artist && tagArtist && fold(cleanArtist(x.artist)) === fold(tagArtist) ? x.title.trim()
      : cleanBase(file.slice(0, file.length - path.extname(file).length)).trim()
    if (titleMatch(cur, full) === 'cut') setField(t, 'title', full, 'filename', T.cortado30)
    // el título se armó con el nombre del archivo y el corte cayó en la extensión: "Nuestro amo juega al esclavo.m" (corrida del
    // 22/10). Lo de antes del punto es el título entero. Solo un pedazo de la extensión del archivo ("La_Original.mp3" es un título)
    else {
      const ext = path.extname(file).toLowerCase(), dot = cur.lastIndexOf('.')
      const tail = dot > 0 ? cur.slice(dot).toLowerCase() : ''
      if (tail.length >= 2 && tail.length < ext.length && ext.startsWith(tail) && cur.slice(0, dot).trim()) setField(t, 'title', cur.slice(0, dot).trim(), 'filename', T.cortadoExt)
    }
  }

  // El n.º de tema pegado adelante del título: "05- El mismo canal", "07 Donde esconder tantas manos", "04 - SOY CORDOBES"
  // (corrida del 22/10: ~40 temas). Tiene que ser el mismo n.º del tag de tema o del principio del nombre del archivo, y venir con
  // cero adelante o un signo ("07 ", "05-", "12. "); sin eso, solo un n.º de dos cifras ("10 Ella No Vea La Tele") en una carpeta
  // con al menos dos de cero adelante ("01 Viva El Funk"…). "7 Rings", "14 Years" (tema 2), "1 amor - Lali" (en una carpeta con
  // "017 - Queen") o "10 fueron" quedan como están.
  const numbered: { t: Row; title: string; strong: boolean; digits: string }[] = []
  // También después del artista repetido: "Salta La Banca - 12. El Relato", "YSY A - 06. Linaje" → "El Relato", "Linaje". Ahí el
  // nombre del archivo dice lo mismo que el título y no sirve de prueba: solo vale n.º + signo + espacio (como en fromName), así
  // "Closed I - 91-DIVOC" o "no te va gustar - 10 fueron" quedan como están.
  for (const t of rows) {
    const cur = val(t.id, 'title'), art = val(t.id, 'artist')?.trim()
    if (isSet.has(t.id) || !cur) continue
    const after = art && cur.toLowerCase().startsWith(art.toLowerCase()) ? cur.slice(art.length).match(/^\s*[-–]\s*(\d{1,3})\s*[-.)]\s+(\S.*)$/) : null
    if (after && parseInt(after[1], 10) >= 1 && /\p{L}.*\p{L}/u.test(after[2])) { numbered.push({ t, title: after[2].trim(), strong: true, digits: after[1] }); continue }
    const m = cur.match(/^(\d{1,3})(\s*[.\-–]\s*|\s+)(\S.*)$/)
    if (!m || !/\p{L}.*\p{L}/u.test(m[3])) continue
    const n = parseInt(m[1], 10)
    const file = t.rel.slice(t.rel.lastIndexOf('/') + 1).match(/^(\d{1,3})(?!\d)/)
    if (n < 1 || !(n === parseInt(val(t.id, 'track') ?? '', 10) || (file && parseInt(file[1], 10) === n))) continue
    numbered.push({ t, title: m[3].trim(), strong: /^0\d/.test(m[1]) || /[.\-–]/.test(m[2]), digits: m[1] })
  }
  const padded = new Map<string, number>()
  for (const x of numbered) if (/^0\d$/.test(x.digits)) padded.set(folderOf(x.t.rel), (padded.get(folderOf(x.t.rel)) ?? 0) + 1)
  for (const x of numbered) if (x.strong || (x.digits.length === 2 && (padded.get(folderOf(x.t.rel)) ?? 0) >= 2)) setField(x.t, 'title', x.title, 'filename', T.empiezaNum)
  // tags rotos que se arreglan solos: "05.Que" / "ves", "152_Bee Gees", "Various Artists" con "Queen - Bohemian Rhapsody"
  fixBrokenTags(c, spell)
}

/** "Track01", "Pista 3": el n.º de tema puesto como artista; y el título que lo repite adelante ("Track01 - Billy"). */
const TRACK_ARTIST = /^(?:track|pista)\s*\d{1,3}$/i
const TRACK_TITLE = /^(?:track|pista)\s*\d{1,3}\s*[-–]\s*/i

/** El artista leído del nombre, sin restos de n.º ("1. Plan B") y con los espacios dobles como separador de nombres. */
function cleanArtist(a: string): string {
  return tidySpaces(underscores(a.trim().replace(/^\d{1,3}\s*[-.)_]\s*/, ''), 'artist')
    .replace(/\s+(?=(?:feat|ft|featuring)\b)/gi, ' ') // "La Factoria  ft. Eddy Lover": antes del feat. no hay un nombre perdido
    .replace(/(\S)\s{2,}(?=[^\s(])/g, '$1 & '))
}

/** Arma artista, título, n.º y año a partir de lo que encajó en el patrón, con los arreglos y las dudas de cada caso. */
function fromName(x: Partial<Record<TagField, string>>, t: Row, tagArtist: string | null, spell: ArtistSpelling, trackOk: boolean, ambiguous: boolean): FromName {
  const out: FromName = { notes: [], doubt: null }
  let artist = x.artist?.trim()
  let title = x.title?.trim()
  if (x.track) { const n = parseInt(x.track, 10); if (trackOk && n > 0 && n < 100) out.track = String(n) } // "100 - El Reja…" es un BPM, no el tema 100
  // "no necesito nada401", "etiqueta negra16": en los nombres escritos todo en minúscula, los números pegados al final son basura
  if (caseKind([artist, title].filter(Boolean).join(' ')) === 'lower') {
    const a2 = artist && gluedNumber(artist), t2 = title && gluedNumber(title)
    if (a2 !== artist || t2 !== title) { artist = a2; title = t2; out.notes.push(T.numPegados) }
  }
  if (artist) {
    if (/\S\s{2,}(?!(?:feat|ft|featuring)\b)\S/i.test(artist.trim())) out.notes.push(T.nombresDosEsp)
    artist = cleanArtist(artist)
    const y = trailingYear(artist); artist = y.value; if (y.year) out.year = y.year
  }
  if (title) {
    // sobras de n.º de tema ("01 - Tema"), pero no "3.33", "91-DIVOC" ni "2_2=3"
    title = title.replace(/^\d{1,3}\s*[-.)]\s+/, '')
    title = versionParens(title)
    title = tidySpaces(underscores(title, 'title'))
    const y = trailingYear(title); title = y.value; if (y.year && !out.year) out.year = y.year
    // "El martillo de las brujas (Malleus": el nombre se cortó; el paréntesis abierto se va
    if (unbalanced(title)) { title = dropOpenParen(title); out.notes.push(T.archivoCortado) }
    // "Rocanroles Sin Destino - Rocanroles Sin Destino": el disco y el tema con el mismo nombre
    const twice = title.match(/^(.+?)\s+-\s+(.+)$/)
    if (twice && fold(twice[1]) === fold(twice[2])) title = twice[2]
    // "Fragilidad (Malpaso - Para otro lado)": entre paréntesis vienen el artista y el disco
    const ad = title.match(/^(.+?)\s*\(([^()]+?)\s+-\s+([^()]+)\)$/)
    if (ad && spell.known(ad[2]) && (!artist || fold(artist) === fold(ad[2]))) { title = ad[1].trim(); artist = ad[2].trim(); out.album = ad[3].trim() }
  }
  // "AL046 - KASST - Hope Im Alone": adelante va el n.º de catálogo del sello, el artista es el que sigue
  if (artist && title && isCatalog(artist)) {
    const m = title.match(/^(.+?)\s+-\s+(.+)$/)
    if (m) { artist = m[1].trim(); title = m[2].trim() }
  }
  // "Furz - Gustavo Cerati - Cosas Imposibles (Furz Reworx)": el que figura primero es el del remix, el artista es el otro
  if (artist && title) {
    const m = title.match(/^(.+?)\s+-\s+(.+)$/)
    if (m && [...m[2].matchAll(/\(([^)]*)\)/g)].some((p) => fold(p[1]).includes(fold(artist!)))) { artist = m[1].trim(); title = m[2].trim() }
  }
  // al revés: "Los Del Espacio - LIT killah, Duki, Emilia…", "SOLTERO - ELAGGUME x ECKO ft OMAR VARELA", "100 BPM - Adios - Maria Becerra"
  if (artist && title) {
    let inv = inverted(artist, title, tagArtist, spell)
    // con el BPM adelante, si ninguno es un artista conocido, decide el lado que tiene pinta de lista de artistas (feat., comas, " x ", DJ)
    if (ambiguous && !inv) {
      const sig = (s: string) => /\b(?:feat|ft)\b\.?|\sx\s|,|^dj\s/i.test(s)
      if (sig(title) && !sig(artist)) inv = 'sure'
      else if (sig(artist) && !sig(title)) inv = 'keep'
    }
    if (inv === 'sure') {
      [artist, title] = [title, artist]
      out.notes.push(T.alReves)
      // "Rehen - Callejeros (Disco Escultura)": lo que va entre paréntesis después del artista no es parte del artista
      const pa = artist.match(/^(.+?)\s*\(([^)]*)\)?$/)
      if (pa && spell.known(pa[1])) { artist = pa[1].trim(); if (pa[2].trim()) out.notes.push(T.esElDisco(pa[2].trim())) }
    }
    else if (inv === 'doubt' || (ambiguous && inv !== 'keep')) {
      if (inv === 'doubt') [artist, title] = [title, artist]
      out.artist = artist; out.title = title
      out.doubt = inv === 'doubt' ? T.pareceAlReves : T.bpm
      return out
    }
  }
  out.artist = artist || undefined
  out.title = title || undefined
  if (artist && title && fold(artist) === fold(title)) { out.doubt = T.iguales; return out }
  if (title && /\btype\s*beat\b/i.test(title)) { out.doubt = T.typeBeat; out.doubtFields = ['artist'] }
  if (title && title.length === 30 && /\p{L}$/u.test(title)) out.notes.push(T.justo30)
  if (title && /\s-\s/.test(title)) out.notes.push(T.otroGuion)
  if (artist && /\p{L}- |\s-\p{L}/u.test(artist)) out.notes.push(T.guionSuelto)
  if (title && MARKS.test(title)) out.markNote = T.marca
  return out
}

/**
 * ¿El nombre está como "Título - Artista"? 'sure' si del otro lado hay un artista conocido y de este no; 'keep' si este lado es
 * un artista conocido; 'doubt' si solo hay señales (una lista de nombres del otro lado).
 */
function inverted(artist: string, title: string, tagArtist: string | null, spell: ArtistSpelling): 'sure' | 'keep' | 'doubt' | null {
  if (tagArtist && fold(tagArtist) === fold(title) && fold(tagArtist) !== fold(artist)) return 'sure'
  const known = (s: string) => nameList(s.replace(/\s*\([^)]*\)?/g, '')).some((n) => spell.known(n)) // sin "(Disco Escultura)"
  if (known(artist) || /\b(?:feat|ft)\b\.?/i.test(artist)) return 'keep' // "Sombra India Feat. Eduardo Castillo - Sis": el feat. marca el artista
  // un título corto puede llamarse igual que un artista ("Sis"): ahí no se da vuelta solo
  if (known(title)) return title.replace(/[^\p{L}]/gu, '').length <= 3 ? 'doubt' : 'sure'
  const marks = (s: string) => /\sx\s/i.test(s) || (s.match(/,/g) ?? []).length >= 2
  if (marks(title) && !marks(artist)) return 'doubt'
  if (/^dj\s/i.test(title) && !/\bdj\b/i.test(artist)) return 'doubt'
  return null
}
