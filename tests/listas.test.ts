// "Traer una lista de otro lado" (core/listparse.ts, core/listmatch.ts, core/requests.ts, core/isrc.ts): leer el CSV de
// Spotify real de "80s Mood" (y los de Exportify, TuneMyMusic, texto pegado y .m3u), emparejar seguro / probable / otra
// versión, crear la playlist en el orden de la lista, la lista «Faltan o suenan mal», lo que llega por la Bandeja y deshacer.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb, type Db } from '@paila/core/db'
import { cleanIsrc, parseCsv, parseList, parseM3u, parseText, parseDuration, spotifyLink } from '@paila/core/listparse'
import { sockseekCsv, sockseekTxt } from '@paila/core/listexport'
import { lookupIsrcs } from '@paila/core/listdeezer'
import { Deezer } from '@paila/core/online/sources'
import { OnlineCache, type HttpRes } from '@paila/core/online/http'
import { recKey } from '@paila/core/official-findings'
import { ListMatcher, requestTitle, sameSong, titleParts, type LibTrack } from '@paila/core/listmatch'
import { Requests, stateOf } from '@paila/core/requests'
import { previewInWorker } from '@paila/core/requestserver'
import { build } from 'esbuild'
import { externos } from '../scripts/externos.mjs'
import { Playlists } from '@paila/core/playlists'
import { Wanted } from '@paila/core/wanted'
import { readIsrc } from '@paila/core/isrc'
import { findFfprobe } from '@paila/core/probe'
import { History } from '@paila/core/history'
import { Improver } from '@paila/core/improve'

const CSV = fs.readFileSync(path.join(__dirname, 'fixtures', 'listas', '80s Mood.csv'), 'utf8')

describe('leer listas', () => {
  it('el CSV de Spotify de "80s Mood": 140 temas en orden, con duración, ISRC y varios artistas', () => {
    const p = parseList(CSV, '80s Mood.csv')
    expect(p.source).toBe('CSV de Spotify')
    expect(p.entries).toHaveLength(140)
    expect(p.skipped).toEqual([])
    expect(p.entries[0]).toMatchObject({ position: 1, artist: 'Benjamin Orr', title: 'Stay the Night', album: 'The Lace', duration: 264, isrc: 'USEE10251351' })
    expect(p.entries[12].artist).toBe('Tears For Fears, Oleta Adams')
    expect(p.entries[62].artist).toBe('Earth, Wind & Fire, The Emotions') // la coma con espacio es del nombre
    expect(p.entries.map((e) => e.position)).toEqual(Array.from({ length: 140 }, (_, i) => i + 1))
  })

  it('Exportify (duración en milisegundos) y TuneMyMusic', () => {
    const ex = parseCsv('"Track URI","Track Name","Artist Name(s)","Album Name","Disc Number","Track Duration (ms)","ISRC"\n"spotify:track:1","It\'s a Sin - 2001 Remaster","Pet Shop Boys","Actually","1","299000","GBAYE0100057"\n')
    expect(ex.source).toBe('CSV de Exportify')
    expect(ex.entries[0]).toMatchObject({ artist: 'Pet Shop Boys', title: "It's a Sin - 2001 Remaster", duration: 299, isrc: 'GBAYE0100057' })
    const tm = parseCsv('Track name,Artist name,Album,Playlist name,Type,ISRC\nHunting High and Low,a-ha,Hunting High and Low,80s,Playlist,USWB19901216\n')
    expect(tm.source).toBe('CSV de TuneMyMusic')
    expect(tm.entries[0]).toMatchObject({ artist: 'a-ha', title: 'Hunting High and Low', duration: null, isrc: 'USWB19901216' })
    // Chosic: "#" al principio y la duración en "Time" (mm:ss)
    const ch = parseList('#,Song,Artist,Popularity,BPM,Genres,Parent Genres,Album,Album Date,Time,Dance,Spotify Track Id,Song Preview\n1,"Take on Me","a-ha",80,169,"new wave","Rock","Hunting High and Low",1985-06-01,03:45,57,2WfaOiMkCvy7F5fcp2zZ8L,\n')
    expect(ch.source).toBe('CSV de Chosic')
    expect(ch.entries[0]).toMatchObject({ position: 1, artist: 'a-ha', title: 'Take on Me', album: 'Hunting High and Low', duration: 225 })
    // Exportify nuevo: "Duration (ms)"
    expect(parseCsv('Track URI,Track Name,Album Name,Artist Name(s),Release Date,Duration (ms)\nspotify:track:x,Human,Crash,The Human League,1986,227000\n').entries[0]).toMatchObject({ artist: 'The Human League', title: 'Human', duration: 227 })
    // separado por punto y coma (Excel en castellano)
    expect(parseList('Artista;Título;Duración\nSoda Stereo;De Música Ligera;3:32\n').entries[0]).toMatchObject({ artist: 'Soda Stereo', title: 'De Música Ligera', duration: 212 })
  })

  it('texto pegado: número adelante, duración al final, tabuladores; sin " - " es solo el título', () => {
    const p = parseText('1. Duran Duran - Save a Prayer (3:45)\n02 - Pet Shop Boys – It\'s a Sin\nErasure\tShip of Fools\n# comentario\n\nAfrica\n4 Non Blondes - What\'s Up\n10cc - Dreadlock Holiday 4:27')
    expect(p.entries.map((e) => [e.artist, e.title, e.duration])).toEqual([
      ['Duran Duran', 'Save a Prayer', 225], ['Pet Shop Boys', "It's a Sin", null], ['Erasure', 'Ship of Fools', null], ['', 'Africa', null],
      ['4 Non Blondes', "What's Up", null], ['10cc', 'Dreadlock Holiday', 267],
    ])
  })

  it('.m3u de otra compu: el nombre sale de #EXTINF o del archivo, y la ruta se guarda', () => {
    const p = parseM3u('#EXTM3U\n#EXTINF:225,Duran Duran - Save a Prayer\nD:\\Musica\\80s\\save.mp3\nE:/otra/Pet Shop Boys - It\'s a Sin [www.slider.kz].mp3\n')
    expect(p.entries.map((e) => [e.artist, e.title, e.duration, e.path])).toEqual([
      ['Duran Duran', 'Save a Prayer', 225, 'D:\\Musica\\80s\\save.mp3'], ['Pet Shop Boys', "It's a Sin", null, "E:/otra/Pet Shop Boys - It's a Sin [www.slider.kz].mp3"],
    ])
    expect(parseList('#EXTM3U\n#EXTINF:1,A - B\nx.mp3').format).toBe('m3u')
  })

  it('ISRC y duraciones', () => {
    expect(cleanIsrc('usee1-02-51351')).toBe('USEE10251351')
    expect(cleanIsrc('DRAGON Collection')).toBeNull() // basura que traen algunos tags
    expect(cleanIsrc('http://vk.com/usuario')).toBeNull()
    expect(parseDuration('04:24')).toBe(264)
    expect(parseDuration('1:02:03')).toBe(3723)
    expect(parseDuration('264000')).toBe(264)
    expect(parseDuration('264000', true)).toBe(264)
  })
})

describe('para sockseek y links de Spotify (decisiones del 20/10)', () => {
  it('exporta s:"Artista - Tema" por línea y Artist,Title,Album,Length en segundos', () => {
    const items = [
      { artist: 'Duran Duran', title: 'Save a Prayer (Single Version)', album: 'Rio', duration: 225.4 },
      { artist: 'Earth, Wind & Fire', title: 'Boogie "Wonderland"', album: null, duration: null },
      { artist: 'Duran Duran', title: 'Save a Prayer (Single Version)', album: 'Rio', duration: 225 }, // repetido
      { artist: '', title: 'Africa', duration: 295 },
    ]
    expect(sockseekTxt(items)).toBe('s:"Duran Duran - Save a Prayer (Single Version)"\r\ns:"Earth, Wind & Fire - Boogie \'Wonderland\'"\r\ns:"Africa"\r\n')
    expect(sockseekCsv(items).split('\r\n')).toEqual(['Artist,Title,Album,Length', 'Duran Duran,Save a Prayer (Single Version),Rio,225', '"Earth, Wind & Fire","Boogie ""Wonderland""",,', ',Africa,,295', ''])
    expect(sockseekCsv([{ artist: 'La Renga', title: 'Ruta 40' }])).toBe('Artist,Title,Album\r\nLa Renga,Ruta 40,\r\n')
  })
  it('un link de Spotify no se lee: se reconoce para ofrecer Chosic o Exportify', () => {
    expect(spotifyLink('mirá https://open.spotify.com/intl-es/playlist/37i9dQZF1DX4UtSsGT1Sbe?si=abc')).toBe('https://open.spotify.com/playlist/37i9dQZF1DX4UtSsGT1Sbe')
    expect(spotifyLink('spotify:album:1DFixLWuPkv3KT3TnV35m3')).toBe('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3')
    expect(spotifyLink('Duran Duran - Save a Prayer')).toBeNull()
  })
})

describe('emparejar', () => {
  it('saca lo que agrega Spotify y separa lo que es otra versión', () => {
    expect(titleParts('Love Comes Quickly - 2018 Remaster')).toEqual(titleParts('Love Comes Quickly'))
    expect(titleParts('Ship of Fools - 2009 - Remaster')).toEqual(titleParts('Ship of Fools'))
    // decidido el 20/10: solo se saca la remasterización; "Single Version", "Live" y "Mix" son otras versiones
    expect(titleParts('Save a Prayer - Single Version').versions).toEqual(['single version'])
    expect(titleParts('Africa - Radio Edit').versions).toEqual(['radio edit'])
    expect(titleParts('Blue Monday (Original Mix)').versions).toEqual(['original mix'])
    expect(titleParts('Heart of Glass - 2001 Digital Remaster').versions).toEqual([])
    expect(titleParts('Under Pressure (Remastered 2011)')).toEqual(titleParts('Under Pressure'))
    expect(titleParts('Hysteria - Live at Royal Albert Hall').versions).toEqual(['en vivo'])
    expect(titleParts('Blue Monday (Hardfloor Remix)').versions).toEqual(['hardfloor remix'])
    expect(titleParts("Don't You (Forget About Me)").full).toBe('dontyouforgetaboutme')
    expect(titleParts('Woman in Chains (feat. Oleta Adams)').full).toBe('womaninchains')
    expect(requestTitle('Ship of Fools - 2009 - Remaster')).toBe('Ship of Fools')
    expect(requestTitle('Save a Prayer - Single Version')).toBe('Save a Prayer (Single Version)')
    expect(requestTitle('Under Pressure (Remastered 2011)')).toBe('Under Pressure')
  })

  const t = (id: number, artist: string | null, title: string | null, duration: number | null, extra: Partial<LibTrack> = {}): LibTrack =>
    ({ id, rel: `M/${artist} - ${title}.mp3`, ext: 'mp3', artist, title, duration, grade: 'B', flags: null, isrc: null, ...extra })
  const lib = [
    t(1, 'Pet Shop Boys', "It's a Sin", 299),
    t(2, 'Duran Duran', 'Save a Prayer', 325), // la del disco (5:25): el pedido es el single
    t(3, 'Def Leppard', 'Hysteria (Live)', 390),
    t(4, 'Tears for Fears', 'Woman in Chains (feat. Oleta Adams)', 391),
    t(5, 'X', 'Otro', 200, { isrc: 'GBAYE8200089' }),
    t(6, null, null, 290, { rel: 'kingston/Erasure - Ship of Fools [www.slider.kz].mp3', guess: { artist: 'Erasure', title: 'Ship of Fools' } }),
    t(7, 'Loco Mia', 'Locomía', 349),
    t(8, 'Toto', 'Africa', 295, { grade: 'D' }), t(9, 'Toto', 'Africa', 295, { grade: 'A' }),
    t(10, 'Pet Shop Boys', 'Pet Shop Boys - Domino Dancing', 280),
  ]
  const m = new ListMatcher(lib, { dict: new Map([['loco mia', 'Loco Mía']]) })
  const e = (artist: string, title: string, duration: number | null, isrc: string | null = null) => ({ position: 1, artist, title, album: null, duration, isrc, path: null })

  it('seguro por ISRC, aunque el nombre no coincida', () => {
    expect(m.match(e('Duran Duran', 'Save a Prayer - Single Version', 225, 'GBAYE8200089'))).toMatchObject({ kind: 'isrc', fileId: 5 })
  })
  it('exacto: mismos artistas y título sin el remaster (ni mayúsculas, tildes o "feat."), misma duración ±3 s', () => {
    expect(m.match(e('Pet Shop Boys', "It's a Sin - 2001 Remaster", 299))).toMatchObject({ kind: 'exacto', fileId: 1 })
    expect(m.match(e('Tears For Fears, Oleta Adams', 'Woman In Chains', 391))).toMatchObject({ kind: 'exacto', fileId: 4 })
    expect(m.match(e('Erasure', 'Ship of Fools - 2009 - Remaster', 291))).toMatchObject({ kind: 'exacto', fileId: 6 }) // del nombre del archivo (sin tags)
    expect(m.match(e('Loco Mía', 'Locomia', 348))).toMatchObject({ kind: 'exacto', fileId: 7 })
    expect(m.match(e('Pet Shop Boys', 'Domino Dancing', 281))).toMatchObject({ kind: 'exacto', fileId: 10 }) // el artista repetido en el título
  })
  it('de varias copias, la de mejor calidad', () => {
    expect(m.match(e('TOTO', 'Africa', 295))).toMatchObject({ kind: 'exacto', fileId: 9, copies: 1 })
  })
  it('otra versión: misma canción con otra duración, o en vivo contra la de estudio', () => {
    const v = m.match(e('Duran Duran', 'Save a Prayer - Single Version', 225))
    expect(v).toMatchObject({ kind: 'version', fileId: 2 })
    expect(v.why).toContain('5:25')
    expect(m.match(e('Def Leppard', 'Hysteria', 390))).toMatchObject({ kind: 'version', fileId: 3 })
    expect(m.match(e('Pet Shop Boys', "It's a Sin", 299 + 4))).toMatchObject({ kind: 'version' })
  })
  it('no lo tenés: otro artista con el mismo título no cuenta (se ofrece como otra versión, un cover, para confirmar)', () => {
    expect(m.match(e('Gwen Stefani', "It's a Sin", 299))).toMatchObject({ kind: 'version', fileId: 1 })
    expect(m.match(e('Kim Carnes', 'Bette Davis Eyes', 228)).kind).toBe('none')
  })
  it('la Bandeja reconoce un tema pedido aunque el archivo no diga "2018 Remaster"', () => {
    expect(sameSong({ artist: 'Pet Shop Boys', title: 'Love Comes Quickly', duration: 260 }, { artist: 'Pet Shop Boys', title: 'Love Comes Quickly (2018 Remaster)', duration: 259 })).toBe(true)
    expect(sameSong({ artist: 'Pet Shop Boys', title: 'Love Comes Quickly (Live)', duration: 260 }, { artist: 'Pet Shop Boys', title: 'Love Comes Quickly', duration: 259 })).toBe(false)
    expect(sameSong({ artist: 'Pet Shop Boys', title: 'Love Comes Quickly', duration: 420 }, { artist: 'Pet Shop Boys', title: 'Love Comes Quickly', duration: 259 })).toBe(false)
  })
  it('el estado de cada tema', () => {
    expect(stateOf('exacto', null, { low: false })).toBe('tenes')
    expect(stateOf('exacto', 'no', { low: false })).toBe('falta')
    expect(stateOf('isrc', null, { low: false })).toBe('tenes')
    expect(stateOf('isrc', null, { low: true })).toBe('baja')
    expect(stateOf('probable', null, { low: false })).toBe('revisar')
    expect(stateOf('probable', 'si', { low: false })).toBe('tenes')
    expect(stateOf('version', 'no', { low: false })).toBe('falta')
    expect(stateOf('none', null, null)).toBe('falta')
  })
})

describe('el pedido en la base', () => {
  let dir: string, db: Db, pl: Playlists, wanted: Wanted, req: Requests
  const add = (rel: string, artist: string, title: string, duration: number, grade = 'B', size = 1000) => {
    const id = Number(db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, title, duration) VALUES (1, ?, ?, 1, 'musica', 'mp3', ?, ?, ?)").run(rel, size, artist, title, duration).lastInsertRowid)
    db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade) VALUES (?, 1, 1, 1, 'x', ?)").run(id, grade)
    return id
  }
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-listas-'))
    db = openDb(path.join(dir, 'paila.db'))
    db.exec("INSERT INTO volumes (id, serial, last_mount) VALUES (1, 'X', 'C:\\\\'); INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', 'x')")
    pl = new Playlists(db, () => null)
    wanted = new Wanted(db)
    req = new Requests(db, pl, wanted, () => null)
  })
  afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  const LIST = 'Pet Shop Boys - It\'s a Sin - 2001 Remaster (4:59)\nToto - Africa (4:55)\nKim Carnes - Bette Davis Eyes (3:48)\nDuran Duran - Save a Prayer - Single Version (3:45)\nElton John - I\'m Still Standing (3:03)'
  it('la vista previa en el hilo aparte (para que no se congele la ventana) da lo mismo que la de siempre', async () => {
    add('Kim Carnes - Bette Davis Eyes (live).mp3', 'Kim Carnes', 'Bette Davis Eyes (Live)', 230)
    const out = path.join(path.resolve('node_modules/.cache/paila-run'), `request-worker-${process.pid}.mjs`)
    await build({ entryPoints: ['packages/core/requestworker.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning', plugins: [externos] })
    try {
      const inWorker = await previewInWorker(out, { file: path.join(dir, 'paila.db'), roots: { 1: 'C:\M' }, text: LIST, name: '80s Mood' })
      expect(inWorker).toEqual(req.preview(LIST, undefined, '80s Mood'))
      await expect(previewInWorker(out, { file: path.join(dir, 'paila.db'), roots: {}, text: ' ' })).rejects.toThrow(/ningún tema/)
    } finally { fs.rmSync(out, { force: true }); db.prepare("DELETE FROM files WHERE rel_path LIKE 'Kim Carnes%'").run() }
  })

  it('vista previa sin guardar nada; crear arma la playlist en el orden de la lista y la lista «Faltan o suenan mal»', () => {
    const sin = add('Pet Shop Boys - It\'s a Sin.mp3', 'Pet Shop Boys', "It's a Sin", 299)
    const africa = add('Toto - Africa.mp3', 'Toto', 'Africa', 295)
    add('Duran Duran - Save a Prayer.mp3', 'Duran Duran', 'Save a Prayer', 325)
    const elton = add('Elton John - Im Still Standing.mp3', 'Elton John', 'Im Still Standing', 182, 'D')
    const p = req.preview(LIST, undefined, '80s Mood')
    expect(db.prepare('SELECT COUNT(*) AS n FROM playlists').get()).toMatchObject({ n: 0 })
    expect(p.items.map((i) => [i.kind, i.state])).toEqual([['exacto', 'tenes'], ['exacto', 'tenes'], ['none', 'falta'], ['version', 'revisar'], ['exacto', 'baja']])
    // lo exacto entra solo; la otra versión la deja para después
    const d = req.create({ name: p.name, source: p.source, items: p.items.map((i) => ({ ...i, fileId: i.file?.id ?? null, decision: i.kind === 'probable' ? 'si' as const : null })) })
    expect(d.counts).toEqual({ tenes: 2, baja: 1, falta: 1, revisar: 1 })
    expect(pl.trackIds(d.playlistId!)).toEqual([sin, africa, elton])
    const w = wanted.list().filter((x) => x.requests.includes('80s Mood'))
    expect(w.map((x) => [x.artist, x.title, x.fileId])).toEqual(expect.arrayContaining([['Kim Carnes', 'Bette Davis Eyes', null], [expect.any(String), expect.any(String), elton]]))
    expect(w).toHaveLength(2)
    // más tarde confirma la otra versión: entra a la playlist en su lugar (después de Africa)
    const v = d.items.find((i) => i.kind === 'version')!
    const d2 = req.decide(v.id, 'si')
    expect(pl.trackIds(d2.playlistId!)).toEqual([sin, africa, v.file!.id, elton])
    // y se arrepiente: sale de la playlist y va a la lista «Faltan o suenan mal»
    const d3 = req.decide(v.id, 'no')
    expect(pl.trackIds(d3.playlistId!)).toEqual([sin, africa, elton])
    const sp = wanted.list().find((x) => x.title === 'Save a Prayer (Single Version)')!
    expect(sp.requests).toEqual(['80s Mood'])
    expect(sp.duration).toBe(225) // la duración que traía la lista (sockseek la usa)
    expect(wanted.export('sockseek-csv', undefined, { request: '80s Mood' }).text).toContain('Duran Duran,Save a Prayer (Single Version),,225')
    expect(wanted.export('sockseek-txt', undefined, { request: '80s Mood' }).text).toContain('s:"Kim Carnes - Bette Davis Eyes"')
  })

  it('lo que llega por la Bandeja y se copia a la Música entra solo a la playlist, en su lugar', () => {
    const d = req.list()[0]
    const missing = wanted.list().find((x) => x.title === 'Bette Davis Eyes')!
    // la Bandeja lo encontró…
    wanted.arrived({ wantedId: Number(missing.key.slice(1)) }, 'C:\\Bandeja\\Kim Carnes - Bette Davis Eyes.mp3')
    db.prepare("INSERT INTO inbox_items (path, size, mtime, result, checked_at) VALUES (?, 4321, 1, '{}', 'x')").run('C:\\Bandeja\\Kim Carnes - Bette Davis Eyes.mp3')
    expect(req.sync()).toBe(0) // …pero todavía no está en la Música
    const id = add('Nuevos/Kim Carnes - Bette Davis Eyes.mp3', 'Kim Carnes', 'Bette Davis Eyes', 228, 'A', 4321)
    expect(req.sync()).toBe(1)
    const after = req.detail(d.id)!
    expect(pl.trackIds(after.playlistId!)[2]).toBe(id) // después de Africa, antes de Save a Prayer y Elton
    expect(after.items.find((i) => i.title === 'Bette Davis Eyes')).toMatchObject({ kind: 'llego', state: 'tenes' })
    expect(wanted.list().find((x) => x.title === 'Bette Davis Eyes')?.status).toBe('reemplazado')
    expect(req.sync()).toBe(0)
  })

  it('se deshace desde el Historial: se va la playlist y lo que sumó a la Lista (los archivos no se tocan)', async () => {
    const d = req.list()[0]
    const files = (db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n
    const h = new History(db, { improver: new Improver(db), requests: req, rootPath: () => null } as never)
    const e = h.list().find((x) => x.kind === 'pedido')!
    expect(e.summary).toContain('«80s Mood»')
    expect(h.detail('pedido', d.id).rows[0].name).toBe("1. Pet Shop Boys - It's a Sin - 2001 Remaster")
    await h.undo('pedido', d.id)
    expect(db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(d.playlistId)).toBeUndefined()
    // el de baja calidad y el que faltaba se van; el que ya llegó y se reemplazó queda (es historia)
    expect(wanted.list().filter((x) => x.requests.length).length).toBe(0)
    expect(wanted.list().map((x) => x.title)).not.toContain('Save a Prayer (Single Version)')
    expect((db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n).toBe(files)
    expect(h.list().find((x) => x.kind === 'pedido')).toMatchObject({ undone: true, canUndo: false })
  })

  it('dos pedidos con el mismo nombre: la playlist no se pisa', () => {
    const a = req.create({ name: 'Boda', source: 'Texto pegado', items: [{ position: 1, artist: 'Toto', title: 'Africa', album: null, duration: 295, isrc: null, kind: 'none', why: '', decision: null, fileId: null }] })
    const b = req.create({ name: 'Boda', source: 'Texto pegado', items: [{ position: 1, artist: 'Toto', title: 'Africa', album: null, duration: 295, isrc: null, kind: 'none', why: '', decision: null, fileId: null }] })
    expect([a.playlistName, b.playlistName]).toEqual(['Boda', 'Boda (2)'])
  })
})

describe('ISRC de los tags', () => {
  it('se lee de un MP3 (TSRC) y de un FLAC (ISRC); la basura no cuenta', () => {
    const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-isrc-'))
    const mk = (name: string, meta: string[]) => { const f = path.join(dir, name); execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=d=1', ...meta, f]); return f }
    const ffprobe = findFfprobe()!
    return Promise.all([
      readIsrc(ffprobe, mk('a.mp3', ['-metadata', 'TSRC=GBAYE0100057'])),
      readIsrc(ffprobe, mk('b.flac', ['-metadata', 'ISRC=usee10251351'])),
      readIsrc(ffprobe, mk('c.mp3', ['-metadata', 'TSRC=DRAGON Collection'])),
    ]).then((r) => { expect(r).toEqual(['GBAYE0100057', 'USEE10251351', null]); fs.rmSync(dir, { recursive: true, force: true }) })
  })
})

describe('ISRC en Deezer (respuestas guardadas, sin internet)', () => {
  const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as HttpRes
  it('track/isrc: da el tema exacto; si Deezer no lo tiene, null', async () => {
    const urls: string[] = []
    const dz = new Deezer(async (u) => { urls.push(u); return u.includes('GBAYE1700765') ? res(200, { id: 3135556, title: 'Love Comes Quickly (2018 Remaster)', duration: 259, artist: { name: 'Pet Shop Boys' } }) : res(200, { error: { type: 'DataException', message: 'no data', code: 800 } }) }, 0)
    expect(await dz.byIsrc('GBAYE1700765')).toMatchObject({ id: '3135556', title: 'Love Comes Quickly (2018 Remaster)', length: 259, credit: [{ name: 'Pet Shop Boys' }] })
    expect(await dz.byIsrc('XXXXX0000000')).toBeNull()
    expect(urls[0]).toBe('https://api.deezer.com/2.0/track/isrc:GBAYE1700765')
  })

  it('seguro si Deezer dio ese mismo tema al buscar tu archivo; si no, prueba con el nombre oficial de Deezer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-dz-'))
    const db = openDb(path.join(dir, 'paila.db'))
    db.exec("INSERT INTO volumes (id, serial, last_mount) VALUES (1, 'X', 'C:\\'); INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', 'x')")
    const add = (rel: string, artist: string, title: string, duration: number) => Number(db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, artist, title, duration) VALUES (1, ?, 1, 1, 'musica', 'mp3', ?, ?, ?)").run(rel, artist, title, duration).lastInsertRowid)
    // el archivo tiene otro título ("LCQ"), pero su búsqueda en Deezer devolvió el tema 3135556
    const lcq = add('PSB - LCQ.mp3', 'Pet Shop Boys', 'LCQ', 260)
    const sin = add('Pet Shop Boys - Its a Sin.mp3', 'Pet Shop Boys', "It's a Sin", 299)
    const cache = new OnlineCache(db)
    cache.put('deezer', recKey('Pet Shop Boys', 'LCQ'), 'ok', [{ source: 'deezer', id: '3135556', title: 'Love Comes Quickly (2018 Remaster)', length: 259, credit: [{ name: 'Pet Shop Boys', join: '' }] }])
    const answers: Record<string, unknown> = {
      GBAYE1700765: { id: 3135556, title: 'Love Comes Quickly (2018 Remaster)', duration: 259, artist: { name: 'Pet Shop Boys' } },
      GBAYE0100057: { id: 999, title: "It's a Sin", duration: 300, artist: { name: 'Pet Shop Boys' } },
    }
    let calls = 0
    const dz = new Deezer(async (u) => { calls++; const k = u.split('isrc:')[1]; return res(200, answers[k] ?? { error: { message: 'no data' } }) }, 0)
    const csv = '#,Song,Artist,Duration,ISRC\n1,"Amor que llega rápido","PSB",04:19,GBAYE1700765\n2,"Un pecado","PSB",04:59,GBAYE0100057\n'
    const isrcs = parseList(csv, 'x.csv').entries.map((e) => e.isrc!)
    expect(await lookupIsrcs(db, isrcs, dz)).toEqual({ asked: 2, found: 2 })
    expect(await lookupIsrcs(db, isrcs, dz)).toEqual({ asked: 0, found: 0 }) // queda en la caché
    expect(calls).toBe(2)
    const req = new Requests(db, new Playlists(db, () => null), new Wanted(db), () => null)
    const p = req.preview(csv, 'x.csv')
    expect(p.items[0]).toMatchObject({ kind: 'isrc', state: 'tenes', file: { id: lcq } })
    expect(p.items[0].why).toContain('Deezer')
    // el 2: Deezer no lo vio en tus búsquedas, pero su nombre oficial ("It's a Sin") encuentra tu archivo
    expect(p.items[1]).toMatchObject({ kind: 'exacto', file: { id: sin } })
    db.close(); fs.rmSync(dir, { recursive: true, force: true })
  })
})
