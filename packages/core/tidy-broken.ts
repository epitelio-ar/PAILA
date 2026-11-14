// "Arreglar nombres y tags": tags rotos que PAILA arregla sola (repaso de criterios del 24/10, pedido del autor): el n.º de tema
// pegado al artista ("05.Que" / "ves"), un número adelante del artista ("152_Bee Gees") y "Various Artists" con "Artista - Título"
// en el título. Lo llama el paso del nombre del archivo (core/tidy-filename.ts), al final; lo que no es seguro va a mirar a mano.
import path from 'node:path'
import type { ArtistSpelling } from './artists'
import { cleanBase, fold, isSite } from './names'
import { isVarious } from './online/hits'
import { folderOf } from './tidy-steps'
import type { TidyCtx, TidyRow as Row } from './tidy'
import { textos } from '@paila/shared/idioma'

const T = textos({
  pegado: { es: (a: string, d: string) => `El artista era "${a}": el n.º de tema y la primera palabra del título, pegados; el artista sale de la carpeta (${d})`, en: (a: string, d: string) => `The artist was "${a}": the track number and the first word of the title, stuck together; the artist comes from the folder (${d})` },
  pegadoDuda: { es: (a: string) => `El artista era "${a}": el n.º de tema y la primera palabra del título, pegados. ¿De quién es?`, en: (a: string) => `The artist was "${a}": the track number and the first word of the title, stuck together. Whose is it?` },
  prefijo: { es: (a: string) => `El artista empezaba con un número que no es parte del nombre ("${a}")`, en: (a: string) => `The artist started with a number that is not part of the name ("${a}")` },
  varios: { es: (a: string) => `El artista decía "${a}" y el título traía "Artista - Título": se separaron`, en: (a: string) => `The artist said "${a}" and the title had "Artist - Title": they were split` },
  variosDuda: { es: (a: string) => `El artista dice "${a}" y el título parece "Artista - Título", pero ese artista no está en tu biblioteca`, en: (a: string) => `The artist says "${a}" and the title looks like "Artist - Title", but that artist is not in your library` },
  extension: { es: (e: string) => `El título terminaba con la extensión del archivo ("${e}")`, en: (e: string) => `The title ended with the file extension ("${e}")` },
})

/** "05.Que", "3-Hola": el n.º de tema pegado a una palabra, sin espacio. */
const GLUED = /^(\d{1,3})[.\-_)](\p{L}\S*)$/u
/** "152_Bee Gees", "07. Plan B": un número y un signo adelante del nombre (con espacio no: "50 Cent", "21 Savage"). */
const PREFIX = /^(\d{1,4})\s*[_.\-]+\s*(\p{L}.*)$/u

/** El artista más común de los otros temas de la carpeta, si son al menos dos y la mayoría. */
function folderArtist(c: TidyCtx, t: Row): string | null {
  const dir = folderOf(t.rel)
  const count = new Map<string, { name: string; n: number }>()
  let tagged = 0
  for (const r of c.rows) {
    if (r.id === t.id || folderOf(r.rel) !== dir) continue
    const a = c.val(r.id, 'artist')?.trim()
    if (!a || isSite(a) || GLUED.test(a) || isVarious(a)) continue
    tagged++
    const k = fold(a), e = count.get(k) ?? { name: a, n: 0 }
    e.n++; count.set(k, e)
  }
  const best = [...count.values()].sort((a, b) => b.n - a.n)[0]
  return best && best.n >= 2 && best.n * 10 >= tagged * 6 ? best.name : null
}

/**
 * Los artistas que tienen un título con ".mp3" que no sale de la extensión de su archivo (el disco ".mp3" de Emilia: "Jagger.mp3"
 * en ese disco, "GTA.mp3" en un .wav, "Jagger.mp3 (Official Video)"): sus títulos con ".mp3" al final no se tocan.
 */
const firstArtist = (a: string | null) => fold(a ?? '').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b)\s*/)[0]
function mp3InTitle(rows: Row[]): Set<string> {
  const out = new Set<string>()
  for (const r of rows) {
    const t = r.title?.trim() ?? '', i = t.toLowerCase().lastIndexOf('.mp3')
    if (i < 0) continue
    const ext = path.extname(r.rel).toLowerCase(), raw = path.basename(r.rel, path.extname(r.rel)).toLowerCase()
    if (/\.mp3/i.test(r.album ?? '') || i + 4 < t.length || ext !== '.mp3' || (raw.includes('.mp3') && !raw.endsWith('.mp3'))) out.add(firstArtist(r.artist))
  }
  return out
}

export function fixBrokenTags(c: TidyCtx, spell: ArtistSpelling) {
  const { rows, isSet, val, setField, doubt } = c
  const keepMp3 = mp3InTitle(rows)
  for (const t of rows) {
    if (isSet.has(t.id)) continue
    const a = val(t.id, 'artist')?.trim(), title = val(t.id, 'title')?.trim()
    const base = cleanBase(path.basename(t.rel, path.extname(t.rel))).trim()
    // 1) "05.Que" / "ves" del archivo "05.Que ves.mp3": alguien partió el nombre del archivo en el primer espacio
    const g = a ? a.match(GLUED) : null
    if (g && title && fold(base) === fold(`${a} ${title}`)) {
      const fixed = `${g[2]} ${title}`, dir = folderOf(t.rel).split('/').pop() ?? ''
      const who = folderArtist(c, t) ?? (dir && spell.known(dir) ? dir : null)
      if (who) {
        setField(t, 'artist', who, 'filename', T.pegado(a!, dir))
        setField(t, 'title', fixed, 'filename', T.pegado(a!, dir))
        if (!val(t.id, 'track')) setField(t, 'track', g[1], 'filename')
      } else doubt(t, 'title', fixed, T.pegadoDuda(a!))
      continue
    }
    // 2) "152_Bee Gees": el resto es un artista que ya está en tu biblioteca (y el archivo lo confirma, si dice "Artista - …")
    for (const f of ['artist', 'albumArtist'] as const) {
      const v = val(t.id, f)?.trim(), m = v?.match(PREFIX)
      if (!m || spell.known(v!)) continue
      const rest = m[2].trim(), fromFile = base.split(/\s+-\s+/)[0]
      if (spell.known(rest) || fold(fromFile) === fold(rest)) setField(t, f, rest, 'filename', T.prefijo(v!))
    }
    // 3) "Various Artists" con el título "Queen - Bohemian Rhapsody" (o "017 - Queen - …")
    const va = val(t.id, 'artist')?.trim(), tt = val(t.id, 'title')?.trim()
    const parts = va && isVarious(va) && tt ? tt.replace(/^\d{1,3}\s*[-.]\s+/, '').match(/^(.+?)\s+[-–]\s+(.+)$/) : null
    if (parts) {
      const [, who, rest] = parts
      if (spell.known(who)) { setField(t, 'artist', who.trim(), 'filename', T.varios(va!)); setField(t, 'title', rest.trim(), 'filename', T.varios(va!)) }
      else doubt(t, 'artist', who.trim(), T.variosDuda(va!))
    }
    // 4) el título con la extensión del archivo pegada: "Se vos.mp3" del archivo "almafuerte- se vos.mp3" (Organizar armaba
    //    "04 - Se vos.mp3.mp3", punto 1 real del 24/10), o con la extensión doble ("… Remix).Mp3" de "… Remix).Mp3.Mp3"). El ".mp3"
    //    que es parte del título se queda (el disco ".mp3" de Emilia): el disco se llama así, el archivo lo trae en el medio
    //    ("Emilia - Jagger.mp3 (Official Video).mp3"), la extensión es otra ("GTA.mp3 (Official Video).wav"), el tag sigue
    //    después ("La_Original.mp3 (Official Video)") o el artista tiene otro tema así (mp3InTitle: "La_Original.mp3" del archivo
    //    "Emilia, TINI - La_Original.mp3", ya con Nombres aplicado). Se mira el tag como estaba, no lo ya limpiado.
    const ext = path.extname(t.rel).toLowerCase(), raw = path.basename(t.rel, path.extname(t.rel)).toLowerCase(), now = val(t.id, 'title')?.trim()
    if (ext && t.title?.trim().toLowerCase().endsWith(ext) && now && now.toLowerCase().endsWith(ext) && now.length > ext.length && !keepMp3.has(firstArtist(t.artist))
      && !/\.mp3/i.test(t.album ?? '') && (!raw.includes(ext) || raw.endsWith(ext))) setField(t, 'title', now.slice(0, -ext.length).trim(), 'filename', T.extension(ext))
  }
}
