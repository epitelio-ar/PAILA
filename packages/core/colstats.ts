// Estadísticas de la colección Música: por década, género y formato, artistas con más discos, cuánto está en calidad de CD o
// mejor y el país de los artistas. Una sola lectura de la base, sin tocar archivos. El país no está en los tags: sale de lo
// que MusicBrainz contestó en "Completar desde internet" (core/artistcountry.ts).
import { visible, type Db } from './db'
import { isLossless } from './queue'
import { countriesFor, countryName } from './artistcountry'
import { artistKey, mainArtist } from './official-findings'
import type { CollectionStats, StatBucket } from '@paila/shared/types'
import { generoPrincipal } from '@paila/shared/generos'

interface Row {
  ext: string; codec: string | null; size: number; year: number | null; genre: string | null
  artist: string | null; album_artist: string | null; album: string | null; grade: string | null
}

/** Hasta cuántos géneros se muestran; el resto se junta en "otros". */
export const TOP_GENRES = 12
export const TOP_ARTISTS = 15
export const TOP_COUNTRIES = 12

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const VARIOS = new Set(['varios artistas', 'various artists', 'various', 'va', 'varios'])

function add(m: Map<string, StatBucket>, key: string, label: string, bytes: number) {
  const b = m.get(key)
  if (b) { b.tracks++; b.bytes += bytes } else m.set(key, { label, tracks: 1, bytes })
}
const byTracks = (a: StatBucket, b: StatBucket) => b.tracks - a.tracks || a.label.localeCompare(b.label, 'es')

export function collectionStats(db: Db): CollectionStats {
  const rows = db.prepare(
    `SELECT f.ext, f.codec, f.size, f.year, f.genre, f.artist, f.album_artist, f.album, a.grade
     FROM files f LEFT JOIN analysis a ON a.file_id = f.id WHERE f.kind = 'musica' AND ${visible('f')}`,
  ).all() as unknown as Row[]

  const decades = new Map<string, StatBucket>(), genres = new Map<string, StatBucket>(), formats = new Map<string, StatBucket>()
  const artists = new Map<string, { artist: string; albums: Set<string>; tracks: number }>()
  const out: CollectionStats = {
    tracks: rows.length, bytes: 0, withYear: 0, withGenre: 0, byGrade: {}, decades: [], genres: [], genresOther: 0, formats: [], topArtists: [],
    cdOrBetter: { count: 0, graded: 0, bytes: 0, hiRes: 0, lossless: 0 },
    countries: [], withCountry: 0, countryArtists: 0,
  }
  // el país va por el artista del tema (en un compilado, el artista del álbum es "Varios Artistas")
  const country = countriesFor(db, new Set(rows.map((r) => r.artist?.trim()).filter((a): a is string => !!a)))
  const countries = new Map<string, StatBucket>(), withCountry = new Set<string>()
  for (const r of rows) {
    const size = r.size || 0
    out.bytes += size
    if (r.year && r.year >= 1900 && r.year <= 2099) { out.withYear++; const d = Math.floor(r.year / 10) * 10; add(decades, String(d), `${d}s`, size) }
    const g = generoPrincipal(r.genre) // uno por tema: el principal (shared/generos.ts); "Electronic, Latin, Pop" no es un género aparte
    if (g) { out.withGenre++; add(genres, fold(g), g, size) }
    const ext = (r.ext || '').toLowerCase()
    add(formats, ext, ext.toUpperCase() || '¿?', size)
    const who = (r.album_artist?.trim() || r.artist?.trim() || '')
    if (who && !VARIOS.has(fold(who))) {
      const k = fold(who)
      const a = artists.get(k) ?? { artist: who, albums: new Set<string>(), tracks: 0 }
      a.tracks++
      if (r.album?.trim()) a.albums.add(fold(r.album))
      artists.set(k, a)
    }
    const c = r.artist?.trim() ? country.get(artistKey(mainArtist(r.artist))) : undefined
    if (c) { out.withCountry++; withCountry.add(artistKey(mainArtist(r.artist!))); add(countries, c, countryName(c), size) }
    if (isLossless(r.codec, ext)) out.cdOrBetter.lossless++
    if (r.grade) {
      out.cdOrBetter.graded++
      out.byGrade[r.grade] = (out.byGrade[r.grade] ?? 0) + 1
      if (r.grade === 'A+' || r.grade === 'A') { out.cdOrBetter.count++; out.cdOrBetter.bytes += size; if (r.grade === 'A+') out.cdOrBetter.hiRes++ }
    }
  }
  out.decades = [...decades.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, b]) => b)
  const g = [...genres.values()].sort(byTracks)
  out.genres = g.slice(0, TOP_GENRES)
  out.genresOther = g.slice(TOP_GENRES).reduce((s, b) => s + b.tracks, 0)
  out.formats = [...formats.values()].sort(byTracks)
  out.countries = [...countries.values()].sort(byTracks).slice(0, TOP_COUNTRIES)
  out.countryArtists = withCountry.size
  out.topArtists = [...artists.values()].filter((a) => a.albums.size > 0)
    .sort((a, b) => b.albums.size - a.albums.size || b.tracks - a.tracks || a.artist.localeCompare(b.artist, 'es'))
    .slice(0, TOP_ARTISTS).map((a) => ({ artist: a.artist, albums: a.albums.size, tracks: a.tracks }))
  return out
}
