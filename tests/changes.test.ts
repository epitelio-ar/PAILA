// Tests de Cambios pendientes de tags (core/changes.ts): aplicar, tapas, avance, cancelación y verificación por huella.
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'
import { readTags } from '@paila/core/tagio'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
const execFileAsync = promisify(execFile)

let dir: string
let lib: Library
let ch: Changes
const id = (name: string) => lib.tracks().find((r) => String(r[2]).endsWith(name))![0] as number
const row = (name: string) => lib.tracks().find((r) => String(r[2]).endsWith(name))!

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-changes-'))
  fs.mkdirSync(path.join(dir, 'M'))
  // los tres a la vez (con la PC cargada, todo este armado pasaba del minuto)
  await Promise.all(['a.mp3', 'b.flac', 'c.wma'].map((f) => {
    const codec = f.endsWith('wma') ? ['-c:a', 'wmav2'] : []
    return execFileAsync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...codec, path.join(dir, 'M', f)])
  }))
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg)
})

afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('cambios pendientes de tags', () => {
  it('"Vaciar campo": deja el tag vacío en MP3 y FLAC, y deshacer lo vuelve', async () => {
    const ids = [id('a.mp3'), id('b.flac')]
    ch.stage(ids, 'album', 'El Bordo')
    expect((await ch.apply()).failed).toEqual([])
    ch.stage(ids, 'album', null)
    expect(ch.list().map((c) => [c.before, c.after])).toEqual([['El Bordo', null], ['El Bordo', null]])
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    for (const i of ids) { expect(readTags(lib.trackPath(i)!).album).toBeNull(); expect(lib.tracks().find((x) => x[0] === i)).toBeTruthy() }
    expect((await ch.undo(r.batchId!)).failed).toEqual([])
    for (const i of ids) expect(readTags(lib.trackPath(i)!).album).toBe('El Bordo')
    ch.stage(ids, 'album', null); await ch.apply() // como estaba
  })

  it('no toca el archivo hasta aplicar, y deshacer vuelve atrás', async () => {
    const a = id('a.mp3')
    const file = lib.trackPath(a)!
    ch.stage([a], 'title', 'Título ñandú')
    ch.stage([a], 'artist', 'Artista Ü')
    expect(ch.list().map((c) => [c.field, c.after])).toEqual([['title', 'Título ñandú'], ['artist', 'Artista Ü']])
    expect(readTags(file).title).toBeNull()

    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(r.applied).toBe(2)
    expect(readTags(file)).toMatchObject({ title: 'Título ñandú', artist: 'Artista Ü' })
    expect(row('a.mp3')[13]).toBe('Título ñandú')
    expect(ch.list()).toEqual([])
    expect(lib.pendingAnalysis()).toBeGreaterThanOrEqual(0)

    const u = await ch.undo(r.batchId!)
    expect(u.failed).toEqual([])
    expect(readTags(file).title).toBeNull()
    expect(row('a.mp3')[13]).toBeNull()
    expect(ch.batches()[0].undone).toBe(true)
  })

  it('edición múltiple y valor igual al actual no genera cambio', async () => {
    const ids = [id('a.mp3'), id('b.flac')]
    ch.stage(ids, 'album', 'Disco')
    expect(ch.list()).toHaveLength(2)
    ch.discard()
    ch.stage(ids, 'album', '')
    expect(ch.list()).toHaveLength(0)
  })

  it('stageMany arma varios cambios de distintos temas', () => {
    ch.stageMany([{ id: id('a.mp3'), field: 'title', value: 'Uno' }, { id: id('b.flac'), field: 'title', value: 'Dos' }, { id: id('b.flac'), field: 'year', value: '2001' }])
    expect(ch.list()).toHaveLength(3)
    ch.discard()
  })

  it('renombra el archivo junto con los tags, no pisa otro y se puede deshacer', async () => {
    const a = id('a.mp3')
    const before = lib.trackPath(a)!
    ch.stage([a], 'filename', 'Nuevo: nombre?')
    ch.stage([a], 'title', 'T')
    expect(ch.list().find((c) => c.field === 'filename')!.after).toBe('Nuevo_ nombre_')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    const after = lib.trackPath(a)!
    expect(path.basename(after)).toBe('Nuevo_ nombre_.mp3')
    expect(fs.existsSync(before)).toBe(false)
    expect(readTags(after).title).toBe('T')
    await ch.undo(r.batchId!)
    expect(fs.existsSync(before)).toBe(true)
    expect(lib.trackPath(a)).toBe(before)
    expect(readTags(before).title).toBeNull()

    // choque de nombres: no pisa
    ch.stage([a], 'filename', 'b')
    const bRel = path.join(path.dirname(before), 'b.mp3')
    fs.copyFileSync(before, bRel)
    const r2 = await ch.apply()
    expect(r2.failed[0].error).toMatch(/Ya existe/)
    expect(fs.existsSync(before)).toBe(true)
    fs.rmSync(bRel)
    ch.discard()
  })

  it('no renombra sample packs', () => {
    const row = lib.db.prepare("SELECT id FROM files LIMIT 1").get() as { id: number }
    lib.db.prepare("UPDATE files SET kind = 'produccion' WHERE id = ?").run(row.id)
    expect(() => ch.stage([row.id], 'filename', 'x')).toThrow(/sample packs/)
    lib.db.prepare("UPDATE files SET kind = 'musica' WHERE id = ?").run(row.id)
  })

  it('en un WMA escribe los textos re-empaquetando con ffmpeg (el audio igual) y deshacer lo deja byte a byte (MP4 4B.7)', async () => {
    const w = id('c.wma'), file = lib.trackPath(w)!, before = fs.readFileSync(file)
    ch.stage([w, id('b.flac')], 'genre', 'House')
    ch.stage([w], 'title', 'Día de sol'); ch.stage([w], 'year', '1996')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(readTags(file)).toMatchObject({ genre: 'House', title: 'Día de sol', year: '1996' })
    execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-']) // sigue decodificando entero
    expect((await ch.undo(r.batchId!)).failed).toEqual([])
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    expect(readTags(lib.trackPath(id('b.flac'))!).genre).toBeNull()
  })
})

describe('tapas', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  it('pone, ve y quita una tapa, y deshace', async () => {
    const { coverFromBytes, readCover } = await import('@paila/core/tagio')
    for (const name of ['a.mp3', 'b.flac']) {
      const i = id(name)
      const file = lib.trackPath(i)!
      expect(readCover(file)).toBeNull()
      ch.stage([i], 'cover', coverFromBytes(PNG))
      expect(ch.list().find((c) => c.field === 'cover')).toMatchObject({ before: 'sin tapa', after: 'tapa nueva' })
      const r = await ch.apply()
      expect(r.failed).toEqual([])
      expect(JSON.parse(readCover(file)!).mime).toBe('image/png')
      ch.stage([i], 'cover', null)
      const r2 = await ch.apply()
      expect(readCover(file)).toBeNull()
      await ch.undo(r2.batchId!)
      expect(readCover(file)).not.toBeNull()
      await ch.undo(r.batchId!)
      expect(readCover(file)).toBeNull()
    }
  }, 90_000) // cada guardado verifica la huella del sonido: con la suite entera en paralelo puede pasar los 5 s
  it('rechaza imágenes que no son jpg o png', async () => {
    const { coverFromBytes } = await import('@paila/core/tagio')
    expect(() => coverFromBytes(Buffer.from('hola'))).toThrow(/JPG o PNG/)
  })
})

describe('avance y cancelación al aplicar', () => {
  it('informa archivo por archivo y se puede cancelar sin perder lo ya aplicado', async () => {
    const ids = [id('a.mp3'), id('b.flac')]
    ch.stage(ids, 'genre', 'Avance')
    const seen: { done: number; total: number; current: string }[] = []
    let calls = 0
    const r = await ch.apply(undefined, { onProgress: (p) => seen.push(p), isCancelled: () => ++calls > 1 })
    expect(r.applied).toBe(1) // se aplicó el primero y se canceló antes del segundo
    expect(seen[0]).toMatchObject({ done: 0, total: 2 })
    expect(seen.some((p) => p.current !== '')).toBe(true)
    expect(ch.list()).toHaveLength(1) // el otro sigue pendiente
    ch.discard()
  })
})

describe('verificación por huella del sonido', () => {
  const mk = (name: string, args: string[]) => {
    const out = path.join(dir, 'M', name)
    execFileSync(ffmpeg, ['-v', 'error', '-y', ...args, out])
    return out
  }

  it('la huella no cambia con los tags y sí con el audio, aunque la diferencia sea mínima (24 bits)', async () => {
    const { pcmHash } = await import('@paila/core/audiohash')
    const src = ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=1']
    const x = mk('h1.flac', [...src, '-sample_fmt', 's32', '-bits_per_raw_sample', '24'])
    const y = mk('h2.flac', [...src, '-af', 'volume=0.999', '-sample_fmt', 's32', '-bits_per_raw_sample', '24'])
    const h = await pcmHash(ffmpeg, x)
    expect(await pcmHash(ffmpeg, y)).not.toBe(h)
    const tagged = mk('h3.flac', ['-i', x, '-c', 'copy', '-metadata', 'title=Otro'])
    expect(await pcmHash(ffmpeg, tagged)).toBe(h)
    await expect(pcmHash(ffmpeg, path.join(dir, 'no-existe.flac'))).rejects.toThrow()
  })

  it('guarda tags en un MP3 que ya traía errores de lectura, porque el sonido queda idéntico', async () => {
    // Como los MP3 reales con "invalid new backstep": ffmpeg se queja, pero eso ya venía así y PAILA no lo empeora.
    const file = mk('danado.mp3', ['-f', 'lavfi', '-i', 'anoisesrc=d=4:c=pink:a=0.3:seed=7', '-ac', '2', '-b:a', '128k'])
    const b = fs.readFileSync(file)
    for (let i = 0; i < 300; i++) b[Math.floor(b.length / 2) + i] = (i * 37 + 11) & 255
    fs.writeFileSync(file, b)
    await lib.scan()
    const { pcmHash } = await import('@paila/core/audiohash')
    const before = await pcmHash(ffmpeg, file)
    ch.stage([id('danado.mp3')], 'title', 'Ya venía con errores')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(readTags(file).title).toBe('Ya venía con errores')
    expect(await pcmHash(ffmpeg, file)).toBe(before)
  })

  it('no agrega un ID3v1 al final de un MP3 cortado (cambiaría los últimos milisegundos del audio)', async () => {
    const file = mk('cortado.mp3', ['-f', 'lavfi', '-i', 'anoisesrc=d=3:c=pink:a=0.3:seed=7', '-ac', '2', '-b:a', '192k'])
    fs.writeFileSync(file, fs.readFileSync(file).subarray(0, fs.statSync(file).size - 200)) // el último cuadro queda a medias
    await lib.scan()
    const { pcmHash } = await import('@paila/core/audiohash')
    const before = await pcmHash(ffmpeg, file)
    ch.stage([id('cortado.mp3')], 'artist', 'Callejeros')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    const b = fs.readFileSync(file)
    expect(b.subarray(b.length - 128, b.length - 125).toString('latin1')).not.toBe('TAG')
    expect(await pcmHash(ffmpeg, file)).toBe(before)
  })

  it('guarda en un MP3 cortado que ya traía ID3v1 dejando ese tag igual (el decodificador lo lee como sonido)', async () => {
    // Ruido con semilla fija: con ruido al azar, 1 de cada ~30 veces los bytes que cambian en el ID3v1 caían donde el
    // decodificador no los usa, el sonido no cambiaba y PAILA (con razón) actualizaba el tag viejo: el test fallaba solo.
    const file = mk('cortado-v1.mp3', ['-f', 'lavfi', '-i', 'anoisesrc=d=3:c=pink:a=0.3:seed=7', '-ac', '2', '-b:a', '192k', '-id3v2_version', '3'])
    const v1 = Buffer.alloc(128); v1.write('TAG', 0, 'latin1'); v1.write('Fantasia Y Realidad', 3, 'latin1'); v1.write('Callejeros', 33, 'latin1'); v1[127] = 17
    // como "5 - fantasia y realidad.mp3": del último cuadro quedan el encabezado y 2 bytes, y enseguida el ID3v1
    const b = fs.readFileSync(file)
    let last = b.length - 2; while (!(b[last] === 0xff && (b[last + 1] & 0xe0) === 0xe0)) last--
    fs.writeFileSync(file, Buffer.concat([b.subarray(0, last + 6), v1]))
    const { pcmHash } = await import('@paila/core/audiohash')
    const { writeTags } = await import('@paila/core/tagio')
    const probe = path.join(dir, 'probe-v1.mp3'); fs.copyFileSync(file, probe)
    const before = await pcmHash(ffmpeg, file)
    writeTags(probe, { title: 'Fantasía y realidad' })
    expect(await pcmHash(ffmpeg, probe)).not.toBe(before) // sin el arreglo, este mismo cambio cambia el sonido
    fs.rmSync(probe)
    await lib.scan()
    ch.stage([id('cortado-v1.mp3')], 'title', 'Fantasía y realidad')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(readTags(file).title).toBe('Fantasía y realidad')
    expect(fs.readFileSync(file).subarray(-128)).toEqual(v1)
    expect(await pcmHash(ffmpeg, file)).toBe(before)
    const u = await ch.undo(r.batchId!)
    expect(u.failed).toEqual([])
    expect(await pcmHash(ffmpeg, file)).toBe(before)
  })

  it('arregla los MP3 con ceros sueltos entre el tag y el audio ("MPEG audio header not found") sin tocar el sonido', async () => {
    const file = mk('relleno.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=500:duration=2', '-metadata', 'comment=de Serato', '-id3v2_version', '3', '-write_xing', '0'])
    const b = fs.readFileSync(file)
    const end = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9])
    fs.writeFileSync(file, Buffer.concat([b.subarray(0, end), Buffer.alloc(1044), b.subarray(end)])) // como los dos MP3 reales
    expect(() => readTags(file)).toThrow(/MPEG audio header not found/)
    await lib.scan()
    const { pcmHash } = await import('@paila/core/audiohash')
    const before = await pcmHash(ffmpeg, file)
    const size = fs.statSync(file).size
    ch.stage([id('relleno.mp3')], 'title', 'Carolina')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(readTags(file).title).toBe('Carolina')
    expect(await pcmHash(ffmpeg, file)).toBe(before)
    expect(Math.abs(fs.statSync(file).size - size)).toBeLessThan(2048) // no se rearmó el archivo
  })

  it('arregla los MP3 que empiezan con ceros sueltos y no tienen tag ("MPEG audio header not found") sin tocar el sonido', async () => {
    const file = mk('ceros-adelante.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=600:duration=2', '-id3v2_version', '0', '-write_xing', '0'])
    const b = fs.readFileSync(file)
    expect(b[0]).toBe(0xff) // sin tag ID3: empieza directo con el audio
    fs.writeFileSync(file, Buffer.concat([Buffer.alloc(1044), b])) // como "como si estuviera.mp3"
    expect(() => readTags(file)).toThrow(/MPEG audio header not found/)
    await lib.scan()
    const { pcmHash } = await import('@paila/core/audiohash')
    const before = await pcmHash(ffmpeg, file)
    const size = fs.statSync(file).size
    ch.stage([id('ceros-adelante.mp3')], 'title', 'Como si estuviera')
    const r = await ch.apply()
    expect(r.failed).toEqual([])
    expect(readTags(file).title).toBe('Como si estuviera')
    expect(await pcmHash(ffmpeg, file)).toBe(before)
    expect(fs.readFileSync(file).subarray(-b.length).equals(b)).toBe(true) // el audio quedó tal cual, byte a byte
    expect(Math.abs(fs.statSync(file).size - size)).toBeLessThan(2048) // no se rearmó el archivo
  })

  it('no toca un archivo cuyo audio no se puede leer', async () => {
    const file = mk('roto.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'])
    await lib.scan()
    const original = Buffer.concat([fs.readFileSync(file).subarray(0, 64), Buffer.alloc(4000, 7)])
    fs.writeFileSync(file, original)
    ch.stage([id('roto.mp3')], 'title', 'No debería quedar')
    const r = await ch.apply()
    expect(r.failed).toHaveLength(1)
    expect(fs.readFileSync(file).equals(original)).toBe(true)
    ch.discard()
  })
})
