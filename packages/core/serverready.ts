// Chequeo "listo para tu servidor" (Plex, Jellyfin, Navidrome): esos programas arman la biblioteca con las carpetas
// Artista/Álbum y los tags (artista, álbum, año, número de pista, artista del álbum) y muestran la tapa embebida o el
// cover.jpg. Acá se cuenta qué le falta a la Música para verse bien, con ejemplos y la pantalla de PAILA que lo arregla.
// Solo lee: no cambia nada.
import fs from 'node:fs'
import path from 'node:path'
import { visible, type Db } from './db'
import { albumGroups } from './albums'
import { FOLDER_NAMES } from './foldercover'
import { loose } from './names'
import { setReason } from './sets'
import { readCover } from './tagio'
import type { ServerCheck, ServerIssue, ServerIssueId } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

const T = textos({
  tidy: { es: 'Arreglar nombres y tags', en: 'Fix names and tags' },
  organize: { es: 'Organizar carpetas', en: 'Organize folders' },
  online: { es: 'Completar desde internet', en: 'Fill in from the internet' },
  biblioteca: { es: 'Biblioteca', en: 'Library' },
  discosTapas: { es: 'Discos → Tapas', en: 'Albums → Covers' },
  artista: { es: 'Temas sin artista', en: 'Tracks with no artist' },
  artistaPor: { es: 'El servidor agrupa por artista: sin ese dato el tema queda en "Artista desconocido".', en: 'The server groups by artist: without it, the track ends up under "Unknown artist".' },
  titulo: { es: 'Temas sin título', en: 'Tracks with no title' },
  tituloPor: { es: 'Sin título, el servidor muestra el nombre del archivo (con números y guiones).', en: 'Without a title, the server shows the file name (with numbers and dashes).' },
  compilado: { es: 'Compilados sin "artista del álbum"', en: 'Compilations with no "album artist"' },
  compiladoComo: { es: 'elegí los temas del disco y completá "Artista del álbum"', en: 'pick the album\'s tracks and fill in "Album artist"' },
  compiladoPor: {
    es: 'En un disco con temas de varios artistas, el "artista del álbum" (por ejemplo "Varios Artistas") hace que el servidor lo muestre como un solo disco. Si falta, lo parte en uno por cada artista.',
    en: 'On an album with tracks by several artists, the "album artist" (for example "Varios Artistas") makes the server show it as a single album. Without it, the server splits it into one album per artist.',
  },
  carpetas: { es: 'Temas fuera de una carpeta Artista/Álbum', en: 'Tracks outside an Artist/Album folder' },
  carpetasPor: {
    es: 'Plex y Jellyfin se guían sobre todo por los tags, pero con las carpetas en Artista/Álbum reconocen mejor cada disco y es más fácil encontrar las cosas a mano.',
    en: 'Plex and Jellyfin go mostly by the tags, but with Artist/Album folders they recognize each album better and it is easier to find things by hand.',
  },
  album: { es: 'Temas sin álbum', en: 'Tracks with no album' },
  albumPor: { es: 'Sin álbum, el servidor junta todos esos temas en un disco "desconocido" por artista.', en: 'Without an album, the server puts all those tracks together in an "unknown" album for each artist.' },
  anio: { es: 'Temas de discos sin año', en: 'Album tracks with no year' },
  anioPor: { es: 'El año ordena los discos de cada artista y sirve para buscar por década.', en: "The year puts each artist's albums in order and lets you search by decade." },
  pista: { es: 'Temas de discos sin número de pista', en: 'Album tracks with no track number' },
  pistaComo: { es: 'elegí los temas del disco → Numerar', en: "pick the album's tracks → Number them" },
  pistaPor: { es: 'Sin número de pista, el disco se escucha en orden alfabético y no en el orden original.', en: 'Without track numbers, the album plays in alphabetical order instead of the original order.' },
  tapas: { es: 'Discos sin tapa', en: 'Albums with no cover' },
  tapasPor: {
    es: 'El servidor muestra la tapa embebida en los temas o el cover.jpg de la carpeta. Sin ninguna de las dos, el disco aparece con un cuadro gris (algunos la buscan en internet, pero no siempre la encuentran).',
    en: "The server shows the cover embedded in the tracks or the folder's cover.jpg. Without either one, the album shows up as a gray square (some servers look for it on the internet, but they don't always find it).",
  },
})

/** Qué tan grave es cada problema (dato, no texto): imprescindible = el servidor lo muestra mal. */
const LEVEL: Record<ServerIssueId, ServerIssue['level']> = {
  artista: 'imprescindible', titulo: 'imprescindible', compilado: 'imprescindible',
  carpetas: 'conviene', album: 'conviene', anio: 'conviene', pista: 'conviene', tapas: 'conviene',
}

const EXAMPLES = 8
/** "Emilia feat. TINI", "Wos & Ca7riel": para la carpeta alcanza con el primero. */
const firstArtist = (a: string) => a.split(/\s+(?:feat\.?|ft\.?|featuring|con|with|&|x|y|vs\.?)\s+|\s*[,;/]\s*/i)[0].trim()
const VARIOUS_DIR = /^(?:varios(?: artistas)?|various(?: artists)?|va|compilados?|compilations?|soundtracks?|bandas? de sonido)$/i
/** La cara y el lugar en un vinilo ("A1", "B2"): vale como número de pista. */
const VINYL = /^[A-H]\d{1,2}$/i
/** Carpeta de disco de un álbum doble ("CD2", "Disc 1"): se mira la de arriba. */
const DISC_DIR = /^(?:cd|dis[ck]o?|disc|vol(?:umen|ume)?\.?)\s*0*\d{1,2}(?:\s*[-–].*)?$/i

/** ¿Algún nombre de carpeta es el artista? (con o sin "The", mayúsculas o acentos; "Emilia" vale para "Emilia feat. TINI"). */
export function folderHasArtist(dirs: string[], artist: string): boolean {
  const a = loose(firstArtist(artist)), b = loose(artist)
  if (!a) return false
  return dirs.some((d) => {
    const x = loose(d)
    if (x.length < 2) return false
    return x === a || x === b || (a.length >= 3 && x.includes(a)) || (x.length >= 3 && b.includes(x)) || loose(d.replace(/^the\s+/i, '')) === loose(firstArtist(artist).replace(/^the\s+/i, ''))
  })
}

/** ¿La carpeta del tema es la del disco? ("2001 - Clics modernos", "Clics modernos (Remaster)", "Clics Modernos [FLAC]"). */
export function folderHasAlbum(dir: string, album: string): boolean {
  const x = loose(dir), a = loose(album.replace(/\s*[([][^)\]]*[)\]]\s*$/, ''))
  return !!a && (x.includes(a) || (x.length >= 4 && a.includes(x)))
}

export interface ServerOpts { onProgress?: (done: number, total: number) => void; isCancelled?: () => boolean; pathOf: (id: number) => string | null }

/** Revisa la Música (no los samples, proyectos ni sets). Lee el disco solo para las tapas: una carpeta y un tema por disco. */
export async function serverCheck(db: Db, o: ServerOpts): Promise<ServerCheck> {
  const rows = db.prepare(
    `SELECT id, rel_path AS rel, artist, album_artist AS albumArtist, title, album, track, year, duration FROM files
     WHERE ${visible()} AND error IS NULL AND kind = 'musica' ORDER BY rel_path`,
  ).all() as { id: number; rel: string; artist: string | null; albumArtist: string | null; title: string | null; album: string | null; track: string | null; year: string | null; duration: number | null }[]
  const groups = albumGroups(db, 2)
  const inAlbum = new Map<number, (typeof groups)[number]>()
  for (const g of groups) for (const t of g.tracks) inAlbum.set(t.id, g)
  const bad = new Map<ServerIssueId, string[]>()
  const counts = new Map<ServerIssueId, number>()
  const badTracks = new Set<number>()
  /** Los que tienen algo imprescindible mal (el servidor los muestra mal, no solo incompletos). */
  const badEssential = new Set<number>()
  const hit = (id: ServerIssueId, example: string, trackId?: number) => {
    counts.set(id, (counts.get(id) ?? 0) + 1)
    const l = bad.get(id) ?? []
    if (l.length < EXAMPLES) l.push(example)
    bad.set(id, l)
    if (trackId != null) { badTracks.add(trackId); if (LEVEL[id] === 'imprescindible') badEssential.add(trackId) }
  }
  let tracks = 0
  for (const r of rows) {
    if (setReason(r.rel, r.duration, r)) continue // los sets y enganchados no son discos: no se les piden tags de disco
    tracks++
    const g = inAlbum.get(r.id)
    if (!r.artist) hit('artista', r.rel, r.id)
    if (!r.title) hit('titulo', r.rel, r.id)
    if (!r.album) hit('album', r.rel, r.id)
    // año, pista y tapa solo para los discos de verdad (con su carpeta o en la del artista), no para dos temas del mismo
    // álbum que cayeron en una carpeta-playlist
    const disc = !!g && g.checkable
    if (disc && !r.year) hit('anio', r.rel, r.id)
    if (disc && !(parseInt(r.track ?? '', 10) > 0) && !VINYL.test(r.track ?? '')) hit('pista', r.rel, r.id)
    // carpetas: Artista/Álbum/tema para los discos; Artista/tema para los sueltos
    const dirs = r.rel.split('/').slice(0, -1)
    while (dirs.length && DISC_DIR.test(dirs[dirs.length - 1])) dirs.pop()
    const artist = r.albumArtist || r.artist
    let ok: boolean
    if (g) {
      const last = dirs[dirs.length - 1] ?? ''
      const various = g.various || VARIOUS_DIR.test(dirs[dirs.length - 2] ?? '')
      ok = folderHasAlbum(last, g.album) && (various || (!!artist && folderHasArtist(dirs.slice(0, -1), artist)) || folderHasArtist(dirs.slice(0, -1), g.artist))
    } else {
      ok = !!artist && folderHasArtist(dirs, artist)
    }
    if (!ok) hit('carpetas', r.rel, r.id)
  }
  // compilados sin "artista del álbum": el servidor parte el disco en uno por cada artista
  const aa = db.prepare('SELECT album_artist AS v FROM files WHERE id = ?')
  for (const g of groups) {
    if (!g.various || !g.checkable) continue
    const missing = g.tracks.filter((t) => !(aa.get(t.id) as { v: string | null }).v)
    if (missing.length) { hit('compilado', `${g.dir}/ (${g.album})`); for (const t of missing) { badTracks.add(t.id); badEssential.add(t.id) } }
  }
  // tapas: el cover.jpg (o folder.jpg…) de la carpeta, o la embebida en el primer tema del disco
  const discs = groups.filter((g) => g.checkable)
  let i = 0
  for (const g of discs) {
    if (o.isCancelled?.()) break
    o.onProgress?.(i++, discs.length)
    const first = o.pathOf(g.tracks[0].id)
    if (!first) continue // disco no conectado: no se puede mirar
    let has = false
    // el cover.jpg cuenta solo si el disco tiene su carpeta (en la carpeta del artista sería la de otro disco)
    if (g.ownFolder) { try { has = fs.readdirSync(path.dirname(first)).some((n) => FOLDER_NAMES.includes(n.toLowerCase())) } catch { continue } }
    if (!has) { try { has = !!readCover(first) } catch { /* no se puede leer: se cuenta como sin tapa */ } }
    if (!has) { hit('tapas', `${g.dir}/ (${g.album})`); for (const t of g.tracks) badTracks.add(t.id) }
    if (i % 25 === 0) await new Promise((r) => setImmediate(r)) // no trabar el proceso principal
  }
  o.onProgress?.(discs.length, discs.length)
  const info = INFO()
  const issues: ServerIssue[] = (Object.keys(info) as ServerIssueId[]).filter((id) => counts.get(id)).map((id) => ({
    id, level: LEVEL[id], ...info[id], count: counts.get(id)!, examples: bad.get(id) ?? [],
  }))
  return { tracks, albums: discs.length, okTracks: tracks - badTracks.size, okEssential: tracks - badEssential.size, issues }
}

/**
 * Cada problema: qué dice, por qué importa y adónde ir. `goLabel` es el nombre corto de la pantalla (va en el botón "Ir a …")
 * y `goHow`, si hace falta, qué hacer ahí; `unit` es un dato ('temas' o 'discos'): la pantalla elige la palabra.
 */
const INFO = (): Record<ServerIssueId, Omit<ServerIssue, 'id' | 'level' | 'count' | 'examples'>> => ({
  artista: { label: T.artista, unit: 'temas', go: 'tidy', goLabel: T.tidy, why: T.artistaPor },
  titulo: { label: T.titulo, unit: 'temas', go: 'tidy', goLabel: T.tidy, why: T.tituloPor },
  compilado: { label: T.compilado, unit: 'discos', go: 'library', goLabel: T.biblioteca, goHow: T.compiladoComo, why: T.compiladoPor },
  carpetas: { label: T.carpetas, unit: 'temas', go: 'organize', goLabel: T.organize, why: T.carpetasPor },
  album: { label: T.album, unit: 'temas', go: 'online', goLabel: T.online, why: T.albumPor },
  anio: { label: T.anio, unit: 'temas', go: 'online', goLabel: T.online, why: T.anioPor },
  pista: { label: T.pista, unit: 'temas', go: 'library', goLabel: T.biblioteca, goHow: T.pistaComo, why: T.pistaPor },
  tapas: { label: T.tapas, unit: 'discos', go: 'albums', goLabel: T.discosTapas, why: T.tapasPor },
})
