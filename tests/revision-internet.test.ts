// Ordenar e internet, una sola vez (core/revision-internet.ts) y lo que se arregló al recorrer la pantalla con la base real (13/11):
// el OK queda guardado y suma la regla de los nombres oficiales (el perfil de fábrica no la trae); de MusicBrainz entra tildado
// solo lo seguro y nunca el género; lo dudoso de internet entra sin tildar y no se aplica; un choque que ya es "¿son el mismo
// tema?" no se pregunta dos veces; "choca con…" encuentra al otro aunque cambien las mayúsculas; y un año roto ("0001") no arma
// carpeta.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Organizer, targetFor, type TagRow } from '@paila/core/organizer'
import { anioDe } from '@paila/core/organizer-names'
import { Changes } from '@paila/core/changes'
import { guardarRepetidos } from '@paila/core/repetidos-guardados'
import { paraAplicar } from '@paila/core/aplicar'
import { leerRevision } from '@paila/core/revision'
import { elegirCarpetas, idPorLugar, sumarNombres } from '@paila/core/revision-armar'
import { anotarBusqueda, CADA, deMusicBrainz, elegirInternet, internetElegido, oficialesDudosos, sumarSinTildar, tocaBuscar } from '@paila/core/revision-internet'
import { reglasGuardadas } from '@paila/core/tidy-reglas'
import type { MbProposal } from '@paila/core/musicbrainz'
import type { DupGroup, DupItem, TidyReview } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const REGLA = { rule: '%artista%/%año% - %album%/%n% - %titulo%', dest: 'Biblioteca' } // idioma-ok: la regla y la carpeta de fábrica

async function armar(temas: [string, Record<string, string>, number][]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-revnet-'))
  const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(M(''), { recursive: true })
  for (const [rel, meta, freq] of temas) {
    fs.mkdirSync(path.dirname(M(rel)), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=1`, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), M(rel)])
  }
  const lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(M(''), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid)?.path ?? null
  const changes = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
  const organizer = new Organizer(lib.db, rootPath)
  const id = (nombre: string) => (lib.db.prepare('SELECT id FROM files WHERE rel_path LIKE ?').get(`%${nombre}`) as { id: number }).id
  const leer = () => leerRevision(lib.db, changes, organizer)
  const ajuste = (k: string) => (lib.db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null
  return { lib, changes, id, leer, ajuste, d: { db: lib.db, changes, organizer }, cerrar: () => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

let b: Awaited<ReturnType<typeof armar>> | null = null
afterEach(() => { b?.cerrar(); b = null })

const mb = (fileId: number, confidence: 'alta' | 'media', suspicious: boolean, fills: MbProposal['fills']): MbProposal =>
  ({ fileId, rel: 'x.mp3', confidence, suspicious, fills, mbid: 'm', score: 100, artist: 'a', title: 't', album: null, year: null, releaseId: null, track: null, genre: null,
    current: { artist: 'a', title: 't', album: null, year: null, genre: null } })

describe('internet, una sola vez', () => {
  it('el OK queda guardado y suma la regla de los nombres oficiales, que el perfil de fábrica no trae', async () => {
    b = await armar([])
    expect(internetElegido(b.lib.db)).toBeNull()
    expect(reglasGuardadas(b.ajuste)).not.toContain('oficial')
    elegirInternet(b.lib.db, true)
    expect(internetElegido(b.lib.db)).toBe('si')
    expect(reglasGuardadas(b.ajuste)).toContain('oficial')
    // las reglas de antes siguen (no se cambia el perfil: se suma una)
    expect(reglasGuardadas(b.ajuste)).toEqual(expect.arrayContaining(['rotos', 'basura', 'vinilo']))
    // "ahora no" no saca nada: solo deja de buscar
    elegirInternet(b.lib.db, false)
    expect(internetElegido(b.lib.db)).toBe('no')
    expect(tocaBuscar(b.lib.db)).toBe(false)
  }, 60_000)

  it('vuelve a buscar sola una vez por día, no cada vez que entrás', async () => {
    b = await armar([])
    elegirInternet(b.lib.db, true)
    expect(tocaBuscar(b.lib.db, 1000)).toBe(true)
    anotarBusqueda(b.lib.db, 1000)
    expect(tocaBuscar(b.lib.db, 1000 + CADA - 1)).toBe(false)
    expect(tocaBuscar(b.lib.db, 1000 + CADA)).toBe(true)
  }, 60_000)

  it('MusicBrainz: confianza alta y disco normal entra tildado (también el género que falta); media, dudoso; un vivo o recopilación, no', () => {
    const r = deMusicBrainz([
      mb(1, 'alta', false, [{ field: 'album', value: 'Oktubre' }, { field: 'year', value: '1986' }, { field: 'genre', value: 'Rock' }]),
      mb(2, 'media', false, [{ field: 'album', value: 'Quizás' }]),
      mb(3, 'alta', true, [{ field: 'album', value: 'En vivo en Obras' }]),
    ])
    expect(r.seguros.map((p) => [p.id, p.field])).toEqual([[1, 'album'], [1, 'year'], [1, 'genre']])
    expect(r.dudosos.map((p) => [p.id, p.field])).toEqual([[2, 'album']])
    expect(r.descartados.map((p) => [p.id, p.field])).toEqual([[3, 'album']])
    expect([...r.seguros, ...r.dudosos].every((p) => p.source === 'internet')).toBe(true)
  })

  it('los nombres oficiales dudosos son los que Arreglar nombres deja para mirar a mano', () => {
    const rev = (o: Partial<TidyReview>): TidyReview => ({ id: 1, rel: 'x', field: 'artist', from: 'a', to: 'b', why: '', staged: false, ...o })
    expect(oficialesDudosos([rev({ origin: 'oficial' }), rev({ id: 2 }), rev({ id: 3, origin: 'oficial', blocked: true }), rev({ id: 4, origin: 'oficial', staged: true })]))
      .toEqual([{ id: 1, field: 'artist', value: 'b', source: 'oficial' }])
  })

  it('lo dudoso entra sin tildar: se ve en "De internet", no cuenta para Aplicar y no pisa lo que ya estaba', async () => {
    b = await armar([['A/uno.mp3', { artist: 'La Renga', title: 'Uno' }, 300], ['A/dos.mp3', { artist: 'La Renga', title: 'Dos' }, 500]])
    const uno = b.id('uno.mp3'), dos = b.id('dos.mp3')
    b.changes.stageMany([{ id: dos, field: 'album', value: 'El que ya estaba' }], 'internet')
    const n = sumarSinTildar(b.lib.db, b.changes, [{ id: uno, field: 'album', value: 'Quizás' }, { id: dos, field: 'album', value: 'Otro' }])
    expect(n).toBe(1)
    const r = b.leer()
    expect(r.grupos.net.map((f) => [f.fileId, f.despues, f.on]).sort()).toEqual([[uno, 'Quizás', false], [dos, 'El que ya estaba', true]].sort())
    expect(r.listos).toBe(1)
    expect(paraAplicar(b.lib.db, b.changes).map((c) => c.fileId)).toEqual([dos])
  }, 60_000)

  it('los nombres oficiales dudosos se suman sin tildar solo con el OK de internet', async () => {
    b = await armar([['A/uno.mp3', { artist: 'la renga', title: 'Uno' }, 300]])
    const uno = b.id('uno.mp3')
    const nombres = { p: [], dudosos: [{ id: uno, field: 'artist' as const, value: 'La Renga', source: 'oficial' as const }] }
    sumarNombres(b.d, nombres)
    expect(b.leer().grupos.net).toEqual([])
    elegirInternet(b.lib.db, true)
    sumarNombres(b.d, nombres)
    expect(b.leer().grupos.net.map((f) => [f.campo, f.on])).toEqual([['artist', false]])
  }, 60_000)
})

describe('lo que se vio con la base real (13/11)', () => {
  const item = (id: number, rel: string): DupItem => ({ id, rel, ext: 'mp3', size: 1, kbps: 128, duration: 1, grade: 'B', kind: 'musica' } as DupItem)
  const grupo = (items: DupItem[], keep: number | null): DupGroup => ({ level: 'probable', label: 'probable', why: 'prueba', items, keep, similarity: null, warning: null, decidir: true })

  it('dos que irían al mismo lugar y ya son "¿son el mismo tema?" se preguntan una sola vez', async () => {
    b = await armar([
      ['A/x.mp3', { artist: 'Los Nota Lokos', title: 'Es La Que Va' }, 300],
      ['B/y.mp3', { artist: 'Los Nota Lokos', title: 'Es La Que Va' }, 600],
    ])
    const x = b.id('A/x.mp3'), y = b.id('B/y.mp3')
    elegirCarpetas(b.d, REGLA)
    expect(b.leer().decidir.map((c) => c.tipo)).toEqual(['choque'])
    guardarRepetidos(b.lib.db, [grupo([item(x, 'A/x.mp3'), item(y, 'B/y.mp3')], x)])
    expect(b.leer().decidir.map((c) => c.tipo)).toEqual(['par'])
  }, 60_000)

  it('"choca con…" encuentra al otro tema aunque cambien las mayúsculas (como en Windows)', async () => {
    b = await armar([['Biblioteca/Los Nota Lokos/Es la que va.mp3', { artist: 'Los Nota Lokos', title: 'Es la que va' }, 300]])
    expect(idPorLugar(b.lib.db, 'Biblioteca/Los Nota Lokos/Es La Que Va.mp3')).toBe(b.id('Es la que va.mp3'))
  }, 60_000)

  it('un año roto ("0001", "01-0") no arma carpeta de año; uno de verdad sí', () => {
    expect([anioDe('0001'), anioDe('01-0'), anioDe(null), anioDe('1987-05-01'), anioDe(' 2006 ')]).toEqual([null, null, null, '1987', '2006'])
    const row = (year: string): TagRow => ({ id: 1, rootId: 1, rel: 'x.flac', ext: 'flac', kind: 'musica', artist: 'Almafuerte', albumArtist: null, title: 'Toro y Pampa', album: 'Toro y Pampa', track: '9', year, genre: null })
    expect(targetFor(row('0001'), REGLA, false)).toBe('Biblioteca/Almafuerte/Toro y Pampa/09 - Toro y Pampa.flac')
    expect(targetFor(row('2006'), REGLA, false)).toBe('Biblioteca/Almafuerte/2006 - Toro y Pampa/09 - Toro y Pampa.flac')
  })
})
