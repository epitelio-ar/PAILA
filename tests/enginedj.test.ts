// Tests de exportar a Engine DJ (core/enginedj.ts y DjExport.engine): con temas hechos con ffmpeg, una carpeta de usuario falsa
// y una biblioteca de Engine armada a mano (sin el programa): la de Engine DJ 2.x a 4.0 (grilla y cues en Track) y la de 4.1
// en adelante (en PerformanceData), con las tablas y los disparadores que usan las playlists. Nunca la de verdad.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Rekordbox } from '@paila/core/rekordbox'
import { DjExport, engineDb } from '@paila/core/djexport'
import { makeEngine } from './engine-base'
import { beatData, engineGrid, engineKey, hasOwnMarks, loops, pack, quickCues, unpack } from '@paila/core/enginedj'
import { enginePath } from '@paila/core/enginedb'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, home: string, lib: Library, pl: Playlists, rb: Rekordbox, dj: DjExport
const id = (n: string) => lib.tracks().find((r) => String(r[2]).endsWith(n))![0] as number
const tone = (rel: string, extra: string[] = []) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', ...extra, '-metadata', `title=${path.basename(rel)}`, '-metadata', 'artist=Alguien', out])
}
const engineHome = () => path.join(home, 'Music', 'Engine Library')

const open = (libDir: string) => new DatabaseSync(engineDb(libDir))

/** Leer la grilla de un beatData (para comprobar lo escrito). */
function readGrid(blob: Uint8Array) {
  const b = unpack(blob)
  const n = Number(b.readBigInt64BE(17))
  return { sr: b.readDoubleBE(0), samples: b.readDoubleBE(8), set: b[16], markers: Array.from({ length: n }, (_, i) => ({ sample: b.readDoubleLE(25 + i * 24), index: Number(b.readBigInt64LE(33 + i * 24)), beats: b.readInt32LE(41 + i * 24) })) }
}
/** Los 8 pads de un quickCues y el cue principal. */
function readCues(blob: Uint8Array) {
  const b = unpack(blob)
  const pads: { label: string; sample: number; color: string }[] = []
  let p = 8
  for (let i = Number(b.readBigInt64BE(0)); i > 0; i--) {
    const len = b[p]
    const label = b.subarray(p + 1, p + 1 + len).toString('utf8')
    p += 1 + len
    pads.push({ label, sample: b.readDoubleBE(p), color: b.subarray(p + 8, p + 12).toString('hex') })
    p += 12
  }
  return { pads, main: b.readDoubleBE(p), adjusted: b[p + 8], mainDefault: b.readDoubleBE(p + 9) }
}

/** El trackData de un tema que Engine analizó: 8 s a 44,1 kHz, su tono y el volumen que midió. */
function analyzed(loudness: number, key: number) {
  const b = Buffer.alloc(44)
  b.writeDoubleBE(44100, 0); b.writeBigInt64BE(BigInt(8 * 44100), 8); b.writeInt32BE(key, 16)
  for (const o of [20, 28, 36]) b.writeDoubleBE(loudness, o)
  return pack(b)
}
/** Una grilla que corriste a mano en Engine: la ajustada ya no es igual a la del análisis. */
function movedGrid() {
  const g = (shift: number) => {
    const m = Buffer.alloc(8 + 48)
    m.writeBigInt64BE(2n, 0)
    m.writeDoubleLE(shift, 8); m.writeBigInt64LE(-4n, 16); m.writeInt32LE(24, 24)
    m.writeDoubleLE(400000 + shift, 32); m.writeBigInt64LE(20n, 40)
    return m
  }
  const head = Buffer.alloc(17)
  head.writeDoubleBE(44100, 0); head.writeDoubleBE(8 * 44100, 8); head[16] = 1
  return pack(Buffer.concat([head, g(0), g(300), Buffer.alloc(9)]))
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-engine-'))
  home = path.join(dir, 'usuario')
  tone('House/uno.mp3', ['-b:a', '192k'])
  tone('House/dos.flac')
  tone('House/tres.wav')
  tone('House/cuatro.wma', ['-c:a', 'wmav2'])
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  pl = new Playlists(lib.db, (i) => lib.trackPath(i))
  rb = new Rekordbox(lib.db, (i) => lib.trackPath(i), pl)
  dj = new DjExport(rb, home, path.join(home, 'VirtualDJ'), '', engineHome())
  const folder = pl.create('Fiestas', 'folder')
  const list = pl.create('Casamiento', 'list', folder)
  pl.addTracks(list, [id('dos.flac'), id('uno.mp3'), id('cuatro.wma')])
  pl.create('Con; punto y coma', 'list')
  rb.dj.saveGrid(id('uno.mp3'), 'beatthis', { grid: { bpm: 124, segments: [{ start: 0.5, bpm: 124, beat: 1 }], errorMs: 3, variable: false }, barEnergy: [] }, null)
  rb.dj.saveGrid(id('tres.wav'), 'beatthis', { grid: { bpm: 120, segments: [{ start: 0.25, bpm: 120, beat: 3 }, { start: 4.25, bpm: 122, beat: 1 }], errorMs: 3, variable: true }, barEnergy: [] }, null)
  lib.db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, bpm, music_key) VALUES (?, 1, 1, 1, '', 124, 'Am') ON CONFLICT (file_id) DO UPDATE SET bpm = 124, music_key = 'Am'").run(id('uno.mp3'))
  const cue = (file: string, kind: string, num: number, start: number, endAt: number | null, name: string, color: string | null) =>
    lib.db.prepare("INSERT INTO dj_cues (file_id, source, kind, num, start, end_at, name, color) VALUES (?, 'rekordbox', ?, ?, ?, ?, ?, ?)").run(id(file), kind, num, start, endAt, name, color)
  cue('uno.mp3', 'hot', 0, 1.0, null, 'Entrada', '#FF0000')
  cue('uno.mp3', 'loop', 2, 2.0, 3.0, 'Loop', null)
  cue('uno.mp3', 'memory', -1, 0.75, null, 'Memo', null)
  cue('dos.flac', 'hot', 1, 1.5, null, 'Drop', null)
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('formato de Engine', () => {
  it('el tono por el círculo de quintas: cada mayor seguida de su relativa menor', () => {
    expect(['C', 'Am', 'G', 'Em', 'F#m', 'Db', 'C#m', 'Bbm', 'Dm', 'F', 'raro', null].map((k) => engineKey(k))).toEqual([0, 1, 2, 3, 7, 14, 9, 15, 23, 22, null, null])
  })

  it('comprimido con su largo adelante, y vacío si el largo es cero', () => {
    const raw = Buffer.from('hola engine')
    const z = pack(raw)
    expect(z.readUInt32BE(0)).toBe(raw.length)
    expect(zlib.inflateSync(z.subarray(4)).toString()).toBe('hola engine')
    expect(unpack(z).toString()).toBe('hola engine')
    expect(unpack(Buffer.alloc(4)).length).toBe(0)
  })

  it('la grilla: un marcador cuatro tiempos antes del primer "1" y otro pasando el final', () => {
    const sr = 44100
    const m = engineGrid({ grid: { bpm: 120, segments: [{ start: 0.25, bpm: 120, beat: 3 }] }, cues: [] }, 0, sr, 8 * sr)
    // el "1" del compás llega dos tiempos después (0.25 + 1 s)
    expect(m[0]).toEqual({ index: -4, sample: (1.25 - 2) * sr })
    expect(m[1].index).toBe(14) // 1.25 s + 14 tiempos = 8.25 s: pasa el final
    expect(m[1].sample).toBeCloseTo(8.25 * sr, 6)
    const g = readGrid(beatData(sr, 8 * sr, m))
    expect(g).toMatchObject({ sr, samples: 8 * sr, set: 1 })
    expect(g.markers).toEqual([{ sample: m[0].sample, index: -4, beats: 18 }, { sample: m[1].sample, index: 14, beats: 0 }])
    expect(unpack(beatData(sr, 8 * sr, m)).length).toBe(33 + 2 * 24 * 2 + 9)
  })

  it('los pads vacíos van en -1 y no cuentan como propios; uno puesto, sí', () => {
    const empty = quickCues([], 0)
    expect(readCues(empty).pads.every((p) => p.sample === -1 && p.label === '')).toBe(true)
    expect(hasOwnMarks(null, empty, loops([]))).toBe(false)
    expect(hasOwnMarks(null, quickCues([null, { label: 'Ñandú', sample: 10, color: null }], 5), null)).toBe(true)
    expect(hasOwnMarks(null, null, loops([{ label: 'L', start: 1, end: 2, color: null }]))).toBe(true)
    // la grilla del análisis de Engine (la misma dos veces) no es tuya; corrida a mano (la ajustada distinta), sí
    expect(hasOwnMarks(beatData(44100, 1, [{ index: -4, sample: 0 }, { index: 4, sample: 10 }]), null, null)).toBe(false)
    expect(hasOwnMarks(movedGrid(), null, null)).toBe(true)
    expect(hasOwnMarks(null, Buffer.from([0, 0, 0, 9, 1, 2]), null)).toBe(true) // ilegible: se trata como propio
    // los loops van sin comprimir: 8 lugares de 23 bytes más el nombre
    expect(loops([{ label: 'ab', start: 1, end: 2, color: '#112233' }]).length).toBe(8 + 8 * 23 + 2)
    // un nombre largo se corta en 255 bytes sin romper una letra
    expect(readCues(quickCues([{ label: 'ñ'.repeat(200), sample: 1, color: null }], 0)).pads[0].label).toBe('ñ'.repeat(127))
  })

  it('las rutas: relativas a la carpeta Engine Library en el mismo disco; en otro, completas; siempre con "/"', () => {
    expect(enginePath('C:\\Users\\yo\\Music\\House\\a.mp3', 'C:\\Users\\yo\\Music\\Engine Library')).toBe('../House/a.mp3')
    expect(enginePath('D:\\Música\\a.mp3', 'C:\\Users\\yo\\Music\\Engine Library')).toBe('D:/Música/a.mp3')
    expect(enginePath('D:\\Música\\a.mp3', 'D:\\Engine Library')).toBe('../Música/a.mp3')
    expect(enginePath('/Volumes/SSD/Música/a.mp3', '/Volumes/SSD/Engine Library')).toBe('../Música/a.mp3')
  })
})

describe('Exportar a Engine DJ', () => {
  it('sin la biblioteca de Engine no escribe nada y dice cómo crearla', async () => {
    await expect(dj.engine({ scope: 'todo', playlistIds: [] })).rejects.toThrow(/Abrí Engine DJ una vez|Open Engine DJ once/)
    expect(fs.existsSync(engineHome())).toBe(false)
  })

  it('Engine 4.1 en adelante: temas nuevos con grilla y cues, los tuyos quedan, playlists dentro de "PAILA" y la base de antes copiada entera', async () => {
    makeEngine(engineHome(), 3)
    const libDir = engineHome()
    const rel = (n: string) => enginePath(lib.trackPath(id(n))!, libDir)
    // dos.flac ya estaba en Engine con un cue tuyo; tres.wav, solo con el análisis de Engine (su grilla sin tocar y el volumen que midió)
    const pre = open(libDir)
    pre.prepare("INSERT INTO Track (path, filename, title, bpm) VALUES (?, 'dos.flac', 'Mío', 99)").run(rel('dos.flac'))
    pre.prepare('UPDATE PerformanceData SET quickCues = ? WHERE trackId = 1').run(quickCues([{ label: 'Mío', sample: 1000, color: null }], 0))
    pre.prepare("INSERT INTO Track (path, filename, title) VALUES (?, 'tres.wav', 'Sin nada')").run(rel('tres.wav'))
    pre.prepare('UPDATE PerformanceData SET trackData = ?, beatData = ? WHERE trackId = 2').run(analyzed(0.7, 5), beatData(44100, 8 * 44100, [{ index: -4, sample: -1000 }, { index: 20, sample: 400000 }]))
    pre.close()
    const before = fs.readFileSync(engineDb(libDir))

    const r = await dj.engine({ scope: 'todo', playlistIds: [] })
    expect(r.tracks).toBe(3) // el WMA no entra
    expect(r.skipped.map((s) => s.rel)).toEqual([expect.stringContaining('cuatro.wma')])
    expect(r.kept).toBe(1)
    expect(r.simplified).toBe(1) // tres.wav cambia de tempo: va con uno solo
    expect(r.written).toEqual([engineDb(libDir)])
    // la carpeta Database2 entera, como estaba
    const bak = r.backups[0]
    expect(fs.readFileSync(path.join(bak, 'm.db')).equals(before)).toBe(true)
    expect(fs.readFileSync(path.join(bak, 'hm.db'), 'utf8')).toBe('historial')
    expect(fs.readdirSync(path.dirname(engineDb(libDir))).filter((f) => f.includes('paila-tmp'))).toEqual([])

    const db = open(libDir)
    const t = (n: string) => db.prepare('SELECT * FROM Track WHERE path = ?').get(rel(n)) as Record<string, unknown>
    const pd = (n: string) => db.prepare('SELECT * FROM PerformanceData WHERE trackId = ?').get(t(n).id as number) as Record<string, Uint8Array | null>
    // el tuyo: nada cambió
    expect(t('dos.flac')).toMatchObject({ title: 'Mío', bpm: 99 })
    expect(readCues(pd('dos.flac').quickCues!).pads[0]).toMatchObject({ label: 'Mío', sample: 1000 })
    // el que solo tenía el análisis de Engine recibe BPM y la grilla de PAILA, con candado; el volumen que midió Engine queda
    expect(t('tres.wav')).toMatchObject({ title: 'Sin nada', bpm: 120, isBeatGridLocked: 1 })
    expect(readGrid(pd('tres.wav').beatData!).markers[0]).toEqual({ index: -4, sample: expect.closeTo((1.25 - 2) * 44100, 3), beats: 18 })
    expect(unpack(pd('tres.wav').trackData!).readDoubleBE(20)).toBe(0.7)
    expect(unpack(pd('tres.wav').trackData!).readInt32BE(16)).toBe(5) // sin tono en PAILA: el de Engine
    // el nuevo: sus datos, el tono de Engine (La menor = 1) y su origen
    const uno = t('uno.mp3')
    expect(uno).toMatchObject({ filename: 'uno.mp3', title: 'uno.mp3', artist: 'Alguien', bpm: 124, bpmAnalyzed: 124, key: 1, fileType: 'mp3', isAnalyzed: 0, isBeatGridLocked: 1, isAvailable: 1, originDatabaseUuid: 'uuid-de-prueba', originTrackId: uno.id, albumArtId: null, length: 8 })
    // en el tiempo de Engine (como ffmpeg, sin el relleno del principio del MP3): el de PAILA
    const shift = rb.dj.rbShift(id('uno.mp3'))
    const g = readGrid(pd('uno.mp3').beatData!)
    expect(g.sr).toBe(44100)
    expect(g.markers[0].index).toBe(-4)
    expect(g.markers[0].sample).toBeCloseTo((0.5 - 4 * 60 / 124) * 44100, 3)
    expect((g.markers[1].sample - g.markers[0].sample) / (g.markers[1].index + 4)).toBeCloseTo(44100 * 60 / 124, 6)
    const c = readCues(pd('uno.mp3').quickCues!)
    expect(c.pads[0]).toEqual({ label: 'Entrada', sample: expect.closeTo((1.0 - shift) * 44100, 3), color: 'ffff0000' })
    expect(c.pads[2]).toMatchObject({ label: 'Loop', sample: expect.closeTo((2.0 - shift) * 44100, 3), color: 'ffb855bf' }) // sin color: el del pad 3
    expect(c.pads[1].sample).toBe(-1)
    expect(c.main).toBeCloseTo((0.75 - shift) * 44100, 3) // el memory cue es el cue principal
    expect(c).toMatchObject({ adjusted: 1, mainDefault: c.main })
    const l = Buffer.from(pd('uno.mp3').loops!)
    expect(l.readBigInt64LE(0)).toBe(8n)
    expect(l.subarray(9, 13).toString()).toBe('Loop')
    expect(l.readDoubleLE(13)).toBeCloseTo((2.0 - shift) * 44100, 3)
    expect(l.readDoubleLE(21)).toBeCloseTo((3.0 - shift) * 44100, 3)
    expect(unpack(pd('uno.mp3').trackData!).readInt32BE(16)).toBe(1)

    // las playlists: "Mía" sigue primera, después PAILA con la carpeta y sus listas, en orden y sin el WMA
    const lists = db.prepare('SELECT id, title, parentListId AS parent, nextListId AS next FROM Playlist ORDER BY id').all() as { id: number; title: string; parent: number; next: number }[]
    const by = (title: string) => lists.find((x) => x.title === title)!
    expect(by('Mía').next).toBe(by('PAILA').id)
    expect(by('PAILA')).toMatchObject({ parent: 0, next: 0 })
    expect(by('Fiestas').parent).toBe(by('PAILA').id)
    expect(by('Casamiento').parent).toBe(by('Fiestas').id)
    expect(by('Con, punto y coma').parent).toBe(by('PAILA').id) // Engine no acepta ";" en el nombre
    const ents = db.prepare('SELECT id, trackId, nextEntityId AS next, databaseUuid AS uuid FROM PlaylistEntity WHERE listId = ? ORDER BY id').all(by('Casamiento').id) as { id: number; trackId: number; next: number; uuid: string }[]
    expect(ents.map((e) => e.trackId)).toEqual([t('dos.flac').id, t('uno.mp3').id])
    expect(ents[0].next).toBe(ents[1].id)
    expect(ents[1].next).toBe(0)
    expect(ents[0].uuid).toBe('uuid-de-prueba')
    db.close()

    // en el Historial, como lo copiado afuera
    expect(lib.db.prepare("SELECT COUNT(*) AS n FROM copies_log WHERE kind = 'engine'").get()).toEqual({ n: 1 })

    // otra vez: la playlist "PAILA" se reemplaza entera (no se duplica) y los temas no se repiten
    const r2 = await dj.engine({ scope: 'playlists', playlistIds: [] })
    expect(r2.kept).toBe(2) // los dos de las playlists ya tienen grilla o cues en Engine
    const db2 = open(libDir)
    expect(db2.prepare("SELECT COUNT(*) AS n FROM Playlist WHERE title = 'PAILA'").get()).toEqual({ n: 1 })
    expect(db2.prepare('SELECT COUNT(*) AS n FROM Track').get()).toEqual({ n: 3 })
    expect(db2.prepare("SELECT COUNT(*) AS n FROM Playlist WHERE title = 'Casamiento'").get()).toEqual({ n: 1 })
    expect(db2.prepare('SELECT COUNT(*) AS n FROM PlaylistEntity').get()).toEqual({ n: 2 })
    expect((db2.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok')
    db2.close()
  })

  it('con Engine abierto (cambios a medio guardar al lado de la base) no toca nada', async () => {
    const wal = `${engineDb(engineHome())}-wal`
    const before = fs.readFileSync(engineDb(engineHome()))
    fs.writeFileSync(wal, 'cambios de Engine')
    try {
      await expect(dj.engine({ scope: 'todo', playlistIds: [] })).rejects.toThrow(/Engine DJ está abierto|Engine DJ is open/)
      expect(fs.readFileSync(engineDb(engineHome())).equals(before)).toBe(true)
    } finally { fs.rmSync(wal) }
  })

  it('Engine 2.x a 4.0: la grilla y los cues van en la tabla Track', async () => {
    fs.rmSync(engineHome(), { recursive: true, force: true })
    makeEngine(engineHome(), 2)
    // tres.wav ya estaba, con la grilla corrida a mano en Engine: es tuya, no se toca
    const pre = open(engineHome())
    pre.prepare("INSERT INTO Track (path, filename, title, beatData) VALUES (?, 'tres.wav', 'Mío', ?)").run(enginePath(lib.trackPath(id('tres.wav'))!, engineHome()), movedGrid())
    pre.close()
    const r = await dj.engine({ scope: 'todo', playlistIds: [] })
    expect(r.kept).toBe(1)
    const db = open(engineHome())
    expect(Buffer.from((db.prepare("SELECT beatData FROM Track WHERE filename = 'tres.wav'").get() as { beatData: Uint8Array }).beatData).equals(movedGrid())).toBe(true)
    const uno = db.prepare('SELECT bpm, key, beatData, quickCues, loops, trackData FROM Track WHERE filename = ?').get('uno.mp3') as Record<string, Uint8Array | number>
    expect(uno).toMatchObject({ bpm: 124, key: 1 })
    expect(readGrid(uno.beatData as Uint8Array).set).toBe(1)
    expect(readCues(uno.quickCues as Uint8Array).pads[0].label).toBe('Entrada')
    expect(db.prepare("SELECT COUNT(*) AS n FROM Playlist WHERE title IN ('PAILA', 'Fiestas', 'Casamiento')").get()).toEqual({ n: 3 })
    db.close()
  })
})
