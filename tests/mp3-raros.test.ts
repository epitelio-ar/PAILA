// MP3 que la librería de tags no abría (punto 1 real del 24/10; core/mp3fix.ts): el tag que dice terminar antes que su último cuadro
// ("Escapate Conmigo" de Wisin y Ozuna, con la tapa que sigue después) y restos de un cuadro roto antes del audio ("La bomba loca").
// Se arreglan agrandando el tamaño declarado del tag; el sonido no cambia. Volumen parejo lo sabe de entrada (sobre una copia) y el
// motor los escribe y los deshace byte a byte.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { absorbJunkBeforeAudio, readRepaired } from '@paila/core/mp3fix'
import { readCover, readReplayGain, readTags } from '@paila/core/tagio'
import { pcmHash } from '@paila/core/audiohash'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { Changes } from '@paila/core/changes'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, audio: Buffer
const frame = (id: string, body: Buffer) => { const h = Buffer.alloc(10); h.write(id, 0, 'latin1'); h.writeUInt32BE(body.length, 4); return Buffer.concat([h, body]) }
const text = (s: string) => Buffer.concat([Buffer.from([0]), Buffer.from(s, 'latin1')])
/** Un ID3v2.3 con estos cuadros, que dice medir `declared` (de más o de menos). */
const id3 = (frames: Buffer, declared = frames.length) => {
  const h = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0])
  h[6] = (declared >> 21) & 0x7f; h[7] = (declared >> 14) & 0x7f; h[8] = (declared >> 7) & 0x7f; h[9] = declared & 0x7f
  return Buffer.concat([h, frames])
}
const put = (name: string, data: Buffer) => { const f = path.join(dir, 'M', name); fs.writeFileSync(f, data); return f }

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-mp3raros-'))
  fs.mkdirSync(path.join(dir, 'M'))
  const raw = path.join(dir, 'raw.mp3')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '0', '-write_xing', '0', raw])
  audio = fs.readFileSync(raw)
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const tapa = () => execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=600x600', '-frames:v', '1', '-q:v', '2', '-f', 'mjpeg', '-'])
const apic = (img: Buffer) => frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0', 'latin1'), Buffer.from([3, 0]), img]))

describe('MP3 que la librería de tags no abría', () => {
  it('el tag que dice terminar antes que la tapa ("Escapate Conmigo"): se agranda y se lee entero, con la tapa', async () => {
    const frames = Buffer.concat([frame('TIT2', text('Escapate Conmigo')), apic(tapa())])
    const f = put('escapate.mp3', Buffer.concat([id3(frames, frames.length - 2873), audio]))
    expect(() => readTags(f)).toThrow() // la librería no lo abre
    expect(readRepaired(f, readTags).title).toBe('Escapate Conmigo') // de entrada, sobre una copia: el archivo no cambia
    expect(() => readTags(f)).toThrow()
    const sound = await pcmHash(ffmpeg, f)
    expect(absorbJunkBeforeAudio(f)).toBe(true)
    expect(readTags(f).title).toBe('Escapate Conmigo')
    expect(readCover(f)).toBeTruthy()
    expect(await pcmHash(ffmpeg, f)).toBe(sound)
  })

  it('restos de un cuadro roto antes del audio ("La bomba loca"): pasan a ser relleno del tag', async () => {
    const junk = Buffer.concat([Buffer.from('0700000000000d20e0000000', 'hex'), Buffer.from('LAME3.82' + 'U'.repeat(1000), 'latin1')])
    const f = put('bomba.mp3', Buffer.concat([id3(frame('TIT2', text('La bomba loca'))), junk, audio]))
    const sound = await pcmHash(ffmpeg, f), tag = 10 + frame('TIT2', text('La bomba loca')).length
    expect(absorbJunkBeforeAudio(f)).toBe(true)
    const b = fs.readFileSync(f)
    expect(10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9])).toBe(tag + junk.length) // el tag llega justo hasta el audio
    expect(readTags(f).title).toBe('La bomba loca')
    expect(await pcmHash(ffmpeg, f)).toBe(sound)
    // uno sano no se toca
    const sano = put('sano.mp3', Buffer.concat([id3(frame('TIT2', text('Sano'))), audio]))
    expect(absorbJunkBeforeAudio(sano)).toBe(false)
  })

  it('con megas de basura que parece audio después del tag, se rinde enseguida y lo da como "no se puede"', () => {
    // la búsqueda del primer cuadro tiene tope (64 KB más allá del tag): no recorre el archivo entero
    const b = Buffer.alloc(16 * 1024 * 1024, 0xff)
    id3(frame('TIT2', text('Basura'))).copy(b)
    const f = put('basura.mp3', b)
    const t = Date.now()
    expect(absorbJunkBeforeAudio(f)).toBe(false)
    expect(() => readRepaired(f, readTags)).toThrow(/ni arreglando/)
    expect(Date.now() - t).toBeLessThan(2000)
  })

  it('el motor los escribe (arreglando sobre el temporal) y deshacer los deja byte a byte', async () => {
    const frames = Buffer.concat([frame('TIT2', text('Escapate Conmigo')), apic(tapa())])
    fs.mkdirSync(path.join(dir, 'M', 'motor'))
    const f = put('motor/escapate.mp3', Buffer.concat([id3(frames, frames.length - 2873), audio]))
    const before = fs.readFileSync(f)
    const lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
    try {
      await lib.addRoot(path.join(dir, 'M', 'motor'), [{ rel: '', kind: 'musica' }])
      await lib.scan()
      const ch = new Changes(lib.db, (i) => lib.trackPath(i), ffmpeg)
      const id = lib.tracks()[0][0] as number
      ch.stage([id], 'artist', 'Wisin & Ozuna')
      const r = await ch.apply()
      expect(r.failed).toEqual([])
      expect(readTags(f)).toMatchObject({ title: 'Escapate Conmigo', artist: 'Wisin & Ozuna' })
      expect((await ch.undo(r.batchId!)).failed).toEqual([])
      expect(fs.readFileSync(f).equals(before)).toBe(true)
    } finally { lib.close() }
  })
})
