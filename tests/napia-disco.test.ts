// "Un disco" en NAPIA (DECISIONES 07/11; core/sockseek/disco.ts y disco-correr.ts): la lista oficial de MusicBrainz y Deezer (con
// respuestas guardadas, sin internet), emparejar la carpeta que llegó con esa lista, y de punta a punta con el sockseek de mentira:
// primero la carpeta entera de una persona (lo trucho a descartados), después tema por tema solo lo que falta.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ARGS_CARPETA, buscarDisco, buscarEdiciones, emparejar, filaCarpeta, sinRemaster, temasDe, tituloDeArchivo, type Pedir } from '@paila/core/sockseek/disco'
import { bajarCarpetaEntera, listaDeDisco } from '@paila/core/sockseek/disco-correr'
import { buildArgs, listRows } from '@paila/core/sockseek/args'
import { rutasTrabajo } from '@paila/core/sockseek/carpetas'
import { listCsv } from '@paila/core/sockseek/args'
import { SockseekRun } from '@paila/core/sockseek/run'
import type { EdicionDisco, NapiaOptions } from '@paila/shared/napia'

const FALSO = path.join(__dirname, 'fixtures', 'sockseek-falso.mjs')
const OPC: NapiaOptions = { calidad: 'cualquiera', sacarRemaster: true, primeros: null, saltearTenes: false }

// lo que contestan MusicBrainz y Deezer (recortado de respuestas reales)
const MB_BUSCA = { releases: [
  { id: 'mb-2', title: 'Love and Sex', date: '2014-02-11', country: 'XW', status: 'Official', 'track-count': 15, media: [{ format: 'Digital Media', 'track-count': 15 }], 'artist-credit': [{ name: 'Plan B' }], 'release-group': { 'primary-type': 'Album' } },
  { id: 'mb-1', title: 'Love and Sex', date: '2014-02-04', country: 'US', status: 'Official', 'track-count': 14, media: [{ format: 'CD', 'track-count': 14 }], 'artist-credit': [{ name: 'Plan B' }], 'release-group': { 'primary-type': 'Album' } },
  { id: 'mb-x', title: 'Love and Sex (bootleg)', status: 'Bootleg', 'track-count': 9 },
  { id: 'mb-y', title: 'Otra Cosa', status: 'Official', 'track-count': 3 },
] }
const DZ_BUSCA = { data: [{ id: 7400, title: 'Love and Sex', nb_tracks: 15, record_type: 'album', artist: { name: 'Plan B' } }, { id: 7401, title: 'Love And Sex', nb_tracks: 15, record_type: 'album', artist: { name: 'Plan B' } }] }
const MB_TEMAS = { media: [{ tracks: [{ title: 'Love and Sex', length: 200000 }, { title: 'Candy', length: 215500, 'artist-credit': [{ name: 'Plan B' }] }] }, { tracks: [{ title: 'Si No Le Contesto', length: 230000 }] }] }
const DZ_TEMAS = { tracks: { data: [{ title: 'Love and Sex', duration: 200, artist: { name: 'Plan B' } }] } }
const pedir: Pedir = async (url) => {
  if (url.includes('musicbrainz.org/ws/2/release/?')) return MB_BUSCA
  if (url.includes('musicbrainz.org/ws/2/release/mb-1')) return MB_TEMAS
  if (url.includes('deezer.com/search/album')) return DZ_BUSCA
  if (url.includes('deezer.com/album/7400')) return DZ_TEMAS
  throw new Error('sin internet')
}

describe('la lista oficial del disco', () => {
  it('trae las ediciones oficiales de MusicBrainz (de la más vieja a la más nueva) y las de Deezer; sin bootlegs, otros discos ni repetidas', async () => {
    const eds = await buscarEdiciones('Plan B', 'Love and Sex', pedir)
    expect(eds.map((e) => `${e.fuente}:${e.id}:${e.temas}:${e.anio}`)).toEqual(['musicbrainz:mb-1:14:2014', 'musicbrainz:mb-2:15:2014', 'deezer:7400:15:null'])
    expect(eds[0]).toMatchObject({ pais: 'US', formato: 'CD', tipo: 'Album', artista: 'Plan B' })
  })
  it('sin internet no rompe: no hay ediciones', async () => {
    expect(await buscarEdiciones('Plan B', 'Love and Sex', async () => { throw new Error('sin red') })).toEqual([])
  })
  it('la lista de temas, en orden y con la duración en segundos (el disco 2 sigue al 1)', async () => {
    const mb = await temasDe({ fuente: 'musicbrainz', id: 'mb-1', artista: 'Plan B' } as EdicionDisco, pedir)
    expect(mb).toEqual([{ n: 1, artist: 'Plan B', title: 'Love and Sex', duration: 200 }, { n: 2, artist: 'Plan B', title: 'Candy', duration: 216 }, { n: 3, artist: 'Plan B', title: 'Si No Le Contesto', duration: 230 }])
    expect(await temasDe({ fuente: 'deezer', id: '7400', artista: 'Plan B' } as EdicionDisco, pedir)).toEqual([{ n: 1, artist: 'Plan B', title: 'Love and Sex', duration: 200 }])
  })
  it('el pedido de la carpeta entera: una fila sin título, con la cantidad exacta de temas', () => {
    expect(filaCarpeta('Plan B', 'Love and Sex', 14)).toBe('Artist,Title,Album,TrackCount\r\nPlan B,,Love and Sex,14\r\n')
    expect(ARGS_CARPETA).toContain('--strict-album-quality')
  })
  it('empareja cada archivo con su tema: sin número, sin el artista; un bonus queda afuera', () => {
    expect(tituloDeArchivo('07 - Plan B - Si No Le Contesto.flac', 'Plan B')).toBe('sinolecontesto')
    expect(tituloDeArchivo('1-02. Candy.mp3', 'Plan B')).toBe('candy')
    const oficial = [{ n: 1, artist: 'Plan B', title: 'Love and Sex', duration: null }, { n: 2, artist: 'Plan B', title: 'Candy', duration: null }, { n: 3, artist: 'Plan B', title: 'Fanática Sensual', duration: null }]
    const m = emparejar(oficial, ['x/01 Love and Sex.flac', 'x/02 - Candy (Remastered).flac', 'x/03 Uno.flac', 'x/99 Bonus Track.flac'], 'Plan B')
    expect([...m.entries()]).toEqual([[1, 'x/01 Love and Sex.flac'], [2, 'x/02 - Candy (Remastered).flac']])
  })
})

// Soda Stereo, "Canción animal" (el autor en la app, 13/11): MusicBrainz contestó 503 (se le había preguntado seguido) y quedó
// solo la remasterizada de Deezer, que por ser una sola se elegía sola, con "Remasterizado 2007" pegado a cada tema.
describe('varias ediciones de fuentes distintas: Soda Stereo, Canción animal', () => {
  const MB_CA = { releases: [
    { id: 'mb-2007d', title: 'Canción animal', date: '2007-07-27', country: 'AR', status: 'Official', 'track-count': 10, media: [{ format: 'Digital Media' }], 'release-group': { 'primary-type': 'Album' } },
    { id: 'mb-1990a', title: 'Canción animal', date: '1990', country: 'AR', status: 'Official', 'track-count': 10, media: [{ format: 'CD' }], 'release-group': { 'primary-type': 'Album' } },
    { id: 'mb-1990b', title: 'Canción animal', date: '1990', country: 'AR', status: 'Official', 'track-count': 10, media: [{ format: 'CD' }], 'release-group': { 'primary-type': 'Album' } },
    { id: 'mb-2003', title: 'Canción animal', date: '2003', country: 'AR', status: 'Official', disambiguation: 'Réplica vinilo', 'track-count': 10, media: [{ format: 'CD' }], 'release-group': { 'primary-type': 'Album' } },
    { id: 'mb-2007c', title: 'Canción animal', date: '2007', country: 'AR', status: 'Official', 'track-count': 10, media: [{ format: 'CD' }], 'release-group': { 'primary-type': 'Album' } },
    { id: 'mb-2en1', title: '2 en 1: Nada personal / Canción animal', date: '1999', country: 'AR', status: 'Official', 'track-count': 18, media: [{ format: 'CD' }] },
  ] }
  const DZ_CA = { data: [{ id: 1222449, title: 'Canción Animal Remastered', nb_tracks: 10, record_type: 'album', artist: { name: 'Soda Stereo' } }] }
  const DZ_CA_DISCO = { release_date: '2007-07-27', tracks: { data: [{ title: '(En) El Séptimo Día Remasterizado 2007', duration: 300 }, { title: 'Un Millón De Años Luz - Remastered 2007', duration: 290 }] } }
  const contestar = (mb503: number): Pedir => {
    let veces = 0
    return async (url) => {
      if (url.includes('musicbrainz.org')) { if (veces++ < mb503) throw new Error('HTTP 503'); return MB_CA }
      if (url.includes('deezer.com/search/album')) return DZ_CA
      if (url.includes('deezer.com/album/1222449')) return DZ_CA_DISCO
      throw new Error('sin internet')
    }
  }
  const sinEsperar = async () => {}

  it('MusicBrainz contesta 503 una vez: se reintenta y salen todas, la original de 1990 sugerida y la de Deezer como remasterizada', async () => {
    const r = await buscarDisco('Soda Stereo', 'Canción animal', contestar(1), sinEsperar)
    expect(r.sinMusicbrainz).toBe(false)
    expect(r.ediciones.map((e) => `${e.fuente}:${e.anio}:${e.formato}:${e.temas}:${e.clase ?? '-'}:${e.sugerida ? 'sugerida' : ''}`)).toEqual([
      'musicbrainz:1990:CD:10:original:sugerida', 'musicbrainz:2003:CD:10:-:', 'musicbrainz:2007:CD:10:-:', 'musicbrainz:2007:Digital Media:10:-:', 'deezer:2007:Digital:10:remaster:',
    ])
    // el "Remastered" va en la etiqueta de la edición, no en el nombre; la aclaración de MusicBrainz se ve; el "2 en 1" no es este disco
    expect(r.ediciones[4].titulo).toBe('Canción Animal')
    expect(r.ediciones[1].nota).toBe('Réplica vinilo')
    expect(r.ediciones.some((e) => e.titulo.includes('/'))).toBe(false)
  })
  it('si MusicBrainz no contesta nunca, se avisa (puede haber más ediciones) en vez de dar por buena la única de Deezer', async () => {
    const r = await buscarDisco('Soda Stereo', 'Canción animal', contestar(99), sinEsperar)
    expect(r).toMatchObject({ sinMusicbrainz: true, ediciones: [{ fuente: 'deezer', clase: 'remaster', titulo: 'Canción Animal' }] })
    expect(r.ediciones[0].sugerida).toBeUndefined()
  })
  it('los temas, sin el "Remasterizado 2007" pegado', async () => {
    const r = await buscarDisco('Soda Stereo', 'Canción animal', contestar(0), sinEsperar)
    const ts = await temasDe(r.ediciones.find((e) => e.fuente === 'deezer')!, contestar(0))
    expect(ts.map((t) => t.title)).toEqual(['(En) El Séptimo Día', 'Un Millón De Años Luz'])
    expect(['Signos (Remasterizado)', 'Song - 2011 Remaster', 'Love Song (Remastered Version)', 'Remastered'].map(sinRemaster)).toEqual(['Signos', 'Song', 'Love Song', 'Remastered'])
  })
})

describe('bajar un disco entero con el sockseek de mentira', () => {
  it('primero la carpeta de una persona (lo trucho a descartados), después tema por tema solo lo que falta', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'napia-disco-'))
    const datos = path.join(base, 'datos'), destino = path.join(base, 'NAPIA', 'Plan B - Love and Sex'), src = path.join(base, 'de-ana')
    fs.mkdirSync(src, { recursive: true })
    // la carpeta de "ana": dos de los tres temas (uno trucho) y un bonus
    for (const f of ['01 - Love and Sex.mp3', '02 - Candy (trucho).mp3', '99 - Bonus.mp3']) fs.writeFileSync(path.join(src, f), `audio de ${f}`)
    const temas = [{ n: 1, artist: 'Plan B', title: 'Love and Sex', duration: 200 }, { n: 2, artist: 'Plan B', title: 'Candy', duration: 216 }, { n: 3, artist: 'Plan B', title: 'Si No Le Contesto', duration: 230 }]
    const lista = listaDeDisco({ artista: 'Plan B', titulo: 'Love and Sex', edicion: { fuente: 'musicbrainz', id: 'mb-1', artista: 'Plan B', titulo: 'Love and Sex', anio: '2014', pais: 'US', formato: 'CD', temas: 3, tipo: 'Album' } }, temas)
    expect(lista.name).toBe('Plan B - Love and Sex')
    const env = { ...process.env, FALSO_DISCOS: JSON.stringify({ 'Love and Sex': fs.readdirSync(src).map((f) => path.join(src, f)) }) }
    const vistos: number[] = []
    const intento = await bajarCarpetaEntera(lista, {
      datos, carpeta: destino,
      correr: (csv, trabajo, indice) => new SockseekRun({ command: process.execPath, args: [FALSO, ...buildArgs({ csvPath: csv, outputDir: trabajo, options: OPC, indexPath: indice }), ...ARGS_CARPETA], env }, [], () => {}),
      revisar: async (f) => ({ motivo: /trucho/.test(f) ? 'inflado' : null }),
      arreglar: async (p, f) => `${p.artist} - ${p.title}${path.extname(f)}`,
      onCambio: (i) => vistos.push(i.llegaron),
    })
    expect(intento).toEqual({ llegaron: 1, truchos: 1, de: 3 })
    expect(vistos.at(-1)).toBe(1)
    expect(fs.readdirSync(destino).sort()).toEqual(['Plan B - Love and Sex.mp3', 'descartados'])
    expect(fs.readdirSync(path.join(destino, 'descartados'))).toEqual(['02 - Candy (trucho).mp3'])
    // el pedido y la carpeta de trabajo de este intento no quedan
    expect(fs.existsSync(rutasTrabajo(datos, 'Plan B - Love and Sex - carpeta entera').carpeta)).toBe(false)
    // tema por tema, con el índice de la lista: lo que ya llegó se saltea
    const rt = rutasTrabajo(datos, lista.name)
    const csv = path.join(datos, 'listas', `${lista.name}.csv`)
    fs.writeFileSync(csv, listCsv(lista.tracks, OPC))
    const rows = listRows(lista.tracks, OPC)
    const r = new SockseekRun({ command: process.execPath, args: [FALSO, ...buildArgs({ csvPath: csv, outputDir: rt.trabajo, options: OPC, indexPath: rt.indice })], env: process.env }, rows, () => {})
    await r.done
    expect(r.progress.counts()).toMatchObject({ yaEstaba: 1, bajado: 2 })
    fs.rmSync(base, { recursive: true, force: true })
  }, 30_000)
})
