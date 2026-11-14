// Tests de "Llevar la música" (core/carry.ts, core/m3uexport.ts, core/serverready.ts): copiar al celular convirtiendo,
// playlists .m3u8 para reproductores de PC y el chequeo "listo para tu servidor". Archivos sintéticos hechos con ffmpeg.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe, probe } from '@paila/core/probe'
import { Playlists } from '@paila/core/playlists'
import { DEFAULT_PHONE, PhoneCopier, decide } from '@paila/core/carry'
import { exportM3uLists, m3uText } from '@paila/core/m3uexport'
import { folderHasAlbum, folderHasArtist, serverCheck } from '@paila/core/serverready'
import { readCover, readTags, writeTags } from '@paila/core/tagio'
import { ponerIdioma } from '@paila/shared/idioma'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
let dir: string, M: string
let lib: Library
let pc: PhoneCopier
let ids: Record<string, number>
const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
const tone = (rel: string, extra: string[], meta: Record<string, string>, secs = 4) => {
  const out = path.join(M, rel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`, '-ac', '2', ...extra, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-carry-'))
  M = path.join(dir, 'Música')
  const jpg = path.join(dir, 'tapa.jpg')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=300x300', '-frames:v', '1', jpg])
  tone('Soda Stereo/Canción animal/01 - Un millón de años luz.flac', ['-ar', '96000', '-sample_fmt', 's32'], { artist: 'Soda Stereo', album_artist: 'Soda Stereo', album: 'Canción animal', title: 'Un millón de años luz', track: '1', date: '1990' })
  writeTags(path.join(M, 'Soda Stereo/Canción animal/01 - Un millón de años luz.flac'), { cover: JSON.stringify({ mime: 'image/jpeg', data: fs.readFileSync(jpg).toString('base64') }) })
  tone('Soda Stereo/Canción animal/02 - De música ligera.mp3', ['-b:a', '320k'], { artist: 'Soda Stereo', album: 'Canción animal', title: 'De música ligera', track: '2', date: '1990' })
  tone('Sueltos/chico.mp3', ['-b:a', '128k'], { artist: 'Emilia feat. TINI', title: 'Chico' })
  tone('Sueltos/raro.ogg', ['-c:a', 'libvorbis', '-b:a', '96k'], { artist: 'Raro', title: 'Ogg: con/barras?' })
  tone('Sin tags/x.wav', [], {})
  fs.copyFileSync(jpg, path.join(M, 'Sin tags/folder.jpg')) // la tapa de la carpeta tiene que viajar al convertido
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M, [{ rel: '', kind: 'musica' }])
  await lib.scan()
  const id = (n: string) => lib.tracks().find((r) => String(r[2]).endsWith(n))![0] as number
  ids = { flac: id('.flac'), mp3hi: id('ligera.mp3'), mp3lo: id('chico.mp3'), ogg: id('raro.ogg'), wav: id('x.wav') }
  pc = new PhoneCopier(lib.db, (i) => lib.trackPath(i), ffmpeg, ffprobe, () => lib.roots().map((r) => r.path))
}, 90_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('qué se convierte y qué se copia tal cual', () => {
  it('no reconvierte lo que ya es chico y compatible; convierte lo pesado y lo que el celular no lee', () => {
    expect(decide({ ext: 'mp3', codec: 'mp3', size: 0, duration: 200, kbps: 128 }, 'aac', 'normal').action).toBe('copy')
    expect(decide({ ext: 'mp3', codec: 'mp3', size: 0, duration: 200, kbps: 210 }, 'mp3', 'normal').action).toBe('copy') // casi igual: no vale la pena
    expect(decide({ ext: 'mp3', codec: 'mp3', size: 0, duration: 200, kbps: 320 }, 'aac', 'normal')).toMatchObject({ action: 'convert', kbps: 192 })
    expect(decide({ ext: 'm4a', codec: 'aac', size: 0, duration: 200, kbps: 256 }, 'aac', 'alta').action).toBe('copy')
    expect(decide({ ext: 'm4a', codec: 'alac', size: 0, duration: 200, kbps: 900 }, 'aac', 'alta')).toMatchObject({ action: 'convert', kbps: 256 })
    expect(decide({ ext: 'flac', codec: 'flac', size: 0, duration: 200, kbps: 900 }, 'mp3', 'alta')).toMatchObject({ action: 'convert', kbps: 320 })
    // un OGG finito no se infla a 192 (ni a 128): nunca se agranda
    expect(decide({ ext: 'ogg', codec: 'vorbis', size: 0, duration: 200, kbps: 96 }, 'aac', 'normal')).toMatchObject({ action: 'convert', kbps: 96 })
    expect(decide({ ext: 'ogg', codec: 'vorbis', size: 0, duration: 200, kbps: 100 }, 'aac', 'normal').kbps).toBeLessThanOrEqual(100)
    expect(decide({ ext: 'wma', codec: 'wmav2', size: 0, duration: 200, kbps: 48 }, 'aac', 'normal').kbps).toBe(64)
    // sin kbps guardado se calcula del tamaño
    expect(decide({ ext: 'mp3', codec: 'mp3', size: 8_000_000, duration: 200, kbps: null }, 'aac', 'normal')).toMatchObject({ action: 'convert' })
  })

  it('lo que está en menor calidad que la elegida se copia tal cual en todas las calidades', () => {
    for (const q of ['chica', 'normal', 'alta'] as const) for (const fmt of ['aac', 'mp3'] as const) {
      const d = decide({ ext: 'mp3', codec: 'mp3', size: 0, duration: 200, kbps: 96 }, fmt, q)
      expect(d).toMatchObject({ action: 'copy', kbps: 96 })
      expect(d.why).toMatch(/no se agranda/)
    }
  })

  it('Original copia todo sin convertir y avisa lo que el celular puede no leer', () => {
    expect(decide({ ext: 'flac', codec: 'flac', size: 0, duration: 200, kbps: 900 }, 'aac', 'original')).toMatchObject({ action: 'copy', kbps: 900 })
    expect(decide({ ext: 'mp3', codec: 'mp3', size: 0, duration: 200, kbps: 320 }, 'mp3', 'original')).toMatchObject({ action: 'copy' })
    expect(decide({ ext: 'wma', codec: 'wmav2', size: 0, duration: 200, kbps: 128 }, 'aac', 'original')).toMatchObject({ action: 'copy', unfriendly: true })
    expect(decide({ ext: 'ogg', codec: 'vorbis', size: 0, duration: 200, kbps: 128 }, 'aac', 'original').unfriendly).toBeFalsy() // Android lo lee
  })
})

describe('al celular', () => {
  const order = () => [ids.ogg, ids.flac, ids.mp3lo, ids.mp3hi, ids.wav, ids.flac]

  it('arma el plan en el orden de la lista, con nombres seguros y sin repetir el mismo tema', () => {
    const plan = pc.plan('Viaje: ida/vuelta', order(), { ...DEFAULT_PHONE, dest: path.join(dir, 'Cel') })
    expect(plan.folder).toBe(path.join(dir, 'Cel', 'Viaje_ ida_vuelta'))
    expect(plan.items.map((i) => i.outRel)).toEqual(['001 - Raro - Ogg_ con_barras_.m4a', '002 - Soda Stereo - Un millón de años luz.m4a', '003 - Emilia feat. TINI - Chico.mp3', '004 - Soda Stereo - De música ligera.m4a', '005 - x.m4a'])
    expect(plan.items.map((i) => i.action)).toEqual(['convert', 'convert', 'copy', 'convert', 'convert'])
    expect(plan.totalBytes).toBeLessThan(plan.srcBytes)
    const albums = pc.plan('x', order(), { ...DEFAULT_PHONE, layout: 'discos', format: 'mp3', dest: path.join(dir, 'Cel') })
    expect(albums.items.map((i) => i.outRel)).toContain('Soda Stereo/Canción animal/01 - Un millón de años luz.mp3')
    expect(albums.items.map((i) => i.outRel)).toContain('Emilia feat. TINI/Emilia feat. TINI - Chico.mp3')
    expect(albums.items.map((i) => i.outRel)).toContain('Artista desconocido/x.mp3')
  })

  it('no deja copiar adentro de la biblioteca', async () => {
    const plan = pc.plan('x', order(), { ...DEFAULT_PHONE, dest: path.join(M, 'Cel') })
    expect(plan.warnings[0]).toMatch(/dentro de tu biblioteca/)
    expect(plan.insideLibrary).toBe(true) // la pantalla frena con el dato, no con el texto del aviso
    await expect(pc.run(plan)).rejects.toThrow(/dentro de tu biblioteca/)
    expect(fs.existsSync(path.join(M, 'Cel'))).toBe(false)
    expect(pc.plan('x', order(), { ...DEFAULT_PHONE, dest: path.join(dir, 'Cel') }).insideLibrary).toBeUndefined()
  })

  it('en inglés frena igual y los nombres que escribe no cambian', () => {
    try {
      ponerIdioma('en')
      const plan = pc.plan('x', order(), { ...DEFAULT_PHONE, dest: path.join(M, 'Cel') })
      expect(plan.insideLibrary).toBe(true)
      expect(plan.warnings[0]).toMatch(/inside your library/)
      const albums = pc.plan('x', order(), { ...DEFAULT_PHONE, layout: 'discos', format: 'mp3', dest: path.join(dir, 'Cel') })
      expect(albums.items.map((i) => i.outRel)).toContain('Artista desconocido/x.mp3')
      expect(pc.plan('', order(), { ...DEFAULT_PHONE, dest: path.join(dir, 'Cel') }).name).toBe('Playlist')
    } finally { ponerIdioma('es') }
  })

  it('convierte con tags y tapa, copia lo chico tal cual, escribe el .m3u8 y no toca los originales', async () => {
    const before = Object.fromEntries(Object.values(ids).map((i) => [i, md5(lib.trackPath(i)!)]))
    const plan = pc.plan('Viaje', order(), { ...DEFAULT_PHONE, dest: path.join(dir, 'Cel') })

    const r = await pc.run(plan, { concurrency: () => 2 })
    expect(r.failed).toEqual([])
    expect(r.converted).toBe(4); expect(r.copied).toBe(1)
    const out = (n: string) => path.join(plan.folder, n)
    const flac = out('002 - Soda Stereo - Un millón de años luz.m4a')
    const p = await probe(ffprobe, flac)
    expect(p.codec).toBe('aac'); expect(p.sampleRate).toBe(48000) // 96 kHz → 48 kHz
    expect(Math.abs(p.duration! - 4)).toBeLessThan(0.2)
    expect(readTags(flac)).toMatchObject({ artist: 'Soda Stereo', title: 'Un millón de años luz', album: 'Canción animal', year: '1990', track: '1' })
    expect(readCover(flac)).not.toBeNull()
    const wav = out('005 - x.m4a')
    expect(readCover(wav)).not.toBeNull() // la tapa de la carpeta (folder.jpg)
    expect(readTags(out('001 - Raro - Ogg_ con_barras_.m4a')).title).toBe('Ogg: con/barras?')
    expect(md5(out('003 - Emilia feat. TINI - Chico.mp3'))).toBe(before[ids.mp3lo]) // copiado tal cual
    expect(fs.statSync(out('004 - Soda Stereo - De música ligera.m4a')).size).toBeLessThan(fs.statSync(lib.trackPath(ids.mp3hi)!).size)
    for (const [i, h] of Object.entries(before)) expect(md5(lib.trackPath(Number(i))!)).toBe(h)
    const m3u = fs.readFileSync(r.m3u!, 'utf8').split('\r\n')
    expect(path.basename(r.m3u!)).toBe('Viaje.m3u8')
    expect(m3u.filter((l) => l && !l.startsWith('#'))).toEqual(plan.items.map((i) => i.outRel))
    expect(m3u[1]).toMatch(/^#EXTINF:4,Raro - Ogg: con\/barras\?$/)
    expect(fs.readdirSync(plan.folder).some((n) => n.includes('paila-tmp'))).toBe(false)
    // otra vez: retoma sin rehacer nada
    const again = await pc.run(plan)
    expect(again.skippedExisting).toBe(5); expect(again.converted + again.copied).toBe(0)
  }, 90_000)

  it('Artista/Álbum con el .m3u8 de rutas relativas con /', async () => {
    const plan = pc.plan('Discos', [ids.flac, ids.mp3hi], { ...DEFAULT_PHONE, layout: 'discos', format: 'mp3', quality: 'chica', dest: path.join(dir, 'Cel2') })
    const r = await pc.run(plan)
    expect(r.failed).toEqual([])
    const f = path.join(plan.folder, 'Soda Stereo', 'Canción animal', '02 - De música ligera.mp3')
    expect((await probe(ffprobe, f)).kbps).toBeLessThanOrEqual(130)
    expect(fs.readFileSync(r.m3u!, 'utf8')).toContain('Soda Stereo/Canción animal/01 - Un millón de años luz.mp3')
  })

  it('no pisa un archivo distinto, se puede cancelar y espera mientras está en pausa', async () => {
    const plan = pc.plan('Otra', order(), { ...DEFAULT_PHONE, dest: path.join(dir, 'Cel3') })
    fs.mkdirSync(plan.folder, { recursive: true })
    fs.writeFileSync(path.join(plan.folder, '003 - Emilia feat. TINI - Chico.mp3'), 'algo distinto')
    let paused = true
    setTimeout(() => { paused = false }, 1500)
    const t0 = Date.now()
    let calls = 0
    const r = await pc.run(plan, { paused: () => paused, isCancelled: () => ++calls > 4 })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000)
    expect(r.cancelled).toBe(true)
    expect(fs.readFileSync(path.join(plan.folder, '003 - Emilia feat. TINI - Chico.mp3'), 'utf8')).toBe('algo distinto')
    const all = await pc.run(plan)
    expect(all.failed.map((x) => x.name)).toEqual(['003 - Emilia feat. TINI - Chico.mp3'])
    expect(all.failed[0].error).toMatch(/no se pisa/)
  })
})

describe('playlists para reproductores de PC', () => {
  it('rutas relativas a la carpeta de la lista, y completas cuando el tema está en otro disco', () => {
    const w = path.win32
    const e = [{ path: 'D:\\Música\\A\\a.mp3', duration: 200.4, label: 'A - a' }, { path: 'C:\\Otra\\b.flac', duration: null, label: 'b' }]
    const rel = m3uText(e, 'D:\\Música\\_Playlists', true, w)
    expect(rel.text).toBe('#EXTM3U\r\n#EXTINF:200,A - a\r\n..\\A\\a.mp3\r\n#EXTINF:-1,b\r\nC:\\Otra\\b.flac\r\n')
    expect(rel.absolute).toBe(1)
    expect(m3uText(e, 'E:\\x', false, w).text).toContain('D:\\Música\\A\\a.mp3')
  })

  it('un .m3u8 por playlist, con los nombres limpios y sin las carpetas de playlists', () => {
    const pl = new Playlists(lib.db, (i) => lib.trackPath(i))
    const a = pl.create('Para el auto: ida', 'list', null); pl.addTracks(a, [ids.mp3lo, ids.flac])
    const folder = pl.create('Carpeta', 'folder', null)
    const r = exportM3uLists(lib.db, pl, (i) => lib.trackPath(i), [a, folder], { dir: path.join(dir, 'PC'), relative: true })
    expect(r.files).toEqual([{ name: 'Para el auto_ ida.m3u8', tracks: 2, missing: 0 }])
    const txt = fs.readFileSync(path.join(dir, 'PC', 'Para el auto_ ida.m3u8'), 'utf8')
    expect(txt).toContain(path.join('..', 'Música', 'Sueltos', 'chico.mp3'))
  })
})

describe('listo para tu servidor', () => {
  it('reconoce el artista y el disco en las carpetas', () => {
    expect(folderHasArtist(['Biblioteca', 'Emilia'], 'Emilia feat. TINI')).toBe(true)
    expect(folderHasArtist(['Beatles'], 'The Beatles')).toBe(true)
    expect(folderHasArtist(['Sueltos'], 'Raro')).toBe(false)
    expect(folderHasAlbum('1990 - Canción Animal [FLAC]', 'Canción animal')).toBe(true)
    expect(folderHasAlbum('Clics modernos', 'Clics Modernos (Remaster 2010)')).toBe(true)
    expect(folderHasAlbum('Sueltos', 'Canción animal')).toBe(false)
  })

  it('dice qué falta y a dónde ir a arreglarlo', async () => {
    const r = await serverCheck(lib.db, { pathOf: (i) => lib.trackPath(i) })
    const by = Object.fromEntries(r.issues.map((i) => [i.id, i]))
    expect(r.albums).toBe(1)
    expect(by.artista.count).toBe(1); expect(by.artista.go).toBe('tidy') // x.wav
    expect(by.carpetas.examples).toEqual(['Sin tags/x.wav', 'Sueltos/chico.mp3', 'Sueltos/raro.ogg'])
    expect(by.album.count).toBe(3)
    expect(by.tapas).toBeUndefined() // el disco tiene la tapa embebida en el primer tema
    expect(by.pista).toBeUndefined()
    expect(r.okTracks).toBe(2)
    expect(r.okEssential).toBe(4) // solo x.wav (sin artista ni título) se vería mal
  })

  it('la pantalla arma "Ir a …" y el plural con datos (goLabel, goHow, unit), no cortando el texto: igual en inglés', async () => {
    const r = await serverCheck(lib.db, { pathOf: (i) => lib.trackPath(i) })
    const by = Object.fromEntries(r.issues.map((i) => [i.id, i]))
    expect(by.artista).toMatchObject({ label: 'Temas sin artista', unit: 'temas', goLabel: 'Arreglar nombres y tags', level: 'imprescindible' })
    expect(by.artista.goHow).toBeUndefined()
    try {
      ponerIdioma('en')
      const en = Object.fromEntries((await serverCheck(lib.db, { pathOf: (i) => lib.trackPath(i) })).issues.map((i) => [i.id, i]))
      expect(en.artista).toMatchObject({ label: 'Tracks with no artist', unit: 'temas', goLabel: 'Fix names and tags', level: 'imprescindible', count: by.artista.count })
      expect(Object.keys(en)).toEqual(Object.keys(by))
    } finally { ponerIdioma('es') }
  })
})

// Un test por cada error de la corrida supervisada del 20/10 (docs/archivo/pruebas/2026-10-20-llevar.md).
describe('casos de la corrida supervisada', () => {
  let d2: string, lib2: Library, pc2: PhoneCopier
  const id2 = (n: string) => lib2.tracks().find((r) => String(r[2]).endsWith(n))![0] as number
  const mk = (rel: string, extra: string[], meta: Record<string, string>, secs = 4) => {
    const out = path.join(d2, 'M', rel)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${secs}`, '-ac', '2', ...extra, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
    return out
  }
  beforeAll(async () => {
    d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-carry2-'))
    mk('Con tapa/chico2.mp3', ['-b:a', '128k'], { artist: 'Grouplove', title: 'Tongue Tied' })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=200x200', '-frames:v', '1', path.join(d2, 'M', 'Con tapa', 'cover.jpg')])
    mk('Vinilo/melodic.flac', [], { artist: 'Priku', title: 'Melodic', track: 'A1' })
    // MP3 cortado: el encabezado dice 8 s pero solo hay audio para la mitad (como "Te Felicito" en la Música real)
    const cut = mk('Cortado/cortado.mp3', ['-b:a', '320k'], { artist: 'Shakira', title: 'Te Felicito' }, 8)
    const buf = fs.readFileSync(cut)
    fs.writeFileSync(cut, buf.subarray(0, Math.round(buf.length * 0.5)))
    lib2 = new Library(path.join(d2, 'paila.db'), ffprobe)
    await lib2.addRoot(path.join(d2, 'M'), [{ rel: '', kind: 'musica' }])
    await lib2.scan()
    pc2 = new PhoneCopier(lib2.db, (i) => lib2.trackPath(i), ffmpeg, ffprobe, () => lib2.roots().map((r) => r.path))
  })
  afterAll(() => { lib2.close(); fs.rmSync(d2, { recursive: true, force: true }) })

  it('un tema que se copia tal cual se lleva la tapa de su carpeta, con el sonido idéntico', async () => {
    const plan = pc2.plan('Tapa', [id2('chico2.mp3')], { ...DEFAULT_PHONE, dest: path.join(d2, 'Cel') })
    expect(plan.items[0].action).toBe('copy')
    const r = await pc2.run(plan)
    expect(r.failed).toEqual([])
    const out = path.join(plan.folder, plan.items[0].outRel)
    expect(readCover(out)).not.toBeNull()
    expect(r.notes[0].note).toMatch(/tapa de su carpeta/)
    expect(readCover(lib2.trackPath(id2('chico2.mp3'))!)).toBeNull() // el original no se tocó
    const again = await pc2.run(plan) // retoma: la copia con tapa cuenta como "ya está"
    expect(again.skippedExisting).toBe(1); expect(again.failed).toEqual([])
  }, 90_000)

  it('la cara del vinilo ("A1") no borra nada ni hace fallar la conversión', async () => {
    for (const format of ['aac', 'mp3'] as const) {
      const plan = pc2.plan(`Vinilo ${format}`, [id2('melodic.flac')], { ...DEFAULT_PHONE, format, dest: path.join(d2, 'Cel') })
      const r = await pc2.run(plan)
      expect(r.failed).toEqual([])
      const out = path.join(plan.folder, plan.items[0].outRel)
      expect(readTags(out)).toMatchObject({ artist: 'Priku', title: 'Melodic' })
      if (format === 'mp3') expect((await probe(ffprobe, out)).track).toBe('A1') // en MP3 el texto viaja; el M4A solo admite números
    }
  }, 90_000)

  it('si el original ya está cortado, la copia sale igual (dura lo que se escucha) y lo avisa', async () => {
    const plan = pc2.plan('Cortado', [id2('cortado.mp3')], { ...DEFAULT_PHONE, dest: path.join(d2, 'Cel') })
    expect(plan.items[0].action).toBe('convert')
    const r = await pc2.run(plan)
    expect(r.failed).toEqual([])
    expect(r.converted).toBe(1)
    expect(r.notes[0].note).toMatch(/original ya está cortado/)
  }, 90_000)
})

describe('listo para tu servidor: casos de la Música real', () => {
  let d3: string, lib3: Library
  const mk = (rel: string, meta: Record<string, string>) => {
    const out = path.join(d3, 'M', rel)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=2', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
  }
  beforeAll(async () => {
    d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-server-'))
    // un vinilo con las caras como número de pista ("A1", "B1"), en su carpeta de disco
    mk('Rigzz/Tools (Vinyl Only)/Rigzz - A1 g0.mp3', { artist: 'Rigzz', album: 'Tools (Vinyl Only)', title: 'g0', track: 'A1', date: '2021' })
    mk('Rigzz/Tools (Vinyl Only)/Rigzz - B1 e156.mp3', { artist: 'Rigzz', album: 'Tools (Vinyl Only)', title: 'e156', track: 'B1', date: '2021' })
    // una carpeta-playlist con dos temas del mismo álbum, sin año ni pista (como "VARIETE")
    mk('VARIETE/The Police - Roxanne.mp3', { artist: 'The Police', album: 'Outlandos d\'Amour', title: 'Roxanne' })
    mk('VARIETE/The Police - Message In a Bottle.mp3', { artist: 'The Police', album: 'Outlandos d\'Amour', title: 'Message In a Bottle' })
    // dos temas de un disco sueltos en la carpeta del artista, con un cover.jpg que no es de ese disco ("LNG/Babasónicos")
    mk('Babasónicos/Irresponsables.mp3', { artist: 'Babasónicos', album: 'Discutible', title: 'Irresponsables', track: '1', date: '2008' })
    mk('Babasónicos/Pijamas.mp3', { artist: 'Babasónicos', album: 'Discutible', title: 'Pijamas', track: '2', date: '2008' })
    mk('Babasónicos/Putita.mp3', { artist: 'Babasónicos', title: 'Putita' })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=100x100', '-frames:v', '1', path.join(d3, 'M', 'Babasónicos', 'cover.jpg')])
    for (const [a, t] of [['Soda Stereo', 'Té para tres'], ['Virus', 'Wadu Wadu'], ['Sumo', 'Mañana en el Abasto']]) mk(`VARIETE/${a} - ${t}.mp3`, { artist: a, title: t })
    lib3 = new Library(path.join(d3, 'paila.db'), ffprobe)
    await lib3.addRoot(path.join(d3, 'M'), [{ rel: '', kind: 'musica' }])
    await lib3.scan()
  })
  afterAll(() => { lib3.close(); fs.rmSync(d3, { recursive: true, force: true }) })

  it('"A1" de un vinilo vale como pista y a una carpeta-playlist no se le piden datos de disco', async () => {
    const r = await serverCheck(lib3.db, { pathOf: (i) => lib3.trackPath(i) })
    const by = Object.fromEntries(r.issues.map((i) => [i.id, i]))
    expect(by.pista).toBeUndefined()
    expect(by.anio).toBeUndefined()
    expect(r.albums).toBe(2) // el vinilo y Discutible; los dos de The Police no son un disco
    expect(by.carpetas.count).toBe(7) // la carpeta-playlist y los dos de Discutible (sin su carpeta de disco)
    expect(by.tapas.examples).toEqual(['Babasónicos/ (Discutible)', 'Rigzz/Tools (Vinyl Only)/ (Tools (Vinyl Only))'])
  })
})
