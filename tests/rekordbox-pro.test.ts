// Tests de la Fase F: leer rekordbox.xml (core/rbxml.ts) y los marcadores de Serato (core/serato.ts), traerlos a PAILA
// (core/djdata.ts), exportar de nuevo sin perder nada y con el mismo TrackID (core/rekordbox.ts) y el armado de set.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Rekordbox, toLocation } from '@paila/core/rekordbox'
import { locationToPath, parseRbXml, splitMyTags } from '@paila/core/rbxml'
import { geobFrames, parseBeatGrid, parseMarkers2, readSerato } from '@paila/core/serato'
import { mp3StartPadding, readMp3Start, rekordboxMp3Shift } from '@paila/core/analysis/mp3info'
import { SetBuilder, bpmDiff, keyRelation, transition, transitionText } from '@paila/core/setbuilder'
import { gridPlan } from '@paila/core/gridrun'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
let lib: Library
let pl: Playlists
let rb: Rekordbox
const id = (n: string) => lib.tracks().find((r) => String(r[2]).endsWith(n))![0] as number

// ---- un tag ID3v2.4 con los GEOB de Serato, armado a mano ----
const syncsafe = (n: number) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
function geob(desc: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from([0]), Buffer.from('application/octet-stream\0\0', 'latin1'), Buffer.from(desc + '\0', 'latin1'), data])
  return Buffer.concat([Buffer.from('GEOB'), syncsafe(body.length), Buffer.from([0, 0]), body])
}
function entry(type: string, data: Buffer) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([Buffer.from(type + '\0', 'latin1'), len, data]) }
function markers2(): Buffer {
  const cue = Buffer.alloc(13 + 6)
  cue[1] = 2; cue.writeUInt32BE(61_250, 2); cue[7] = 0xcc; cue[8] = 0x88; cue[9] = 0; cue.write('Drop\0', 12, 'utf8')
  const loop = Buffer.alloc(21 + 5)
  loop[1] = 0; loop.writeUInt32BE(30_000, 2); loop.writeUInt32BE(37_500, 6); loop.fill(0xff, 10, 14); loop.write('Loop\0', 20, 'utf8')
  const payload = Buffer.concat([Buffer.from([1, 1]), entry('COLOR', Buffer.from([0, 0x99, 0xff, 0x99])), entry('CUE', cue), entry('LOOP', loop), entry('BPMLOCK', Buffer.from([0])), Buffer.from([0])])
  // en base64 con un salto de línea cada 72 y sin el relleno final, como lo escribe Serato
  const b64 = payload.toString('base64').replace(/=+$/, '').replace(/(.{72})/g, '$1\n')
  return Buffer.concat([Buffer.from([1, 1]), Buffer.from(b64, 'latin1'), Buffer.from([0])])
}
function beatgrid(pos: number, bpm: number) { const b = Buffer.alloc(6 + 8 + 1); b[0] = 1; b.writeUInt32BE(1, 2); b.writeFloatBE(pos, 6); b.writeFloatBE(bpm, 10); return b }
function id3(frames: Buffer[]) { const body = Buffer.concat(frames); return Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0]), syncsafe(body.length), body]) }

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-rbpro-'))
  const make = (rel: string, args: string[]) => {
    const out = path.join(dir, 'M', ...rel.split('/'))
    fs.mkdirSync(path.dirname(out), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=30', ...args, out])
    return out
  }
  make('Club/lame.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k', '-metadata', 'title=Con LAME'])
  make('Club/sano.flac', ['-metadata', 'title=Sin pérdida'])
  // un MP3 con los marcadores de Serato: el audio sin tag y adelante un ID3 armado a mano
  const raw = make('Club/raw.mp3', ['-c:a', 'libmp3lame', '-write_xing', '0', '-id3v2_version', '0', '-write_id3v1', '0'])
  fs.writeFileSync(path.join(dir, 'M', 'Club', 'serato.mp3'), Buffer.concat([id3([geob('Serato Markers2', markers2()), geob('Serato BeatGrid', beatgrid(0.12, 124))]), fs.readFileSync(raw)]))
  fs.unlinkSync(raw)
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  rb = new Rekordbox(lib.db, (i) => lib.trackPath(i), pl)
}, 90_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('leer rekordbox.xml', () => {
  it('my tags del comentario', () => {
    expect(splitMyTags('Linda /* Pico / Cierre */')).toEqual({ comments: 'Linda', myTags: ['Pico', 'Cierre'] })
    expect(splitMyTags('Sin etiquetas')).toEqual({ comments: 'Sin etiquetas', myTags: [] })
  })

  it('rutas de Windows y de Mac', () => {
    expect(locationToPath('file://localhost/D:/M%c3%basica/a%20b.mp3')).toBe('D:/Música/a b.mp3')
    expect(locationToPath('file://localhost/Users/x/a.mp3')).toBe('/Users/x/a.mp3')
  })

  it('tema con grilla, cues, loop, estrellas, color y temas sin hijos', () => {
    const xml = `<?xml version="1.0"?><DJ_PLAYLISTS><COLLECTION Entries="2">
    <TRACK TrackID="111" Name="A &amp; B" Artist="X" Size="10" TotalTime="200" AverageBpm="126.00" Rating="204" Colour="0xFF007F" Comments="Bueno /* Pico */" PlayCount="7"
      Location="file://localhost/D:/M%C3%BAsica/a.mp3" Tonality="8A">
      <TEMPO Inizio="0.025" Bpm="126.00" Metro="4/4" Battito="1"/>
      <TEMPO Inizio="48.025" Bpm="126.00" Metro="4/4" Battito="3"/>
      <POSITION_MARK Name="Drop" Type="0" Start="61.250" Num="2" Red="204" Green="136" Blue="0"/>
      <POSITION_MARK Name="" Type="0" Start="0.025" Num="-1"/>
      <POSITION_MARK Name="Loop" Type="4" Start="30.000" End="37.500" Num="0"/>
    </TRACK>
    <TRACK TrackID="222" Name="Solo" Location="file://localhost/F:/b.flac" Rating="0"/>
    </COLLECTION><PLAYLISTS/></DJ_PLAYLISTS>`
    const [a, b] = parseRbXml(xml)
    expect(a).toMatchObject({ trackId: '111', name: 'A & B', path: 'D:/Música/a.mp3', stars: 4, colour: '#FF007F', comments: 'Bueno', myTags: ['Pico'], playCount: 7, bpm: 126 })
    expect(a.grid).toEqual([{ start: 0.025, bpm: 126, beat: 1 }, { start: 48.025, bpm: 126, beat: 3 }])
    expect(a.cues).toEqual([
      { name: 'Drop', type: 0, start: 61.25, end: null, num: 2, color: '#CC8800' },
      { name: '', type: 0, start: 0.025, end: null, num: -1, color: null },
      { name: 'Loop', type: 4, start: 30, end: 37.5, num: 0, color: null },
    ])
    expect(b).toMatchObject({ trackId: '222', grid: [], cues: [], stars: 0 })
  })

  it('un XML real se lee entero (si está en PAILA_REKORDBOX_XML)', () => {
    const f = process.env.PAILA_REKORDBOX_XML ?? '' // el de la corrida del 21/10 (3.419 temas)
    if (!f || !fs.existsSync(f)) return
    const t = parseRbXml(fs.readFileSync(f, 'utf8'))
    expect(t.length).toBe(3419)
    expect(t.filter((x) => x.grid.length).length).toBe(2725)
    expect(t.filter((x) => x.stars).length).toBe(115)
  })
})

describe('marcadores de Serato', () => {
  it('Markers2: color, hot cue, loop y bloqueo de BPM', () => {
    const m = parseMarkers2(markers2())
    expect(m.colour).toBe('#99FF99')
    expect(m.bpmLocked).toBe(false)
    expect(m.cues).toEqual([
      { kind: 'hot', index: 2, startMs: 61250, endMs: null, color: '#CC8800', name: 'Drop' },
      { kind: 'loop', index: 0, startMs: 30000, endMs: 37500, color: null, name: 'Loop' },
    ])
  })

  it('BeatGrid y los GEOB de un tag ID3', () => {
    expect(parseBeatGrid(beatgrid(0.12, 124))).toEqual({ position: 0.12, bpm: 124 })
    const g = geobFrames(id3([geob('Serato Markers2', Buffer.from([1, 1])), geob('Otra cosa', Buffer.from('x'))]))
    expect([...g.keys()]).toEqual(['Serato Markers2', 'Otra cosa'])
  })

  it('los lee de un MP3 de verdad', () => {
    const r = readSerato(path.join(dir, 'M', 'Club', 'serato.mp3'), 'mp3')!
    expect(r.cues).toHaveLength(2)
    expect(r.grid).toEqual({ position: 0.12, bpm: 124 })
    expect(readSerato(path.join(dir, 'M', 'Club', 'sano.flac'), 'flac')).toBeNull()
  })
})

describe('desfase de los MP3 (0,025 s)', () => {
  it('ffmpeg con LAME deja cabecera con el retardo; sin cabecera no hay corrimiento', () => {
    const s = readMp3Start(path.join(dir, 'M', 'Club', 'lame.mp3'))
    expect(s.xing && s.lame).toBe(true)
    expect(mp3StartPadding(path.join(dir, 'M', 'Club', 'lame.mp3'))).toBeGreaterThan(1000) // ~1105 muestras = 25 ms
    expect(mp3StartPadding(path.join(dir, 'M', 'Club', 'serato.mp3'))).toBe(0)
    expect(rb.dj.rbShift(id('lame.mp3'))).toBeCloseTo(1105 / 44100, 3)
    expect(rb.dj.rbShift(id('sano.flac'))).toBe(0)
  })

  it('corrida supervisada 21/10: si la cabecera la escribió LAME, Rekordbox cuenta además la cabecera como un cuadro (~51 ms)', () => {
    const src = path.join(dir, 'M', 'Club', 'lame.mp3')
    expect(readMp3Start(src).encoder).toMatch(/^Lav/)
    expect(rekordboxMp3Shift(src)).toBe(mp3StartPadding(src))
    // la misma cabecera, con el nombre de LAME en vez del de ffmpeg
    const b = fs.readFileSync(src)
    const at = b.indexOf('Lavc', 0, 'latin1') >= 0 ? b.indexOf('Lavc', 0, 'latin1') : b.indexOf('Lavf', 0, 'latin1')
    b.write('LAME3.100', at, 'latin1')
    const fake = path.join(dir, 'lame-de-verdad.mp3')
    fs.writeFileSync(fake, b)
    expect(readMp3Start(fake).encoder).toBe('LAME3.100')
    expect(rekordboxMp3Shift(fake)).toBe(mp3StartPadding(fake) + 1152)
    expect(mp3StartPadding(fake)).toBeGreaterThan(1000) // ffmpeg igual se lo saltea
  })
})

describe('importar y exportar sin perder nada', () => {
  const xmlOf = () => `<?xml version="1.0"?><DJ_PLAYLISTS><COLLECTION Entries="2">
    <TRACK TrackID="98765" Name="Con LAME" Size="${fs.statSync(path.join(dir, 'M', 'Club', 'lame.mp3')).size}" Rating="255" Colour="0x00FF00" Comments="Cierre /* Pico / Final */" PlayCount="3"
      Location="${toLocation(path.join(dir, 'M', 'Club', 'lame.mp3'))}">
      <TEMPO Inizio="0.140" Bpm="124.00" Metro="4/4" Battito="2"/>
      <POSITION_MARK Name="Entrada" Type="0" Start="8.025" Num="0" Red="40" Green="226" Blue="20"/>
    </TRACK>
    <TRACK TrackID="55555" Name="Movido" Size="${fs.statSync(path.join(dir, 'M', 'Club', 'sano.flac')).size}" Location="file://localhost/Z:/vieja/sano.flac"/>
    <TRACK TrackID="1" Name="No está" Location="file://localhost/D:/M%C3%BAsica/no.mp3"/>
    </COLLECTION></DJ_PLAYLISTS>`

  it('trae lo de Rekordbox, empareja por ruta y por nombre + tamaño, y lo guarda tal cual (en el tiempo de Rekordbox)', () => {
    const f = path.join(dir, 'rb-in.xml')
    fs.writeFileSync(f, xmlOf())
    const r = rb.dj.importRekordbox(f)
    expect(r).toMatchObject({ tracks: 3, matched: 2, byName: 1, grids: 1, cues: 1, stars: 1, colours: 1, myTags: 1 })
    expect(r.unmatched).toEqual(['D:/Música/no.mp3'])
    // corrida supervisada 21/10: guardada ya corrida, la grilla volvía 26 ms movida cuando cambió la regla del desfase
    expect(rb.dj.grid(id('lame.mp3'))).toMatchObject({ rbTime: true, segments: [{ start: 0.14, bpm: 124, beat: 2 }] })
    expect(rb.dj.cues(id('lame.mp3'))[0].start).toBe(8.025)
    expect(rb.dj.cues(id('lame.mp3'))[0]).toMatchObject({ source: 'rekordbox', kind: 'hot', num: 0, name: 'Entrada', color: '#28E214' })
    expect(rb.dj.trackId(id('lame.mp3'))).toBe('98765')
    expect(rb.dj.trackId(id('sano.flac'))).toBe('55555')
  })

  it('Serato: trae cues y grilla del archivo', () => {
    const r = rb.dj.importSerato()
    expect(r).toMatchObject({ matched: 1, cues: 1, grids: 1, colours: 1 })
    const c = rb.dj.cues(id('serato.mp3'))
    expect(c.map((x) => [x.source, x.kind, x.start])).toEqual([['serato', 'loop', 30], ['serato', 'hot', 61.25]])
  })

  it('exporta lo mismo que trajo (grilla, cue, estrellas, color, my tags) y el mismo TrackID dos veces', () => {
    const dest = path.join(dir, 'out.xml')
    rb.export({ scope: 'todo', playlistIds: [], dest })
    const once = fs.readFileSync(dest, 'utf8')
    const back = parseRbXml(once)
    const lame = back.find((t) => t.path.endsWith('lame.mp3'))!
    expect(lame).toMatchObject({ trackId: '98765', stars: 5, colour: '#00FF00', comments: 'Cierre', myTags: ['Pico', 'Final'], playCount: 3 })
    expect(lame.grid).toEqual([{ start: 0.14, bpm: 124, beat: 2 }]) // vuelve idéntica
    // la grilla de PAILA sí se corre al tiempo de Rekordbox (este MP3 lo hizo ffmpeg: ~25 ms)
    const sano = back.find((t) => t.path.endsWith('sano.flac'))!
    expect(sano.grid).toEqual([])
    expect(lame.cues).toEqual([{ name: 'Entrada', type: 0, start: 8.025, end: null, num: 0, color: '#28E214' }])
    const serato = back.find((t) => t.path.endsWith('serato.mp3'))!
    expect(serato.cues.find((c) => c.type === 4)).toMatchObject({ start: 30, end: 37.5 })
    expect(serato.colour).toBe('#99FF99')
    // segunda exportación: los mismos TrackID (Rekordbox actualiza, no duplica)
    rb.export({ scope: 'todo', playlistIds: [], dest })
    const ids = (x: string) => parseRbXml(x).map((t) => `${path.basename(t.path)}=${t.trackId}`).sort()
    expect(ids(fs.readFileSync(dest, 'utf8'))).toEqual(ids(once))
    expect(back.find((t) => t.path.endsWith('serato.mp3'))!.trackId).toMatch(/^19\d{8}$/) // uno de PAILA, lejos de los de Rekordbox
  })

  it('sin grilla si se pide, y los cues sugeridos solo si se piden', () => {
    rb.dj.saveSuggested(id('sano.flac'), [{ role: 'inicio', time: 0.5, bar: 0 }, { role: 'drop', time: 16.5, bar: 8 }])
    const dest = path.join(dir, 'opc.xml')
    rb.export({ scope: 'todo', playlistIds: [], dest, grid: false })
    let back = parseRbXml(fs.readFileSync(dest, 'utf8'))
    expect(back.every((t) => !t.grid.length)).toBe(true)
    expect(back.find((t) => t.path.endsWith('sano.flac'))!.cues).toEqual([])
    rb.export({ scope: 'todo', playlistIds: [], dest, suggestedCues: true })
    back = parseRbXml(fs.readFileSync(dest, 'utf8'))
    const c = back.find((t) => t.path.endsWith('sano.flac'))!.cues
    expect(c.filter((x) => x.num === -1).map((x) => x.name)).toEqual(['Intro', 'Drop']) // como en Rekordbox (decisión del 22/10)
    expect(c.filter((x) => x.num >= 0)).toEqual([]) // los sugeridos no ocupan los pads de hot cue
    // los traídos de Rekordbox ganan a los sugeridos
    rb.dj.saveSuggested(id('lame.mp3'), [{ role: 'inicio', time: 0.5, bar: 0 }])
    expect(rb.dj.cues(id('lame.mp3')).every((x) => x.source === 'rekordbox')).toBe(true)
  })

  it('el plan de grilla no cuenta los que ya tienen la de Rekordbox o Serato', () => {
    const p = gridPlan(lib.db, rb.dj, null, 'gpu')
    expect(p.tracks).toBe(3)
    expect(p.todo).toEqual([id('sano.flac')])
    // "volver a calcular" es solo lo de PAILA; los de Rekordbox o Serato, si se pide escucharlos también (grilla variable)
    expect(gridPlan(lib.db, rb.dj, null, 'gpu', true).todo).toEqual([id('sano.flac')])
    expect(gridPlan(lib.db, rb.dj, null, 'gpu', false, true).todo).toHaveLength(3)
  })
})

describe('armado de set', () => {
  it('relación de tonos en la rueda Camelot', () => {
    expect(keyRelation('8A', '8A')).toBe('igual')
    expect(keyRelation('8A', '9A')).toBe('vecino')
    expect(keyRelation('12B', '1B')).toBe('vecino')
    expect(keyRelation('8A', '8B')).toBe('relativo')
    expect(keyRelation('8A', '9B')).toBe('diagonal')
    expect(keyRelation('8A', '3B')).toBe('choca')
    expect(keyRelation('Am', 'C')).toBe('relativo')
    expect(keyRelation(null, '8A')).toBeNull()
  })

  it('BPM con doble y mitad', () => {
    expect(bpmDiff(128, 130)).toBe(1.6)
    expect(bpmDiff(70, 140)).toBe(0)
    expect(bpmDiff(128, null)).toBeNull()
  })

  it('puntaje y explicación del pase', () => {
    const a = { id: 1, artist: '', title: 'a', bpm: 124, camelot: '8A', energy: 6, duration: 300 }
    const good = transition(a, { ...a, id: 2, bpm: 125, camelot: '9A', energy: 6 })
    const bad = transition(a, { ...a, id: 3, bpm: 140, camelot: '2B', energy: 9 })
    expect(good.score).toBeGreaterThan(80)
    expect(bad.score).toBeLessThan(15)
    expect(transitionText({ ...a, camelot: '9A' }, good)).toBe('tono vecino (9A) · BPM +0,8 % · misma energía')
    // pedir que suba: gana el que sube 1
    const up = transition(a, { ...a, id: 4, energy: 7 }, 1), flat = transition(a, { ...a, id: 5, energy: 6 }, 1)
    expect(up.score).toBeGreaterThan(flat.score)
  })

  it('corrida supervisada 21/10: si al tema le falta el BPM del análisis, usa el de la grilla ("House" salía sin BPM)', () => {
    const sb = new SetBuilder(lib.db)
    const put = lib.db.prepare('INSERT OR REPLACE INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, bpm, camelot, energy) VALUES (?, 1, 0, 0, ?, ?, ?, ?)')
    put.run(id('lame.mp3'), new Date().toISOString(), null, '8A', 6) // sin BPM: tiene la grilla de Rekordbox (124)
    put.run(id('sano.flac'), new Date().toISOString(), 125, '9A', 7)
    const c = sb.curve([id('lame.mp3'), id('sano.flac')])
    expect(c.tracks.map((t) => t.bpm)).toEqual([124, 125])
    expect(c.transitions[0].key).toBe('vecino')
    const next = sb.next(id('lame.mp3'), { playlistIds: [id('sano.flac')] })
    expect(next[0]).toMatchObject({ track: { id: id('sano.flac') }, inPlaylist: true })
  })

  it('corrida supervisada 21/10: no sugiere otra copia del mismo tema, y suben los del mismo estilo', () => {
    const sb = new SetBuilder(lib.db)
    const put = lib.db.prepare('INSERT OR REPLACE INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, bpm, camelot, energy) VALUES (?, 1, 0, 0, ?, ?, ?, ?)')
    const set = lib.db.prepare('UPDATE files SET artist = ?, title = ?, genre = ? WHERE id = ?')
    set.run('Maceo Plex', 'Conjure Sex', 'Techno', id('lame.mp3'))
    set.run('Maceo Plex', 'Conjure Sex (Original Mix)', 'Techno', id('serato.mp3')) // otra copia del mismo
    set.run('La Renga', 'Inventa un mañana', 'Rock', id('sano.flac'))
    put.run(id('serato.mp3'), new Date().toISOString(), 124, '8A', 6)
    put.run(id('sano.flac'), new Date().toISOString(), 124, '8A', 6)
    expect(sb.next(id('lame.mp3')).map((x) => x.track.id)).toEqual([id('sano.flac')])
    // otro tema de techno, un poco peor de tono, gana a La Renga por el estilo
    set.run('Otro', 'Tema techno', 'Techno', id('serato.mp3'))
    put.run(id('serato.mp3'), new Date().toISOString(), 124, '9A', 6)
    const n = sb.next(id('lame.mp3'))
    expect(n[0].track.id).toBe(id('serato.mp3'))
    expect(n[0].why).toContain('mismo estilo')
  })
})

describe('grilla de PAILA al exportar', () => {
  it('se corre al tiempo de Rekordbox en un MP3 hecho con ffmpeg, y no en un FLAC', () => {
    const g = { grid: { bpm: 120, segments: [{ start: 0.5, bpm: 120, beat: 1 }], errorMs: 3, variable: false }, barEnergy: [] }
    rb.dj.saveGrid(id('sano.flac'), 'beatthis', g, null)
    lib.db.prepare("DELETE FROM dj_grid WHERE file_id = ? AND method = 'rekordbox'").run(id('lame.mp3'))
    rb.dj.saveGrid(id('lame.mp3'), 'beatthis', g, null)
    const dest = path.join(dir, 'paila-grid.xml')
    rb.export({ scope: 'todo', playlistIds: [], dest })
    const back = parseRbXml(fs.readFileSync(dest, 'utf8'))
    expect(back.find((t) => t.path.endsWith('sano.flac'))!.grid[0].start).toBe(0.5)
    expect(back.find((t) => t.path.endsWith('lame.mp3'))!.grid[0].start).toBeCloseTo(0.5 + 1105 / 44100, 3)
  })
})
