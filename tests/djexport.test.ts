// Tests de exportar a Traktor, Serato y VirtualDJ (core/djexport.ts y sus formatos): con temas hechos con ffmpeg y una
// carpeta de usuario falsa en una carpeta temporal (nunca la de verdad). Serato: la grilla dentro del archivo pasa por
// Cambios pendientes, se verifica y se deshace.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { Rekordbox } from '@paila/core/rekordbox'
import { Changes } from '@paila/core/changes'
import { readTags } from '@paila/core/tagio'
import { DjExport, vdjHomeOf } from '@paila/core/djexport'
import { gridMarkers, traktorKey, traktorLocation } from '@paila/core/traktor'
import { buildCrate, crateFile, encodeBeatGrid, encodeMarkers2, readCrate, seratoPath } from '@paila/core/seratofmt'
import { parseBeatGrid, parseMarkers2, readSerato } from '@paila/core/serato'
import { readSeratoTag, seratoText } from '@paila/core/seratotag'
import { mergeDatabase } from '@paila/core/virtualdj'
import { traktorMp3Shift } from '@paila/core/analysis/mp3info'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, home: string, lib: Library, pl: Playlists, rb: Rekordbox, dj: DjExport
const id = (n: string) => lib.tracks().find((r) => String(r[2]).endsWith(n))![0] as number
const tone = (rel: string, extra: string[] = []) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', ...extra, '-metadata', `title=${path.basename(rel)}`, '-metadata', 'artist=Alguien', out])
}
const cue = (file: string, kind: string, num: number, start: number, endAt: number | null, name: string) =>
  lib.db.prepare("INSERT INTO dj_cues (file_id, source, kind, num, start, end_at, name, color) VALUES (?, 'rekordbox', ?, ?, ?, ?, ?, '#FF0000')").run(id(file), kind, num, start, endAt, name)

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-djx-'))
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
  dj = new DjExport(rb, home, path.join(home, 'AppData', 'Local', 'VirtualDJ'))
  const folder = pl.create('Fiestas', 'folder')
  const list = pl.create('Casamiento', 'list', folder)
  pl.addTracks(list, [id('dos.flac'), id('uno.mp3'), id('cuatro.wma')])
  const g = (bpm: number, segs = [{ start: 0.5, bpm, beat: 1 }]) => ({ grid: { bpm, segments: segs, errorMs: 3, variable: segs.length > 1 }, barEnergy: [] })
  rb.dj.saveGrid(id('uno.mp3'), 'beatthis', g(124), null)
  rb.dj.saveGrid(id('dos.flac'), 'beatthis', g(120, [{ start: 0.25, bpm: 120, beat: 3 }, { start: 4.25, bpm: 122, beat: 1 }]), null)
  lib.db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, bpm, music_key) VALUES (?, 1, 1, 1, '', 124, 'Am') ON CONFLICT (file_id) DO UPDATE SET bpm = 124, music_key = 'Am'").run(id('uno.mp3'))
  cue('uno.mp3', 'hot', 0, 1.0, null, 'Entrada')
  cue('uno.mp3', 'loop', 2, 2.0, 3.0, 'Loop')
  cue('dos.flac', 'hot', 1, 1.5, null, 'Drop')
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('Traktor', () => {
  it('tonos y rutas como los escribe Traktor', () => {
    expect([traktorKey('C'), traktorKey('Db'), traktorKey('Am'), traktorKey('Bbm'), traktorKey('F#m'), traktorKey('raro')]).toEqual([0, 1, 21, 22, 18, null])
    expect(traktorLocation('C:\\Users\\yo\\Música\\a b.mp3')).toEqual({ volume: 'C:', dir: '/:Users/:yo/:Música/:', file: 'a b.mp3', key: 'C:/:Users/:yo/:Música/:a b.mp3' })
  })

  it('arma el .nml con playlists en su carpeta, BPM, tono, grilla y cues (y sin lo que Traktor no lee)', () => {
    const dest = path.join(dir, 'c.nml')
    const r = dj.traktor({ scope: 'playlists', playlistIds: [], dest })
    const x = fs.readFileSync(dest, 'utf8')
    expect(r.tracks).toBe(2) // el WMA no entra
    expect(r.skipped.map((s) => s.rel)).toEqual([expect.stringContaining('cuatro.wma')])
    expect(x).toMatch(/<NODE TYPE="FOLDER" NAME="Fiestas"><SUBNODES COUNT="1">\n<NODE TYPE="PLAYLIST" NAME="Casamiento"><PLAYLIST ENTRIES="2"/)
    expect(x).toContain('<MUSICAL_KEY VALUE="21">')
    // MP3 de ffmpeg (cabecera Xing sin LAME): Traktor corre todo 26 ms respecto de Rekordbox
    const mp3 = lib.trackPath(id('uno.mp3'))!
    expect(traktorMp3Shift(mp3)).toBe(0.026)
    const shift = rb.dj.rbShift(id('uno.mp3'))
    const start = (0.5 + shift + 0.026) * 1000
    expect(x).toContain(`TYPE="4" START="${start.toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="-1"><GRID BPM="124.000000">`)
    expect(x).toContain(`NAME="Entrada" DISPL_ORDER="0" TYPE="0" START="${((1 + 0.026) * 1000).toFixed(6)}"`)
    expect(x).toContain(`NAME="Loop" DISPL_ORDER="0" TYPE="5" START="${((2 + 0.026) * 1000).toFixed(6)}" LEN="1000.000000" REPEATS="-1" HOTCUE="2"`)
    // la grilla que cambia de tempo va con un solo BPM, desde el primer tiempo fuerte (beat 3 → dos tiempos después)
    expect(r.simplified).toBe(1)
    expect(x).toContain(`START="${((0.25 + 2 * 0.5) * 1000).toFixed(6)}" LEN="0.000000" REPEATS="-1" HOTCUE="-1"><GRID BPM="120.000000">`)
  })
})

describe('Serato', () => {
  it('crates: rutas sin la letra del disco, carpetas con %% y vuelven a leerse igual', () => {
    expect(seratoPath('D:\\Música\\a.mp3')).toBe('Música/a.mp3')
    expect(crateFile(['PAILA', 'Fiestas', 'A/B'])).toBe('PAILA%%Fiestas%%A_B.crate')
    expect(readCrate(buildCrate(['C:\\x\\ñandú.mp3', 'C:\\y.flac']))).toEqual(['x/ñandú.mp3', 'y.flac'])
  })

  it('marcas: los cues, el loop y la grilla variable vuelven a leerse igual', () => {
    const m = rb.marks(id('uno.mp3'), {})
    const back = parseMarkers2(encodeMarkers2(m, '#FF8800'))
    expect(back.colour).toBe('#FF8800')
    expect(back.cues.map((c) => [c.kind, c.index, c.startMs, c.endMs, c.name])).toEqual([['hot', 0, 1000, null, 'Entrada'], ['loop', 2, 2000, 3000, 'Loop']])
    expect(encodeMarkers2(m, null).length).toBeGreaterThanOrEqual(470)
    const v = rb.marks(id('dos.flac'), {})
    const bg = encodeBeatGrid(v)!
    expect(bg.readUInt32BE(2)).toBe(2)
    expect(bg.readUInt32BE(6 + 4)).toBe(Math.round((4.25 - 1.25) * 2)) // tiempos hasta el marcador siguiente
    expect(parseBeatGrid(bg)).toEqual({ position: 1.25, bpm: 122 })
  })

  it('escribe las crates dentro de "PAILA" en el _Serato_ de la carpeta Música, y guarda aparte las de antes', () => {
    const sub = path.join(home, 'Music', '_Serato_', 'Subcrates')
    fs.mkdirSync(sub, { recursive: true })
    fs.writeFileSync(path.join(sub, 'PAILA%%Vieja.crate'), buildCrate([]))
    fs.writeFileSync(path.join(sub, 'Mía.crate'), buildCrate([]))
    const r = dj.serato({ scope: 'todo', playlistIds: [] })
    expect(fs.readdirSync(sub).sort()).toEqual(['Mía.crate', 'PAILA%%Fiestas%%Casamiento.crate', 'PAILA%%Fiestas.crate', 'PAILA%%Toda mi Música.crate', 'PAILA.crate'])
    expect(r.backups).toHaveLength(1)
    expect(fs.readdirSync(r.backups[0])).toEqual(['PAILA%%Vieja.crate'])
    const paths = readCrate(fs.readFileSync(path.join(sub, 'PAILA%%Fiestas%%Casamiento.crate')))
    expect(paths).toEqual([seratoPath(lib.trackPath(id('dos.flac'))!), seratoPath(lib.trackPath(id('uno.mp3'))!)])
    // sin su base Serato no mira las crates de ese disco (Serato DJ Lite 5, 23/10): se crea vacía si falta, y no se pisa
    const db2 = path.join(home, 'Music', '_Serato_', 'database V2')
    expect(fs.readFileSync(db2).subarray(0, 4).toString('latin1')).toBe('vrsn')
    fs.writeFileSync(db2, 'de Serato')
    dj.serato({ scope: 'todo', playlistIds: [] })
    expect(fs.readFileSync(db2, 'utf8')).toBe('de Serato')
  })

  it('la grilla y los cues dentro del archivo: Cambios pendientes, se leen como los guarda Serato, y deshacer deja todo igual', async () => {
    const ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'resguardo'))
    const { items, alreadyIn } = dj.seratoChanges({ scope: 'playlists', playlistIds: [] })
    expect(alreadyIn).toBe(0)
    expect(items.map((i) => i.id).sort()).toEqual([id('uno.mp3'), id('dos.flac')].sort())
    const before = new Map(items.map((i) => [i.id, { tags: readTags(lib.trackPath(i.id)!, { exact: true }), serato: readSeratoTag(lib.trackPath(i.id)!) }]))
    ch.stageMany(items.map((i) => ({ id: i.id, field: 'serato' as const, value: i.value })))
    expect(ch.list().find((c) => c.fileId === id('uno.mp3'))?.after).toBe('grilla a 124 BPM, 2 cues y tono Am')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    const mp3 = lib.trackPath(id('uno.mp3'))!, flac = lib.trackPath(id('dos.flac'))!
    const m = readSerato(mp3, 'mp3')!
    expect(m.cues.map((c) => [c.index, c.startMs])).toEqual([[0, 1000], [2, 2000]])
    expect(m.grid!.bpm).toBe(124)
    expect(m.grid!.position).toBeCloseTo(0.5 + rb.dj.rbShift(id('uno.mp3')), 3) // en el tiempo de Rekordbox, que es el de Serato
    expect(readSerato(flac, 'flac')!.grid).toEqual({ position: 1.25, bpm: 122 })
    expect(seratoText(readSeratoTag(mp3))).toBe('grilla a 124 BPM, 2 cues y tono Am')
    // y el BPM en el tag (TBPM), que es lo que Serato muestra en su lista (prueba en Serato DJ Lite 5, 23/10)
    expect(JSON.parse(readSeratoTag(mp3)!).bpm).toBe('124.00')
    // ya tienen lo de Serato: otra exportación no los vuelve a tocar
    expect(dj.seratoChanges({ scope: 'playlists', playlistIds: [] }).alreadyIn).toBe(2)
    expect((await ch.undo(r.batchId!)).failed).toEqual([])
    expect(readSeratoTag(mp3)).toBeNull()
    // los tags y las marcas vuelven a ser los de antes (el sonido lo verifica Cambios pendientes con su huella)
    for (const [i, b] of before) expect({ tags: readTags(lib.trackPath(i)!, { exact: true }), serato: readSeratoTag(lib.trackPath(i)!) }).toEqual(b)
  }, 60_000)
})

describe('lo que encontró la corrida supervisada (23/10)', () => {
  it('Traktor: los tramos de Rekordbox que siguen la misma grilla van como un solo marcador; uno corrido, aparte', () => {
    const seg = (start: number, beat = 1) => ({ start, bpm: 127, beat })
    const m = { grid: { bpm: 127, segments: [seg(0.772441), seg(0.772441 + 152 * 60 / 127), seg(100.5)] }, cues: [] }
    expect(gridMarkers(m, 0).map((g) => Math.round(g.ms))).toEqual([772, 100500])
  })

  it('un tema que ya no está en el disco (se movió por fuera de PAILA) no frena la grilla de Serato de los demás', () => {
    tone('House/se-fue.mp3')
    return lib.scan().then(() => {
      rb.dj.saveGrid(id('se-fue.mp3'), 'beatthis', { grid: { bpm: 128, segments: [{ start: 0.1, bpm: 128, beat: 1 }], errorMs: 2, variable: false }, barEnergy: [] }, null)
      fs.rmSync(lib.trackPath(id('se-fue.mp3'))!)
      const r = dj.seratoChanges({ scope: 'todo', playlistIds: [] })
      expect(r.unreadable).toEqual([{ rel: expect.stringContaining('se-fue.mp3'), reason: 'No se pudo leer (ya no está en esa carpeta)' }])
      expect(r.alreadyIn + r.items.length).toBeGreaterThan(0)
    })
  })
})

describe('VirtualDJ', () => {
  it('busca su carpeta donde la usa el programa: AppData\\Local (las nuevas) o Documentos (las viejas)', () => {
    const has = (f: string) => (p: string) => p.replace(/\\/g, '/').startsWith(f)
    expect(vdjHomeOf('C:/L', 'C:/D', () => false).replace(/\\/g, '/')).toBe('C:/L/VirtualDJ')
    expect(vdjHomeOf('C:/L', 'C:/D', has('C:/D/VirtualDJ/database.xml')).replace(/\\/g, '/')).toBe('C:/D/VirtualDJ')
    expect(vdjHomeOf('C:/L', 'C:/D', has('C:/L/VirtualDJ/settings.xml')).replace(/\\/g, '/')).toBe('C:/L/VirtualDJ')
  })

  it('completa su base sin tocar los temas que ya tienen cues tuyos, y agrega las listas', () => {
    const vdj = path.join(home, 'AppData', 'Local', 'VirtualDJ')
    fs.mkdirSync(vdj, { recursive: true })
    // la ruta como la guarda VirtualDJ: con "\" en Windows, tal cual en Mac
    const comoVdj = (p: string) => (/^[A-Za-z]:/.test(p) ? p.replace(/\//g, '\\') : p)
    const flac = comoVdj(lib.trackPath(id('dos.flac'))!), wav = comoVdj(lib.trackPath(id('tres.wav'))!)
    const old = `<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualDJ_Database Version="8.5">\r\n <Song FilePath="${flac}" FileSize="1">\r\n  <Tags Author="Mío" Title="Mío" />\r\n  <Poi Pos="3.000000" Num="1" Type="cue" />\r\n </Song>\r\n <Song FilePath="${wav}" FileSize="2">\r\n  <Tags Author="Otro" />\r\n  <Scan Version="801" Bpm="0.5" />\r\n  <Poi Pos="0.1" Type="beatgrid" />\r\n  <Poi Pos="0.2" Type="automix" Point="realStart" />\r\n </Song>\r\n</VirtualDJ_Database>\r\n`
    fs.writeFileSync(path.join(vdj, 'database.xml'), old)
    rb.dj.saveGrid(id('tres.wav'), 'beatthis', { grid: { bpm: 125, segments: [{ start: 0.4, bpm: 125, beat: 1 }], errorMs: 2, variable: false }, barEnergy: [] }, null)
    const r = dj.virtualdj({ scope: 'todo', playlistIds: [] })
    const x = fs.readFileSync(path.join(vdj, 'database.xml'), 'utf8')
    expect(r.kept).toBe(1)
    expect(x).toContain(`<Song FilePath="${flac}" FileSize="1">\r\n  <Tags Author="Mío" Title="Mío" />\r\n  <Poi Pos="3.000000" Num="1" Type="cue" />`)
    // el WAV: su análisis y su grilla cambian, el automix y los tags quedan
    expect(x).toMatch(/<Song FilePath="[^"]*tres\.wav" FileSize="2">\r\n {2}<Tags Author="Otro" \/>\r\n {2}<Poi Pos="0.2" Type="automix" Point="realStart" \/>\r\n {2}<Scan Version="801" Bpm="0.48" Phase="0.4" Flag="32768" \/>\r\n {2}<Poi Pos="0.4" Type="beatgrid" \/>/)
    // el MP3 es nuevo: en el tiempo de VirtualDJ (como ffmpeg), con el BPM en segundos por tiempo
    expect(x).toMatch(/uno\.mp3" FileSize="\d+">[\s\S]*?<Scan Version="801" Bpm="0.483871" Phase="0.5" Key="Am" Flag="32768" \/>\r\n {2}<Poi Pos="0.5" Type="beatgrid" \/>\r\n {2}<Poi Name="Entrada" Pos="0.974943" Num="1" Type="cue" \/>/)
    expect(r.backups.some((b) => b.endsWith('database.xml'))).toBe(true)
    expect(fs.readFileSync(r.backups.find((b) => b.endsWith('database.xml'))!, 'utf8')).toBe(old)
    // "Mis Listas" no tiene carpetas: la lista va suelta con su camino en el nombre (visto en VirtualDJ 2026)
    const list = fs.readFileSync(path.join(vdj, 'MyLists', 'PAILA - Fiestas - Casamiento.vdjfolder'), 'utf8')
    expect(list.match(/<song /g)).toHaveLength(3) // VirtualDJ también lee WMA
    expect(mergeDatabase(null, []).xml).toContain('<VirtualDJ_Database Version="8.5">')
  })
})
