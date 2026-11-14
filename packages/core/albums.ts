// Qué es un disco en la Música: los temas de una misma carpeta con el mismo álbum en el tag. Lo usan "Discos completos",
// "Tapas para todo" y "Volumen parejo". Nunca son disco las carpetas de sueltos, los sets ni los sample packs.
// Dos discos que salieron juntos ("Lobo suelto/Cordero atado (CD 1)" y "(CD 2)") van como dos discos separados, cada uno
// con su nombre y su carpeta (decidido el 22/10); un doble de verdad ("Disco (CD 1)", "(CD 2)") sigue siendo uno.
import { visible, type Db } from './db'
import { fold, isPlaceholder, loose } from './names'
import { setReason } from './sets'
import { isVarious } from './online/hits'

export interface AlbumTrack { id: number; rel: string; title: string | null; artist: string | null; track: number | null; disc: number | null; duration: number | null; ext: string }
export interface AlbumGroup {
  /** Clave estable del disco (artista y álbum "plegados"): sobrevive a mover la carpeta con Organizar. */
  key: string
  dir: string
  artist: string
  album: string
  year: string | null
  /** El disco ocupa (casi) toda su carpeta: ahí sí va un cover.jpg. */
  ownFolder: boolean
  /** Se puede revisar si está completo: tiene su carpeta o está en la carpeta de su artista (no en una carpeta-playlist). */
  checkable: boolean
  /** Varios artistas distintos sin artista del álbum: un compilado. */
  various: boolean
  tracks: AlbumTrack[]
}

// Álbumes que no son un disco: lo que ponen los programas cuando no saben, o nombres de colecciones sueltas.
const GENERIC_ALBUM = /^(?:unknown(?: album)?|(?:[aá]lbum )?desconocido(?: \(.*\))?|album|[aá]lbum|sin (?:album|álbum|titulo|título)|untitled|youtube|soundcloud|spotify|singles?|sueltos?|temas sueltos|varios|misc(?:elaneous)?|mix(?:es)?|playlist|descargas?|downloads?|\[non-album tracks\]|non-album tracks|new folder|nueva carpeta|music|música|musica|audio|mp3|track|tracks|otros|others?|\d{1,4})$/i
// Carpetas de sueltos: aunque varios temas digan el mismo álbum, no es un disco para completar.
// ("Sueltos", "Singles 2020", "Charly García - Sueltos"; no "Nuevos días", que puede ser un disco).
const LOOSE_DIR = /^(?:.*\s[-–]\s)?(?:temas\s+)?(?:sueltos?|singles?|varios|misc|descargas?|downloads?|youtube|soundcloud|playlists?|enganchados?|sets?|mixes|para revisar|nuevos|recibidos)(?:\s+\(?\d{2,4}\)?)?$/i
/** La carpeta del disco: "Disco/CD2" o "Disco/Volumen 2" es parte de "Disco" (un álbum doble). */
const discParent = (dir: string) => dir.replace(/\/(?:cd|dis[ck]o?|vol(?:umen|ume)?\.?)\s*0*\d{1,2}(?:\s*[-–].*)?$/i, '')
/** "Lobo suelto (CD 2)", "Estadio 2001, CD1", "Live Era Disc 2": el álbum sin el número de disco, y el número. */
export function albumDisc(album: string): { base: string; disc: number | null } {
  const m = album.match(/^(.*?)[\s,.\-–:]*[([]?\s*(?:cd|dis[ck]o?|disc)\s*0*(\d{1,2})\s*[)\]]?\s*$/i)
  return m && m[1].trim() ? { base: m[1].trim(), disc: Number(m[2]) } : { base: album.trim(), disc: null }
}

const num = (v: string | null) => { const n = parseInt(v ?? '', 10); return Number.isFinite(n) && n > 0 ? n : null }
export const albumKey = (artist: string, album: string) => `${fold(artist)}|${fold(album)}`

/** ¿Este álbum del tag sirve para agrupar un disco? ("Álbum desconocido (03/05/2006 16:34:34)" no: core/names.ts, isPlaceholder) */
export const realAlbum = (album: string | null | undefined) => !!album && !!album.trim() && !GENERIC_ALBUM.test(album.trim()) && !isPlaceholder(album)

/**
 * Los discos de la Música. `minTracks`: cuántos temas tienen que estar juntos (3 para revisar si está completo: dos temas
 * de un disco en la carpeta de un artista no son "el disco"; 2 para tapas y volumen, como la carpeta de disco de Organizar).
 */
export function albumGroups(db: Db, minTracks = 2): AlbumGroup[] {
  const rows = db.prepare(
    `SELECT id, rel_path AS rel, title, artist, album_artist AS albumArtist, album, track, year, duration, ext FROM files
     WHERE ${visible()} AND error IS NULL AND kind = 'musica' ORDER BY rel_path`,
  ).all() as unknown as { id: number; rel: string; title: string | null; artist: string | null; albumArtist: string | null; album: string | null; track: string | null; year: string | null; duration: number | null; ext: string }[]
  const perDir = new Map<string, number>(), perRaw = new Map<string, number>()
  const groups = new Map<string, { r: (typeof rows)[number]; disc: number | null; base: string }[]>()
  for (const r of rows) {
    const i = r.rel.lastIndexOf('/')
    const raw = i < 0 ? '' : r.rel.slice(0, i)
    const dir = discParent(raw)
    perDir.set(dir, (perDir.get(dir) ?? 0) + 1)
    perRaw.set(raw, (perRaw.get(raw) ?? 0) + 1)
    if (setReason(r.rel, r.duration, r) || !realAlbum(r.album)) continue
    const { base, disc } = albumDisc(r.album!)
    const k = `${dir}\u0000${fold(base)}`
    groups.set(k, [...(groups.get(k) ?? []), { r, disc: disc ?? discOf(r.rel), base }])
  }
  // "TruenoTierra2" al lado de "Trueno Tierra" en la misma carpeta: el segundo disco de un álbum doble
  for (const [k, items] of [...groups]) {
    const dir = k.slice(0, k.indexOf('\u0000'))
    const m = loose(items[0].base).match(/^(.*\D)([2-9])$/)
    const target = m && [...groups.keys()].find((o) => o !== k && o.startsWith(`${dir}\u0000`) && loose(groups.get(o)![0].base) === m[1])
    if (!target) continue
    groups.get(target)!.push(...items.map((x) => ({ ...x, disc: x.disc ?? Number(m![2]) })))
    groups.delete(k)
  }
  // "Lobo suelto/Cordero atado" en CD 1 y CD 2: un disco por nombre, cada uno en la carpeta de sus temas
  for (const [k, items] of [...groups]) {
    const parts = joinedNames(items[0].base)
    if (!parts) continue
    const discs = new Set(items.map((x) => x.disc))
    if (discs.size !== parts.length || ![...discs].every((d) => d != null && d >= 1 && d <= parts.length)) continue
    groups.delete(k)
    for (const [i, name] of parts.entries()) {
      const its = items.filter((x) => x.disc === i + 1).map((x) => ({ ...x, disc: null, base: name }))
      const dirs = new Set(its.map((x) => x.r.rel.slice(0, Math.max(0, x.r.rel.lastIndexOf('/')))))
      const own = dirs.size === 1 ? [...dirs][0] : k.slice(0, k.indexOf('\u0000'))
      groups.set(`${own}\u0000${fold(name)}`, its)
    }
  }
  const out: AlbumGroup[] = []
  for (const [k, items] of groups) {
    const dir = k.slice(0, k.indexOf('\u0000'))
    const last = dir.split('/').pop() ?? ''
    if (items.length < minTracks || !dir || LOOSE_DIR.test(last)) continue
    const rs = items.map((x) => x.r)
    const albumArtist = mostCommon(rs.map((r) => r.albumArtist))
    const artists = new Set(rs.map((r) => fold(r.artist ?? '')).filter(Boolean))
    const various = (!albumArtist && artists.size > Math.max(2, rs.length / 2)) || (!!albumArtist && isVarious(albumArtist))
    const artist = various ? 'Varios Artistas' : albumArtist ?? mostCommon(rs.map((r) => r.artist)) ?? ''
    if (!artist) continue
    const album = mostCommon(items.map((x) => x.base))!
    const tracks = items.map(({ r, disc }) => ({ id: r.id, rel: r.rel, title: r.title, artist: r.artist, track: num(r.track), disc, duration: r.duration, ext: r.ext }))
      .sort((a, b) => (a.disc ?? 1) - (b.disc ?? 1) || (a.track ?? 1e6) - (b.track ?? 1e6) || a.rel.localeCompare(b.rel, 'es', { numeric: true }))
    const ownFolder = rs.length / (perDir.get(dir) ?? perRaw.get(dir) ?? rs.length) >= 0.8
    // la carpeta del artista ("Rock/Callejeros" con varios discos sueltos adentro) también vale; una carpeta-playlist no
    const la = loose(last), lb = loose(artist)
    const artistFolder = !various && la.length >= 3 && lb.length >= 3 && (la.includes(lb) || lb.includes(la))
    out.push({ key: albumKey(artist, album), dir, artist, album, year: mostCommon(rs.map((r) => r.year?.slice(0, 4) ?? null)), ownFolder, checkable: ownFolder || artistFolder, various, tracks })
  }
  return out.sort((a, b) => a.artist.localeCompare(b.artist, 'es') || a.album.localeCompare(b.album, 'es'))
}

/** "Lobo suelto/Cordero atado" → los dos nombres (con "/" entre medio, cada uno con letras); si no, null. */
export function joinedNames(album: string): string[] | null {
  const parts = album.split(/\s*\/\s*/).map((p) => p.trim())
  return parts.length === 2 && parts.every((p) => p.length >= 2 && /\p{L}{2}/u.test(p)) ? parts : null
}

/** El valor más repetido (sin contar los vacíos). */
function mostCommon(vs: (string | null)[]): string | null {
  const n = new Map<string, number>()
  for (const v of vs) if (v && v.trim()) n.set(v.trim(), (n.get(v.trim()) ?? 0) + 1)
  let best: string | null = null, bn = 0
  for (const [v, c] of n) if (c > bn) { best = v; bn = c }
  return best
}

/** "CD2", "Disc 2", "Volumen 2" en la carpeta del tema: el número de disco de un álbum doble. */
function discOf(rel: string): number | null {
  const m = rel.match(/(?:^|\/)(?:cd|dis[ck]o?|disc|vol(?:umen|ume)?\.?)\s*0*(\d{1,2})(?:\s*[-–][^/]*)?\/[^/]+$/i)
  return m ? Number(m[1]) : null
}
