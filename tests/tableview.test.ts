// Filtrar y ordenar la tabla (shared/tableview.ts): el orden rápido tiene que dar lo mismo que el de antes (localeCompare).
import { describe, expect, it } from 'vitest'
import type { Track } from '@paila/shared/types'
import { filterTracks, sortTracks } from '@paila/shared/tableview'

const t = (id: number, artist: string | null, title: string | null, extra: Partial<Track> = {}): Track => ({
  id, rootId: 1, rel: `Música/${artist ?? 'x'} - ${title ?? 'y'}.mp3`, kind: 'musica', ext: 'mp3', codec: 'mp3', sampleRate: 44100, bits: null, channels: 2,
  kbps: 320, duration: 200, artist, albumArtist: null, title, album: null, track: null, year: null, genre: null, size: 1, mtime: 1, error: null,
  grade: null, isLabel: null, flags: null, effKbps: null, cutoff: null, lufs: null, bpm: null, musicKey: null, camelot: null, energy: null, missing: null, tempo: null, ...extra,
})

const NAMES = ['Ñandú', 'nandu', 'Árbol', 'arbol', 'Zeta', 'zeta 10', 'zeta 9', 'Éxito', '', 'B2', 'b10', 'b1', 'Ça va', 'Öl', 'oz', '10 Años', '9 Años']

describe('tabla', () => {
  it('ordena igual que localeCompare("es", numérico), con los vacíos al final', () => {
    const tracks = NAMES.map((n, i) => t(i + 1, n || null, 'x'))
    const value = (x: Track) => (x.artist ?? '').toLowerCase()
    for (const dir of [1, -1] as const) {
      const old = [...tracks].sort((a, b) => {
        const x = value(a), y = value(b)
        const ex = x === '', ey = y === ''
        if (ex !== ey) return ex ? 1 : -1
        return x.localeCompare(y, 'es', { numeric: true }) * dir
      }).map((x) => x.id)
      expect(sortTracks([...tracks], value, dir).map((x) => x.id)).toEqual(old)
    }
  })

  it('busca en artista, título, álbum, género y carpeta, y filtra por colección', () => {
    const tracks = [t(1, 'Babasónicos', 'Irresponsables'), t(2, 'Soda Stereo', 'Luna roja', { genre: 'Rock' }), t(3, 'Luna', 'x', { kind: 'produccion' })]
    const ids = (words: string[], kind: Track['kind'] | 'todo' = 'todo') => filterTracks(tracks, { words, kind, test: null, inPl: null }).map((x) => x.id)
    expect(ids(['luna'])).toEqual([2, 3])
    expect(ids(['luna'], 'musica')).toEqual([2])
    expect(ids(['rock', 'soda'])).toEqual([2])
    expect(ids(['irresponsables'])).toEqual([1])
    expect(filterTracks(tracks, { words: [], kind: 'todo', test: null, inPl: new Map([[3, 0]]) }).map((x) => x.id)).toEqual([3])
  })
})
