// Traer las playlists de Rekordbox (rekordbox.xml) y leer pendrives de CDJ (MASTERPLAN-3, 4): los lectores propios del
// export.pdb y los ANLZ, el emparejamiento (ruta, mismo archivo, huella, nombre) y la tanda en la base, con deshacer.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { parseRbPlaylists, parseRbXml } from '@paila/core/rbxml'
import { parsePdb, PDB_COLOURS } from '@paila/core/pdb'
import { mergeAnlz, parseAnlz } from '@paila/core/anlz'
import { ListImports, findPdb, readPendrive, readRbXml } from '@paila/core/listimport'
import { Requests } from '@paila/core/requests'
import { Playlists } from '@paila/core/playlists'
import { Wanted } from '@paila/core/wanted'
import { DjData } from '@paila/core/djdata'
import { History } from '@paila/core/history'
import { Improver } from '@paila/core/improve'
import { buildAnlz, buildPdb, dstr, type FxTrack } from './fixtures/pendrive'

// La biblioteca de prueba: C:\M en Windows y /M en Mac (Rekordbox guarda las rutas del sistema donde corre)
const RAIZ = process.platform === 'win32' ? 'C:\\M' : '/M'
const RAIZ_URL = process.platform === 'win32' ? 'C:/M' : 'M'

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0"><PRODUCT Name="rekordbox" Version="6.8.5" Company="AlphaTheta"/>
<COLLECTION Entries="4">
<TRACK TrackID="11" Name="Africa" Artist="Toto" Album="Toto IV" TotalTime="295" Size="7000" Location="file://localhost/${RAIZ_URL}/Rock/Toto%20-%20Africa.mp3"/>
<TRACK TrackID="12" Name="Movido" Artist="Alguien" TotalTime="200" Size="5555" Location="file://localhost/D:/Viejo/Alguien%20-%20Movido.mp3"/>
<TRACK TrackID="13" Name="Bette Davis Eyes" Artist="Kim Carnes" TotalTime="228" Size="1" Location="file://localhost/D:/Viejo/kim.mp3"/>
<TRACK TrackID="14" Name="No Lo Tengo" Artist="Nadie" TotalTime="180" Size="2" Location="file://localhost/D:/Viejo/nadie.mp3"><TEMPO Inizio="0.1" Bpm="120.00" Metro="4/4" Battito="1"/></TRACK>
</COLLECTION>
<PLAYLISTS>
<NODE Type="0" Name="ROOT" Count="2">
  <NODE Name="Fiestas" Type="0" Count="2">
    <NODE Name="Casamiento &amp; más" Type="1" KeyType="0" Entries="3"><TRACK Key="13"/><TRACK Key="11"/><TRACK Key="14"/></NODE>
    <NODE Name="Vacía" Type="1" KeyType="0" Entries="0"/>
  </NODE>
  <NODE Name="Por ruta" Type="1" KeyType="1" Entries="2"><TRACK Key="file://localhost/D:/Viejo/Alguien%20-%20Movido.mp3"/><TRACK Key="file://localhost/${RAIZ_URL}/Rock/Toto%20-%20Africa.mp3"/></NODE>
  <NODE Name="Vacía suelta" Type="0" Count="0"/>
</NODE>
</PLAYLISTS></DJ_PLAYLISTS>`

describe('las playlists del rekordbox.xml', () => {
  it('lee carpetas, playlists vacías y las que nombran los temas por ruta; la colección no se mezcla', () => {
    const tracks = parseRbXml(XML)
    expect(tracks.map((t) => t.trackId)).toEqual(['11', '12', '13', '14'])
    expect(parseRbPlaylists(XML)).toEqual([
      { name: 'Casamiento & más', folders: ['Fiestas'], trackIds: ['13', '11', '14'] },
      { name: 'Vacía', folders: ['Fiestas'], trackIds: [] },
      { name: 'Por ruta', folders: [], trackIds: ['12', '11'] },
    ])
    expect(parseRbPlaylists('<DJ_PLAYLISTS><COLLECTION></COLLECTION></DJ_PLAYLISTS>')).toEqual([])
  })
})

const T = (id: number, title: string, artistId: number, extra: Partial<FxTrack> = {}): FxTrack => ({ id, title, artistId, path: `/Contents/x/${title}.mp3`, size: 1000 + id, seconds: 200, bpm: 124.5, ...extra })

describe('el export.pdb de un pendrive (lector propio)', () => {
  it('temas con sus artistas, discos, géneros y tonos; textos con acentos; filas borradas afuera; varias páginas', () => {
    const many = Array.from({ length: 40 }, (_, i) => T(100 + i, `Tema ${i}`, 1))
    const pdb = parsePdb(buildPdb({
      tracks: [T(1, 'Canción de cuna', 2, { albumId: 5, genreId: 3, keyId: 4, rating: 4, color: 2, isrc: 'ARAB11200001', analyze: '/PIONEER/USBANLZ/P001/0001/ANLZ0000.DAT' }), ...many],
      deletedTrack: T(999, 'Borrado', 1),
      artists: [{ id: 1, name: 'Toto' }, { id: 2, name: 'Mercedes Sosa', far: true }],
      albums: [{ id: 5, name: 'Corazón libre', far: true }], genres: [{ id: 3, name: 'Folklore' }], keys: [{ id: 4, name: '8A' }],
      lists: [], perPage: 16,
    }))
    expect(pdb.tracks).toHaveLength(41)
    expect(pdb.tracks.map((t) => t.id)).not.toContain(999)
    expect(pdb.tracks[0]).toMatchObject({ id: 1, title: 'Canción de cuna', artist: 'Mercedes Sosa', album: 'Corazón libre', genre: 'Folklore', key: '8A', bpm: 124.5, seconds: 200, size: 1001, rating: 4, colorId: 2, isrc: 'ARAB11200001', path: '/Contents/x/Canción de cuna.mp3', fileName: 'Canción de cuna.mp3', analyzePath: '/PIONEER/USBANLZ/P001/0001/ANLZ0000.DAT' })
    expect(pdb.tracks[40]).toMatchObject({ title: 'Tema 39', artist: 'Toto' })
  })

  it('playlists y carpetas en el orden de Rekordbox; los temas en el orden de cada playlist', () => {
    const pdb = parsePdb(buildPdb({
      tracks: [T(1, 'A', 1), T(2, 'B', 1), T(3, 'C', 1)], artists: [{ id: 1, name: 'X' }],
      lists: [{ id: 10, parent: 0, name: 'Boliche', folder: true, sort: 1 }, { id: 11, parent: 10, name: 'Cierre', sort: 2, tracks: [3, 1] }, { id: 12, parent: 10, name: 'Apertura', sort: 1, tracks: [2, 3, 1] }, { id: 13, parent: 0, name: 'Suelta', sort: 0, tracks: [] }],
    }))
    expect(pdb.playlists.map((p) => [p.name, p.folder, p.parentId, p.trackIds])).toEqual([
      ['Suelta', false, 0, []], ['Boliche', true, 0, []], ['Apertura', false, 10, [2, 3, 1]], ['Cierre', false, 10, [3, 1]],
    ])
  })

  it('lo que no es un export.pdb da un error claro; los textos cortos y los largos', () => {
    expect(() => parsePdb(new Uint8Array(100))).toThrow(/no es un export.pdb/)
    expect(() => parsePdb(Uint8Array.from([1, 2, 3, 4, 0, 16, 0, 0]))).toThrow(/no es un export.pdb/)
    expect(dstr('Hola')[0]).toBe(0x0b)
    expect(dstr('Ñandú')[0]).toBe(0x90)
    expect(PDB_COLOURS[2]).toBe('#FF0000')
  })
})

describe('los ANLZ (grilla y cues del pendrive)', () => {
  it('la grilla: un tramo nuevo solo cuando cambia el tempo; el 1 del compás', () => {
    const a = parseAnlz(buildAnlz({ beats: [[2, 120, 100], [3, 120, 600], [4, 120, 1100], [1, 120, 1600], [2, 121.5, 2100], [3, 121.5, 2594]] }))
    expect(a.grid).toEqual([{ start: 0.1, bpm: 120, beat: 2 }, { start: 2.1, bpm: 121.5, beat: 2 }])
  })
  it('cues del .DAT (hot, memory y loop) y del .EXT con nombre y color; el .EXT gana', () => {
    const dat = parseAnlz(buildAnlz({ beats: [[1, 128, 50]], cues: [{ hot: 0, ms: 50 }, { hot: 1, ms: 30050 }, { hot: 2, loop: true, ms: 60000, loopMs: 61875 }] }))
    expect(dat.cues).toEqual([
      { name: '', type: 0, start: 0.05, end: null, num: -1, color: null },
      { name: '', type: 0, start: 30.05, end: null, num: 0, color: null },
      { name: '', type: 4, start: 60, end: 61.875, num: 1, color: null },
    ])
    const ext = parseAnlz(buildAnlz({ ext: true, cues: [{ hot: 1, ms: 30050, name: 'Drop ñ', rgb: [255, 0, 0] }, { hot: 0, ms: 50 }] }))
    expect(ext.cues).toEqual([
      { name: '', type: 0, start: 0.05, end: null, num: -1, color: null },
      { name: 'Drop ñ', type: 0, start: 30.05, end: null, num: 0, color: '#FF0000' },
    ])
    const m = mergeAnlz(dat, ext)
    expect(m.grid).toEqual(dat.grid)
    expect(m.cues).toEqual(ext.cues)
    expect(() => parseAnlz(new Uint8Array(40))).toThrow(/no es un análisis/)
  })
})

describe('traer de a tanda, con la lista «Faltan o suenan mal» y deshacer', () => {
  let dir: string, db: Db, pl: Playlists, wanted: Wanted, req: Requests, dj: DjData, imp: ListImports
  const ids: Record<string, number> = {}
  const add = (rel: string, artist: string, title: string, duration: number, size: number, grade = 'B') => {
    const id = Number(db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, title, duration) VALUES (1, ?, ?, 1, 'musica', 'mp3', ?, ?, ?)").run(rel, size, artist, title, duration).lastInsertRowid)
    db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade) VALUES (?, 1, 1, 1, 'x', ?)").run(id, grade)
    return id
  }
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-traer-'))
    db = openDb(path.join(dir, 'paila.db'))
    db.exec("INSERT INTO volumes (id, serial, last_mount) VALUES (1, 'X', 'C:\\\\'); INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', 'x')")
    const pathOf = (id: number) => { const r = db.prepare('SELECT rel_path AS rel FROM files WHERE id = ?').get(id) as { rel: string } | undefined; return r ? path.join(RAIZ, ...r.rel.split('/')) : null }
    pl = new Playlists(db, pathOf)
    wanted = new Wanted(db)
    req = new Requests(db, pl, wanted, pathOf)
    dj = new DjData(db, () => null)
    imp = new ListImports(db, req, pl, dj)
    ids.africa = add('Rock/Toto - Africa.mp3', 'Toto', 'Africa', 295, 7000)
    ids.movido = add('Nuevo/Alguien - Movido.mp3', 'Alguien', 'Movido', 200, 5555)
    // con un artista de más en los tags: el nombre coincide, pero no exacto (probable, para confirmar)
    ids.kim = add('Kim Carnes - Bette Davis Eyes.mp3', 'Kim Carnes, Coro', 'Bette Davis Eyes', 229, 9999)
  })
  afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('rekordbox.xml: ruta, mismo archivo en otra carpeta y probable; vista previa sin guardar nada', async () => {
    const xml = path.join(dir, 'rekordbox.xml')
    fs.writeFileSync(xml, XML)
    const p = await imp.preview(readRbXml(xml))
    expect(db.prepare('SELECT COUNT(*) AS n FROM playlists').get()).toMatchObject({ n: 0 })
    expect(p).toMatchObject({ kind: 'xml', tracks: 4, how: { ruta: 1, archivo: 1, probable: 1, none: 1 } })
    expect(p.lists.map((l) => [l.name, l.folders, l.total, l.counts])).toEqual([
      ['Casamiento & más', ['Fiestas'], 3, { tenes: 1, baja: 0, falta: 1, revisar: 1 }],
      ['Vacía', ['Fiestas'], 0, { tenes: 0, baja: 0, falta: 0, revisar: 0 }],
      ['Por ruta', [], 2, { tenes: 2, baja: 0, falta: 0, revisar: 0 }],
    ])
    expect(imp.items(p.token, '0').map((i) => [i.position, i.key, i.kind, i.file?.id ?? null])).toEqual([[1, '13', 'probable', ids.kim], [2, '11', 'ruta', ids.africa], [3, '14', 'none', null]])
    // confirmar el probable: cambia la cuenta
    expect(imp.summary(p.token, { 13: 'si' }).lists[0].counts).toEqual({ tenes: 2, baja: 0, falta: 1, revisar: 0 })
  })

  it('crear: carpeta "De Rekordbox" con las carpetas de adentro, los temas en orden y lo que falta a la Lista; Historial y deshacer', async () => {
    const xml = path.join(dir, 'rekordbox.xml')
    const p = await imp.preview(readRbXml(xml))
    const r = imp.create(p.token, ['0', '1', '2'], { 13: 'si' })
    expect(r).toMatchObject({ playlists: 2, inLists: 4, toGet: 1, folderName: 'De Rekordbox' }) // la vacía no se crea
    const tree = pl.tree()
    const top = tree.find((n) => n.name === 'De Rekordbox')!
    const fiestas = tree.find((n) => n.name === 'Fiestas')!
    expect([top.kind, fiestas.parentId]).toEqual(['folder', top.id])
    const casamiento = tree.find((n) => n.name === 'Casamiento & más')!
    expect(casamiento.parentId).toBe(fiestas.id)
    expect(pl.trackIds(casamiento.id)).toEqual([ids.kim, ids.africa])
    expect(pl.trackIds(tree.find((n) => n.name === 'Por ruta')!.id)).toEqual([ids.movido, ids.africa])
    expect(wanted.list().map((w) => [w.artist, w.title, w.requests])).toEqual([['Nadie', 'No Lo Tengo', ['Casamiento & más']]])
    // los pedidos de la tanda no se mezclan con los de "Traer una lista"; el Historial los junta en una sola fila
    expect(req.list()).toEqual([])
    const h = new History(db, { improver: new Improver(db), requests: req, imports: imp, rootPath: () => null } as never)
    const e = h.list().find((x) => x.kind === 'traidas')!
    expect(e.summary).toBe('Se trajeron 2 playlists de Rekordbox (rekordbox.xml) — 4 de 5 temas en las playlists; 1 a la lista «Faltan o suenan mal»')
    expect(h.detail('traidas', e.id).rows.map((x) => [x.name, x.what])).toEqual([['Casamiento & más', '2 de 3 temas'], ['Por ruta', '2 de 2 temas']])
    // una playlist tuya guardada adentro de la carpeta no se borra al deshacer
    const mine = pl.create('Mía', 'list', top.id)
    await h.undo('traidas', e.id)
    expect(pl.tree().map((n) => n.name).sort()).toEqual(['De Rekordbox', 'Mía'])
    expect(wanted.list()).toEqual([])
    expect(h.list().find((x) => x.kind === 'traidas')).toMatchObject({ undone: true, canUndo: false })
    pl.remove(mine); pl.remove(top.id)
  })

  it('pendrive: lee el export.pdb y los ANLZ de la carpeta, empareja por mismo archivo, nombre y huella, y recupera grilla y cues', async () => {
    const usb = path.join(dir, 'usb')
    fs.mkdirSync(path.join(usb, 'PIONEER', 'rekordbox'), { recursive: true })
    const anlz = (n: string) => path.join(usb, 'PIONEER', 'USBANLZ', 'P001', n)
    fs.mkdirSync(anlz(''), { recursive: true })
    fs.writeFileSync(anlz('A.DAT'), buildAnlz({ beats: [[1, 118, 200], [2, 118, 708]], cues: [{ hot: 1, ms: 200 }] }))
    fs.writeFileSync(anlz('A.EXT'), buildAnlz({ ext: true, cues: [{ hot: 1, ms: 200, name: 'Arranque', rgb: [0, 255, 0] }] }))
    fs.writeFileSync(anlz('B.DAT'), buildAnlz({ beats: [[1, 100, 0]] }))
    fs.writeFileSync(path.join(usb, 'PIONEER', 'rekordbox', 'export.pdb'), buildPdb({
      tracks: [
        { id: 1, title: 'Africa', artistId: 1, path: '/Contents/Toto/Toto - Africa.mp3', analyze: '/PIONEER/USBANLZ/P001/A.DAT', size: 7000, seconds: 295, bpm: 118, rating: 5, color: 5 },
        { id: 2, title: 'Bette Davis Eyes', artistId: 2, path: '/Contents/Kim/kim.mp3', analyze: '/PIONEER/USBANLZ/P001/B.DAT', size: 3, seconds: 228, bpm: 100 },
        { id: 3, title: 'Grabado en vivo', artistId: 3, path: '/Contents/X/raro.mp3', size: 4, seconds: 300, bpm: 0 },
      ],
      artists: [{ id: 1, name: 'Toto' }, { id: 2, name: 'Kim Carnes' }, { id: 3, name: 'Desconocido' }],
      lists: [{ id: 7, parent: 0, name: 'Set del sábado', sort: 0, tracks: [1, 2, 3] }],
    }))
    // el archivo "raro" está en el pendrive: la huella dice que es Movido
    fs.mkdirSync(path.join(usb, 'Contents', 'X'), { recursive: true })
    fs.writeFileSync(path.join(usb, 'Contents', 'X', 'raro.mp3'), 'x')
    expect(findPdb(path.join(usb, 'PIONEER'))?.root).toBe(usb)
    expect(findPdb(path.join(usb, 'PIONEER', 'rekordbox'))?.root).toBe(usb)
    expect(findPdb(dir)).toBeNull()
    const lib = readPendrive(usb)
    expect(lib.label).toBe('Pendrive «usb»') // una carpeta; un disco entero dice "Pendrive E:"
    expect(lib.tracks[0].dj).toMatchObject({ stars: 5, colour: '#00FF00', grid: [{ start: 0.2, bpm: 118, beat: 1 }], cues: [{ name: 'Arranque', num: 0, color: '#00FF00' }] })
    let p = await imp.preview(lib)
    expect(p).toMatchObject({ kind: 'pendrive', how: { archivo: 1, probable: 1, none: 1 }, printable: 1, dj: { tracks: 1, grids: 1, cues: 1, stars: 1, colours: 1 } })
    // por huella (aquí, de mentira): solo los que no tienen pareja segura y cuyo archivo está
    const asked: string[] = []
    p = await imp.byPrint(p.token, async (file) => { asked.push(path.basename(file)); return file.endsWith('raro.mp3') ? ids.movido : null })
    expect(asked).toEqual(['raro.mp3'])
    expect(p).toMatchObject({ how: { archivo: 1, huella: 1, probable: 1, none: 0 }, printed: true, printable: 0 })
    // con el probable confirmado, Bette Davis Eyes también recupera su grilla
    expect(imp.summary(p.token, { 2: 'si' }).dj).toMatchObject({ tracks: 2, grids: 2, cues: 1 })
    const r = imp.create(p.token, ['7'], { 2: 'si' }, true)
    expect(r).toMatchObject({ playlists: 1, inLists: 3, toGet: 0, dj: { grids: 2, cues: 1 } })
    expect(pl.trackIds(pl.tree().find((n) => n.name === 'Set del sábado')!.id)).toEqual([ids.africa, ids.kim, ids.movido])
    expect(dj.grid(ids.africa)).toMatchObject({ method: 'rekordbox', bpm: 118, rbTime: true })
    expect(dj.cues(ids.africa)).toMatchObject([{ source: 'rekordbox', kind: 'hot', num: 0, name: 'Arranque', color: '#00FF00', start: 0.2 }])
    expect(dj.meta(ids.africa)).toMatchObject({ stars: 5, colour: '#00FF00' })
    // deshacer saca también lo de cabina
    imp.undo(r.id)
    expect(dj.grid(ids.africa)).toBeNull()
    expect(dj.cues(ids.africa)).toEqual([])
    expect(dj.meta(ids.africa)).toBeNull()
  })

  it('del pendrive no se pisa lo que ya trajiste de tu rekordbox.xml', async () => {
    db.prepare("INSERT INTO dj_grid (file_id, method, bpm, segments, variable, made_at) VALUES (?, 'rekordbox', 117.9, '[{\"start\":0.21,\"bpm\":117.9,\"beat\":1}]', 0, 'antes')").run(ids.africa)
    const p = await imp.preview(readPendrive(path.join(dir, 'usb')))
    const r = imp.create(p.token, ['7'], { 2: 'si' }, true)
    expect(r.dj).toEqual({ grids: 1, cues: 1 }) // la de Africa ya estaba: solo la de Kim Carnes
    expect(dj.grid(ids.africa)?.bpm).toBe(117.9)
    imp.undo(r.id)
    expect(dj.grid(ids.africa)?.bpm).toBe(117.9)
  })

  it('corrida del 22/10: un sample o un set que está en la misma ruta es tuyo; un "01" sin artista no se busca por nombre; la mala calidad va a la Lista solo si se pide', async () => {
    const sample = Number(db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, title, duration) VALUES (1, 'Samples/Pack/01.wav', 50, 1, 'produccion', 'wav', NULL, 0.4)").run().lastInsertRowid)
    const low = add('Cumbia/Damas Gratis - Se te ve la tanga.mp3', 'Damas Gratis', 'Se te ve la tanga', 200, 4444, 'D')
    // un tema que «se llama» 01 si se corta en el guion: antes se proponía como el mismo
    const quara = add('Los Quara/01 01 - Gato del festival.mp3', 'Los Quara', '01 - Gato del festival', 140, 333)
    const xml = `<DJ_PLAYLISTS><COLLECTION>
      <TRACK TrackID="1" Name="01" Artist="" TotalTime="0" Size="50" Location="file://localhost/${RAIZ_URL}/Samples/Pack/01.wav"/>
      <TRACK TrackID="2" Name="01" Artist="" TotalTime="0" Size="51" Location="file://localhost/C:/Otro/Pack/01.wav"/>
      <TRACK TrackID="3" Name="Se te ve la tanga" Artist="Damas Gratis" TotalTime="200" Size="4444" Location="file://localhost/${RAIZ_URL}/Cumbia/Damas%20Gratis%20-%20Se%20te%20ve%20la%20tanga.mp3"/>
      </COLLECTION><PLAYLISTS><NODE Type="0" Name="ROOT"><NODE Name="Todo" Type="1" KeyType="0"><TRACK Key="1"/><TRACK Key="2"/><TRACK Key="3"/></NODE></NODE></PLAYLISTS></DJ_PLAYLISTS>`
    const p = await imp.preview(readRbXml(path.join(dir, 'x.xml'), xml))
    expect(imp.items(p.token, '0').map((i) => [i.kind, i.file?.id ?? null, i.state])).toEqual([['ruta', sample, 'tenes'], ['none', null, 'falta'], ['ruta', low, 'baja']])
    // de fábrica, a la Lista va solo lo que falta (el "01" que no está); con la casilla, también el de mala calidad
    const a = imp.create(p.token, ['0'], {})
    expect([a.inLists, a.toGet]).toEqual([2, 1])
    expect(wanted.list().some((w) => w.fileId === low && w.requests.includes('Todo'))).toBe(false)
    imp.undo(a.id)
    const p2 = await imp.preview(readRbXml(path.join(dir, 'x.xml'), xml))
    const b = imp.create(p2.token, ['0'], {}, false, true)
    expect(b.toGet).toBe(2)
    expect(wanted.list().some((w) => w.fileId === low && w.requests.includes('Todo'))).toBe(true)
    imp.undo(b.id)
    expect(wanted.list().filter((w) => w.requests.length)).toEqual([])
    db.prepare('DELETE FROM files WHERE id IN (?, ?, ?)').run(sample, low, quara)
  })

  it('corrida del 22/10: un sample pack repetido (mismo nombre y tamaño en dos carpetas) toma la carpeta más parecida; lo que está en la compu fuera de la biblioteca queda afuera', async () => {
    const copyA = Number(db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext) VALUES (1, 'Otros/Pack 2/CR 78/01.wav', 77, 1, 'produccion', 'wav')").run().lastInsertRowid)
    const copyB = Number(db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext) VALUES (1, 'Sample Packs/Pack 1/CR 78/01.wav', 77, 1, 'produccion', 'wav')").run().lastInsertRowid)
    const video = path.join(dir, 'Proyectos', 'ensayo.mp4')
    fs.mkdirSync(path.dirname(video), { recursive: true })
    fs.writeFileSync(video, 'x')
    const loc = (p: string) => `file://localhost/${p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace('%3A', ':')}`
    const xml = `<DJ_PLAYLISTS><COLLECTION>
      <TRACK TrackID="1" Name="01" Size="77" Location="file://localhost/${RAIZ_URL}/Pack%201/CR%2078/01.wav"/>
      <TRACK TrackID="2" Name="ensayo" Size="1" TotalTime="60" Location="${loc(video)}"/>
      </COLLECTION><PLAYLISTS><NODE Type="0" Name="ROOT"><NODE Name="Varios" Type="1" KeyType="0"><TRACK Key="1"/><TRACK Key="2"/></NODE></NODE></PLAYLISTS></DJ_PLAYLISTS>`
    const p = await imp.preview(readRbXml(path.join(dir, 'y.xml'), xml))
    expect(imp.items(p.token, '0').map((i) => [i.kind, i.file?.id, i.copies])).toEqual([['archivo', copyB, 1]])
    expect(p.outside).toEqual({ count: 1, examples: ['ensayo.mp4'] })
    expect(p.lists[0].counts).toEqual({ tenes: 1, baja: 0, falta: 0, revisar: 0 })
    // por huella sí se prueba (por si es la copia de un tema tuyo)
    expect(imp.printable(p.token).map((x) => path.basename(x.path))).toEqual(['ensayo.mp4'])
    db.prepare('DELETE FROM files WHERE id IN (?, ?)').run(copyA, copyB)
  })

  it('errores claros: carpeta sin pendrive, vista previa vencida, nada elegido', async () => {
    expect(() => readPendrive(dir)).toThrow(/PIONEER\/rekordbox\/export.pdb/)
    // un pendrive vacío (como el F:\PIONEER de esta PC: solo colores y columnas)
    const empty = path.join(dir, 'vacio')
    fs.mkdirSync(path.join(empty, 'PIONEER', 'rekordbox'), { recursive: true })
    fs.writeFileSync(path.join(empty, 'PIONEER', 'rekordbox', 'export.pdb'), buildPdb({ tracks: [], artists: [], lists: [] }))
    await expect(imp.preview(readPendrive(empty))).rejects.toThrow(/no tiene temas ni playlists/)
    expect(() => imp.items('nada', '0')).toThrow(/venció/)
    const p = await imp.preview(readRbXml(path.join(dir, 'rekordbox.xml')))
    expect(() => imp.create(p.token, ['1'], {})).toThrow(/al menos una playlist/)
  })
})
