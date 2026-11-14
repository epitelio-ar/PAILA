// Tests de "Tapas para todo" y "Volumen parejo" (core/covers.ts, core/coverstore.ts, core/foldercover.ts,
// core/replaygain.ts y su paso por Cambios pendientes): vista previa, no pisar una tapa buena con una peor, cover.jpg en la
// carpeta, ReplayGain solo como dato del tag (el audio verificado por huella) y deshacer todo. Internet va simulado.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { imageInfo } from '@paila/core/coverstore'
import { readCover, readReplayGain, readTags, writeTags } from '@paila/core/tagio'
import { AlbumSources } from '@paila/core/albumsources'
import { AlbumCheck } from '@paila/core/albumrun'
import { Covers } from '@paila/core/covers'
import { albumLoudness, gainChanges, gainPlan, othersRight } from '@paila/core/replaygain'
import { File, Id3v2CommentsFrame, TagTypes, type Id3v2Tag } from 'node-taglib-sharp'
import { pcmHash } from '@paila/core/audiohash'
import type { FetchFn } from '@paila/core/online/http'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
let dir: string
let lib: Library
let ch: Changes
const img = (name: string, size: number, color = 'red') => {
  const f = path.join(dir, name)
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}x${size}`, '-frames:v', '1', f])
  return fs.readFileSync(f)
}
const tone = (rel: string, meta: Record<string, string>, freq = 440) => {
  const out = path.join(dir, 'M', ...rel.split('/'))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=2`, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}
const id = (end: string) => lib.tracks().find((r) => String(r[2]).endsWith(end))![0] as number
const coverOf = (data: Buffer) => JSON.stringify({ mime: 'image/jpeg', data: data.toString('base64') })

let big: Buffer, small: Buffer, mid: Buffer
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-tapas-'))
  big = img('big.jpg', 1200); small = img('small.jpg', 300, 'blue'); mid = img('mid.jpg', 600, 'green')
  for (const [i, t] of ['Uno', 'Dos', 'Tres'].entries()) tone(`Sumo/Divididos/${t}.mp3`, { artist: 'Sumo', title: t, album: 'Divididos por la felicidad', track: String(i + 1) }, 300 + i * 100)
  tone('Sumo/Divididos/Cuatro.flac', { artist: 'Sumo', title: 'Cuatro', album: 'Divididos por la felicidad', track: '4' }, 700)
  for (const t of ['A', 'B']) tone(`Virus/Locura/${t}.mp3`, { artist: 'Virus', title: t, album: 'Locura' })
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg, path.join(dir, 'datos', 'resguardo'))
  // "Locura" ya tiene una tapa buena en todos sus temas y en la carpeta
  for (const t of ['A', 'B']) writeTags(lib.trackPath(id(`${t}.mp3`))!, { cover: coverOf(big) })
  fs.writeFileSync(path.join(dir, 'M', 'Virus', 'Locura', 'cover.jpg'), big)
  await lib.scan()
}, 120_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('tapas', () => {
  it('lee el tamaño de un JPG y un PNG', () => {
    expect(imageInfo(big)).toEqual({ mime: 'image/jpeg', width: 1200, height: 1200 })
    const png = path.join(dir, 'x.png')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x480', '-frames:v', '1', png])
    expect(imageInfo(fs.readFileSync(png))).toEqual({ mime: 'image/png', width: 640, height: 480 })
    expect(imageInfo(Buffer.from('no es una imagen'))).toBeNull()
  })

  it('la tapa va a Cambios pendientes como referencia corta, se aplica verificada y se deshace', async () => {
    const t = id('Uno.mp3'), file = lib.trackPath(t)!
    const before = await pcmHash(ffmpeg, file)
    ch.stage([t], 'cover', ch.covers.refValue(big))
    const raw = lib.db.prepare("SELECT after FROM pending_changes WHERE field = 'cover'").get() as { after: string }
    expect(raw.after.length).toBeLessThan(120) // no la imagen entera en la base
    expect(ch.list()[0]).toMatchObject({ field: 'cover', before: 'sin tapa', after: 'tapa nueva' })
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(readCover(file)).toBe(coverOf(big))
    expect(await pcmHash(ffmpeg, file)).toBe(before) // el audio, intacto
    const j = lib.db.prepare("SELECT after FROM journal WHERE field = 'cover'").get() as { after: string }
    expect(j.after.length).toBeLessThan(120)
    await ch.undo(r.batchId!)
    expect(readCover(file)).toBeNull()
  })

  it('cover.jpg en la carpeta: se crea, se reemplaza guardando el de antes, y deshacer lo deja como estaba', async () => {
    const t = id('Dos.mp3'), folder = path.dirname(lib.trackPath(t)!), cover = path.join(folder, 'cover.jpg')
    ch.stage([t], 'folderCover', ch.covers.refValue(small))
    const a = await ch.apply()
    expect(fs.readFileSync(cover).equals(small)).toBe(true)
    ch.stage([t], 'folderCover', ch.covers.refValue(big))
    expect(ch.list()[0]).toMatchObject({ field: 'folderCover', before: 'con tapa', after: 'tapa nueva' })
    const b = await ch.apply()
    expect(fs.readFileSync(cover).equals(big)).toBe(true)
    await ch.undo(b.batchId!)
    expect(fs.readFileSync(cover).equals(small)).toBe(true)
    await ch.undo(a.batchId!)
    expect(fs.existsSync(cover)).toBe(false)
    expect(fs.readdirSync(folder).filter((n) => n.startsWith('.cover'))).toEqual([]) // sin temporales
  })

  // (Windows Media y los archivos ocultos con attrib son de Windows)
  it.runIf(process.platform === 'win32')('el Folder.jpg oculto y chico de Windows Media se reemplaza (sigue oculto) y deshacer lo vuelve como estaba', async () => {
    const t = id('Dos.mp3'), folder = path.dirname(lib.trackPath(t)!), win = path.join(folder, 'Folder.jpg')
    fs.writeFileSync(win, small)
    execFileSync('attrib', ['+h', '+s', win])
    ch.stage([t], 'folderCover', ch.covers.refValue(big))
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(fs.readFileSync(path.join(folder, 'cover.jpg')).equals(big)).toBe(true)
    expect(fs.readFileSync(win).equals(big)).toBe(true)
    expect(execFileSync('attrib', [win]).toString()).toMatch(/^\s*A?\s*S\s*H|\bH\b/) // oculto todavía
    await ch.undo(r.batchId!)
    expect(fs.readFileSync(win).equals(small)).toBe(true)
    expect(fs.existsSync(path.join(folder, 'cover.jpg'))).toBe(false)
    execFileSync('attrib', ['-h', '-s', win]); fs.rmSync(win)
  })

  it('propone solo donde la tapa de hoy es peor, nunca pisa una buena, y arma los cambios (tapa y cover.jpg)', async () => {
    const asked: string[] = []
    const fetchFn: FetchFn = async (url) => {
      asked.push(url)
      if (url.includes('musicbrainz.org')) return { ok: true, status: 200, json: async () => ({ releases: [{ id: 'r1', score: 100, title: 'Divididos por la felicidad', status: 'Official', 'track-count': 4, 'artist-credit': [{ name: 'Sumo' }], 'release-group': { id: 'g1' } }] }) }
      if (url.includes('coverartarchive.org/release/r1/')) return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => big.buffer.slice(big.byteOffset, big.byteOffset + big.length) } as never
      return { ok: false, status: 404, json: async () => ({}) }
    }
    // un tema con una tapa de 600 (peor que la de 1200) y otro con ninguna
    writeTags(lib.trackPath(id('Tres.mp3'))!, { cover: coverOf(mid) })
    const ac = new AlbumCheck(lib.db, new AlbumSources(lib.db, { ua: 'test', fetchFn, gapMs: 0 }))
    const covers = new Covers(lib.db, ch, (i) => lib.trackPath(i), ac, { ua: 'test', useDeezer: () => false, fetchFn, gapMs: 0 })
    const props = await covers.scan(() => {}, () => false)
    const sumo = props.find((p) => p.album === 'Divididos por la felicidad')!
    expect(sumo).toMatchObject({ embed: 4, folderFile: true, without: 3, proposed: { width: 1200, source: 'Cover Art Archive' } })
    expect(props.find((p) => p.album === 'Locura')!.why).toMatch(/Ya tiene una tapa buena/)
    expect(asked.some((u) => u.includes('Locura'))).toBe(false) // ni se buscó
    expect(covers.stage([sumo.key])).toEqual({ tracks: 4, folders: 1 })
    expect(ch.list().filter((c) => c.field === 'cover').length).toBe(4)
    // lo propuesto queda marcado: la pestaña no vuelve a ofrecer "Proponer las N tildadas" (punto 1 real del 24/10)
    expect(covers.last.find((p) => p.key === sumo.key)).toMatchObject({ staged: true })
    expect(covers.last.filter((p) => p.proposed && !p.staged).map((p) => p.album)).not.toContain('Divididos por la felicidad')
    // otra vez: la búsqueda quedó guardada
    const n = asked.length
    await covers.scan(() => {}, () => false)
    expect(asked.length).toBe(n)
    ch.discard()
  })

  it('si la carpeta ya tiene una buena (Front.jpg) y los temas una chica adentro, embebe la de la carpeta sin ir a internet', async () => {
    tone('Babasonicos/Jessico/Uno.mp3', { artist: 'Babasónicos', title: 'Uno', album: 'Jessico' })
    tone('Babasonicos/Jessico/Dos.mp3', { artist: 'Babasónicos', title: 'Dos', album: 'Jessico' })
    await lib.scan()
    // la misma tapa, más chica (la de la carpeta tiene que parecerse a la de adentro: core/coversimilar.ts)
    for (const t of ['Jessico/Uno.mp3', 'Jessico/Dos.mp3']) writeTags(lib.trackPath(id(t))!, { cover: coverOf(img('big-chica.jpg', 300)) })
    fs.writeFileSync(path.join(dir, 'M', 'Babasonicos', 'Jessico', 'Front.jpg'), big)
    const asked: string[] = []
    const fetchFn: FetchFn = async (url) => { asked.push(url); return { ok: false, status: 404, json: async () => ({}) } }
    const covers = new Covers(lib.db, ch, (i) => lib.trackPath(i), new AlbumCheck(lib.db, new AlbumSources(lib.db, { ua: 't', fetchFn, gapMs: 0 })), { ua: 't', useDeezer: () => false, fetchFn, gapMs: 0 })
    const p = (await covers.scan(() => {}, () => false)).find((x) => x.album === 'Jessico')!
    expect(p).toMatchObject({ embed: 2, folderFile: false, proposed: { width: 1200, source: 'la carpeta (Front.jpg)' } })
    expect(asked.filter((u) => u.includes('Jessico'))).toEqual([])
  })

  it('una imagen de la carpeta más grande pero que es otra ("El Círculo": la de la edición instrumental) no pisa la de los temas', async () => {
    tone('Kase.O/El circulo/Intro.mp3', { artist: 'Kase.O', title: 'Intro', album: 'El círculo' })
    tone('Kase.O/El circulo/Yemen.mp3', { artist: 'Kase.O', title: 'Yemen', album: 'El círculo' })
    await lib.scan()
    for (const t of ['El circulo/Intro.mp3', 'El circulo/Yemen.mp3']) writeTags(lib.trackPath(id(t))!, { cover: coverOf(img('circulo.jpg', 800, 'orange')) })
    fs.writeFileSync(path.join(dir, 'M', 'Kase.O', 'El circulo', 'folder.jpg'), img('instrumental.jpg', 1200, 'green'))
    const fetchFn: FetchFn = async () => ({ ok: false, status: 404, json: async () => ({}) })
    const covers = new Covers(lib.db, ch, (i) => lib.trackPath(i), new AlbumCheck(lib.db, new AlbumSources(lib.db, { ua: 't', fetchFn, gapMs: 0 })), { ua: 't', useDeezer: () => false, fetchFn, gapMs: 0 })
    const p = (await covers.scan(() => {}, () => false)).find((x) => x.album === 'El círculo')!
    expect(p.proposed).toBeNull() // va a buscarla a internet (acá no hay): no propone la de la carpeta
    fs.rmSync(path.join(dir, 'M', 'Kase.O'), { recursive: true, force: true }); await lib.scan() // las cuentas de abajo no lo esperan
  })

  it('una tapa de internet más chica que la que hay no se propone', () => {
    const covers = new Covers(lib.db, ch, (i) => lib.trackPath(i), new AlbumCheck(lib.db, new AlbumSources(lib.db, { ua: 't' })), { ua: 't', useDeezer: () => false })
    const g = { key: 'k', dir: 'd', artist: 'X', album: 'Y', year: null, ownFolder: true, checkable: true, various: false, tracks: [{ id: 999, rel: 'd/a.mp3', title: 'a', artist: 'X', track: 1, disc: null, duration: 2, ext: 'mp3' }] }
    const base = { key: 'k', dir: 'd', artist: 'X', album: 'Y', tracks: 1, current: null, without: 0, folder: null, proposed: null, embed: 0, folderFile: false, why: null }
    const p = covers.decide(g, base, { min: { width: 1000, height: 1000, trackId: 999 }, minAny: { width: 1000, height: 1000, trackId: 999 }, without: 0, folder: { name: 'folder.jpg', width: 1000, height: 1000 } }, { sha: 'x', width: 600, height: 600, bytes: 1, source: 'iTunes' })
    expect([p.proposed, p.why]).toEqual([null, 'La que tiene ya es igual o mejor (1000×1000)'])
    // un disco de WMA (La esquina del infinito): no "undefined×undefined" (corrida supervisada del 20/10)
    const wma = { ...g, ownFolder: false, tracks: [{ ...g.tracks[0], id: 998, ext: 'wma' }] }
    const w = covers.decide(wma, base, { min: null, minAny: null, without: 0, folder: null }, { sha: 'x', width: 1200, height: 1200, bytes: 1, source: 'iTunes' })
    expect(w.why).toMatch(/^Son WMA/)
  })
})

describe('volumen parejo (ReplayGain)', () => {
  it('el de otro programa vale si está a menos de 1 dB del que mide PAILA, y se decide por disco entero', () => {
    const t = (gain: number, tg: number, ag: number | null = null) => ({ t: { gain }, cur: { tg, tp: null, ag, ap: null } })
    expect(othersRight([t(-5.5, -4.9)], null, 1)).toBe(true)
    expect(othersRight([t(-5.5, -4.4)], null, 1)).toBe(false) // 1,1 dB: se nota
    // Viejas Locas (copia de la base, 22/10): 5 de 15 temas a más de 1 dB → se corrige el disco entero, para que quede parejo
    expect(othersRight([t(-7.3, -7.27, -7.54), t(-7.7, -6.11, -7.54)], -7.87, 2)).toBe(false)
    // el disco: el otro programa midió los mismos temas (todos con el mismo valor) y no coincide
    expect(othersRight([t(-2, -2.1, -0.7), t(3, 3.1, -0.7)], 0.91, 2)).toBe(false)
    expect(othersRight([t(-2, -2.1, -0.7), t(3, 3.1, -0.7)], -0.2, 2)).toBe(true)
    // Virus en una carpeta de un set (22/10): solo ese tema lo tiene; el otro programa midió el disco entero, que acá no
    // está. Sin con qué comparar el disco, vale el tema (bien)
    expect(othersRight([t(-5.5, -5.48, -7.46)], -5.89, 3)).toBe(true)
  })

  it('la marca "Sound Check" de iTunes (iTunNORM) no se toca al escribir el volumen parejo', () => {
    // fuera de la carpeta de música (no tiene que entrar en los demás tests)
    const file = path.join(dir, 'norm.mp3')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=duration=2', file])
    const NORM = ' 000003E8 000003E8 00002710 00002710 00000000 00000000 00007FFF 00007FFF 00000000 00000000'
    const commentOf = () => {
      const f = File.createFromPath(file)
      try { return ((f.getTag(TagTypes.Id3v2, false) as Id3v2Tag).frames.find((x) => (x as Id3v2CommentsFrame).description === 'iTunNORM') as Id3v2CommentsFrame | undefined)?.text } finally { f.dispose() }
    }
    const f = File.createFromPath(file)
    const c = Id3v2CommentsFrame.fromDescription('iTunNORM', 'eng')
    c.text = NORM
    ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(c)
    f.save(); f.dispose()
    expect(commentOf()).toBe(NORM)
    expect(readReplayGain(file)).toBeNull() // Sound Check no es ReplayGain: para PAILA el tema no tiene volumen parejo
    writeTags(file, { replaygain: JSON.stringify({ tg: -2, tp: 0.9, ag: null, ap: null }) })
    expect(commentOf()).toBe(NORM)
    writeTags(file, { replaygain: null })
    expect(commentOf()).toBe(NORM)
  })

  it('el volumen del disco es el promedio de energía pesado por duración', () => {
    expect(albumLoudness([{ lufs: -10, duration: 100 }, { lufs: -20, duration: 100 }])).toBeCloseTo(-12.6, 1)
    expect(albumLoudness([{ lufs: -10, duration: 300 }])).toBeCloseTo(-10, 5)
  })

  it('el año escrito a la vieja (TYER en un ID3v2.4, AIFF de Bandcamp) no se pierde al guardar (prueba en la copia, 20/10)', async () => {
    // un MP3 sin tags con un ID3v2.4 armado a mano: TIT2 y TYER (cuadro de la v2.3, que la librería lee pero no sabe guardar)
    const raw = path.join(dir, 'raw.mp3')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=2', '-write_id3v2', '0', '-write_xing', '0', raw])
    const frame = (id: string, text: string) => { const body = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]); const h = Buffer.alloc(10); h.write(id, 0, 'latin1'); h.writeUInt32BE(body.length, 4); return Buffer.concat([h, body]) }
    const frames = Buffer.concat([frame('TIT2', 'Viejo'), frame('TYER', '2022')])
    const ss = (n: number) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
    const out = path.join(dir, 'M', 'Viejo', 'viejo.mp3')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0]), ss(frames.length), frames, fs.readFileSync(raw)]))
    expect(readTags(out)).toMatchObject({ title: 'Viejo', year: '2022' })
    await lib.scan()
    const t = id('viejo.mp3')
    ch.stage([t], 'title', 'Nuevo')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(readTags(out)).toMatchObject({ title: 'Nuevo', year: '2022' })
    await ch.undo(r.batchId!)
    expect(readTags(out)).toMatchObject({ title: 'Viejo', year: '2022' })
  })

  it('un archivo que la librería de tags no puede abrir se saltea (antes frenaba todo el armado: prueba en la copia, 20/10)', async () => {
    fs.mkdirSync(path.join(dir, 'M', 'Roto'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'M', 'Roto', 'x.mp3'), Buffer.alloc(20000))
    const rootId = (lib.db.prepare('SELECT id FROM roots').get() as { id: number }).id
    const r = lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, duration) VALUES (?, 'Roto/x.mp3', 20000, 1, 'musica', 'mp3', 100)").run(rootId)
    lib.db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, lufs) VALUES (?, 1, 20000, 1, '2026-10-20', -12)").run(r.lastInsertRowid)
    const plan = await gainPlan(lib.db, (i) => lib.trackPath(i), { readCurrent: true })
    const t = plan.albums.flatMap((a) => a.tracks).find((x) => x.rel === 'Roto/x.mp3')!
    expect(t.why).toMatch(/no puede abrir/)
    expect(gainChanges(plan, true).some((c) => c.id === Number(r.lastInsertRowid))).toBe(false)
    lib.db.prepare('DELETE FROM analysis WHERE file_id = ?').run(r.lastInsertRowid)
    lib.db.prepare('DELETE FROM files WHERE id = ?').run(r.lastInsertRowid)
  })

  it('un tema mucho más suave que el resto no baja el volumen del disco (LPDA: medido de corrido -8,0 LUFS)', () => {
    const lpda = [{ lufs: -7.2, duration: 281 }, { lufs: -19.6, duration: 277 }, { lufs: -8.3, duration: 353.6 }, { lufs: -7.6, duration: 228.2 }]
    expect(Math.abs(albumLoudness(lpda)! - -8.0)).toBeLessThan(0.3) // sin la regla daba -8,85
  })

  it('calcula con el análisis, escribe solo el tag (el audio verificado por huella) y se deshace', async () => {
    const ids = ['Uno.mp3', 'Dos.mp3', 'Tres.mp3', 'Cuatro.flac'].map(id)
    const lufs = [-28, -26, -24, -22] // más bajo que la referencia (-18): hay que subirlos
    for (const [i, fid] of ids.entries()) {
      const f = lib.db.prepare('SELECT size, mtime FROM files WHERE id = ?').get(fid) as { size: number; mtime: number }
      lib.db.prepare("INSERT OR REPLACE INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, lufs, true_peak) VALUES (?, 1, ?, ?, '2026-10-20', ?, ?)").run(fid, f.size, f.mtime, lufs[i], -1 - i)
    }
    const plan = await gainPlan(lib.db, (i) => lib.trackPath(i), { readCurrent: true })
    const sumo = plan.albums.find((a) => a.album === 'Divididos por la felicidad')!
    expect(ids.map((i) => sumo.tracks.find((t) => t.id === i)!.gain)).toEqual([10, 8, 6, 4])
    expect(sumo.gain).toBeCloseTo(-18 - albumLoudness(lufs.map((l) => ({ lufs: l, duration: 2 })))!, 1)
    expect(sumo.peak).toBeCloseTo(10 ** (-1 / 20), 5)
    expect(plan.notAnalyzed).toBe(5) // los de Virus, Babasónicos y el del año viejo no tienen análisis
    const before = await pcmHash(ffmpeg, lib.trackPath(ids[3])!)
    ch.stageMany(gainChanges(plan))
    expect(ch.list().find((c) => c.fileId === ids[0] && c.field === 'replaygain')!.after).toBe('+10,0 dB · disco +6,4 dB')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(JSON.parse(readReplayGain(lib.trackPath(ids[0])!)!)).toMatchObject({ tg: 10, tp: 0.891251 })
    expect(await pcmHash(ffmpeg, lib.trackPath(ids[3])!)).toBe(before)
    // lo que lee cualquier reproductor: el tag estándar
    const tags = execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', lib.trackPath(ids[0])!]).toString()
    expect(tags).toMatch(/"REPLAYGAIN_TRACK_GAIN": "\+?10\.00 dB"/i)
    // el análisis sigue valiendo (el audio no cambió) y una segunda vez no hay nada nuevo
    const again = await gainPlan(lib.db, (i) => lib.trackPath(i), { readCurrent: true })
    expect([again.ready, again.same]).toEqual([0, 4])
    // lo que puso otro programa (decidido el 22/10): si coincide con lo que mide PAILA (menos de 1 dB) se deja…
    const dos = lib.trackPath(ids[1])!
    writeTags(dos, { replaygain: JSON.stringify({ tg: 7.3, tp: 0.5, ag: sumo.gain! + 0.6, ap: 0.5 }) })
    const ok = await gainPlan(lib.db, (i) => lib.trackPath(i), { readCurrent: true })
    expect([ok.other, ok.wrong, ok.ready]).toEqual([1, 0, 0])
    expect(gainChanges(ok)).toEqual([])
    // …y si está mal, se corrige con los demás (por Cambios pendientes) y se puede deshacer
    writeTags(dos, { replaygain: JSON.stringify({ tg: -3.1, tp: 0.5, ag: null, ap: null }) })
    const bad = await gainPlan(lib.db, (i) => lib.trackPath(i), { readCurrent: true })
    expect([bad.other, bad.wrong, bad.ready]).toEqual([0, 1, 1])
    expect(bad.albums.flatMap((a) => a.tracks).find((t) => t.id === ids[1])!.wrong).toBe(-3.1)
    ch.stageMany(gainChanges(bad))
    expect(ch.list().find((c) => c.fileId === ids[1])).toMatchObject({ before: '-3,1 dB', after: '+8,0 dB · disco +6,4 dB' })
    const fix = await ch.apply()
    expect(fix.failed).toEqual([])
    expect(JSON.parse(readReplayGain(dos)!)).toMatchObject({ tg: 8 })
    await ch.undo(fix.batchId!)
    expect(JSON.parse(readReplayGain(dos)!)).toMatchObject({ tg: -3.1, ag: null })
    await ch.undo(r.batchId!)
    expect(readReplayGain(lib.trackPath(ids[0])!)).toBeNull()
  })
})
