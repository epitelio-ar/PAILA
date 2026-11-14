// Recortar el principio y el final de un archivo sin perder nada (core/trimfile.ts, core/trimmp3.ts): MP3 por cuadros sin
// recodificar, FLAC y WAV bit a bit; los tags (y todo lo que el archivo tenga además del audio) quedan intactos.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { trimToFile } from '@paila/core/trimfile'
import { mp3Layout } from '@paila/core/trimmp3'
import { readMp3Start } from '@paila/core/analysis/mp3info'
import { readCover, readTags } from '@paila/core/tagio'
import { findFfprobe, probe } from '@paila/core/probe'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
let dir: string
const cover = () => { const f = path.join(dir, 'tapa.png'); if (!fs.existsSync(f)) execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', f]); return f }
/** 3 s de silencio, 10 s de tono y 8 s de silencio, con tags (y tapa donde se puede). */
function make(name: string, args: string[], withCover = true): string {
  const out = path.join(dir, name)
  const audio = ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=10', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo:d=8']
  const graph = '[1:a]aformat=channel_layouts=stereo[t];[0:a][t][2:a]concat=n=3:v=0:a=1[a]'
  const pic = withCover ? ['-i', cover(), '-map', '3:v', '-c:v', 'copy', '-disposition:v', 'attached_pic'] : []
  execFileSync(ffmpeg, ['-v', 'error', '-y', ...audio, ...(withCover ? ['-i', cover()] : []), '-filter_complex', graph, '-map', '[a]', ...pic.slice(2),
    '-metadata', 'artist=Fulana', '-metadata', 'title=Con silencios', '-metadata', 'album=Prueba', ...args, out])
  return out
}
const dur = async (f: string) => (await probe(ffprobe, f)).duration!

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-recortar-')) })
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('recortar un archivo', () => {
  it('MP3: corta por cuadros sin recodificar, los bytes de los tags quedan idénticos y la cabecera LAME se corrige', async () => {
    const src = make('a.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '3'])
    const out = path.join(dir, 'a-recortado.mp3')
    const r = await trimToFile(ffmpeg, src, 'mp3', 2.7, 14, out)
    expect(r.keptFrom).toBeGreaterThan(2.55); expect(r.keptFrom).toBeLessThanOrEqual(2.7)
    expect(r.keptTo).toBeGreaterThanOrEqual(14); expect(r.keptTo).toBeLessThan(14.15)
    const a = fs.readFileSync(src), b = fs.readFileSync(out)
    const tagLen = mp3Layout(a).start
    expect(tagLen).toBeGreaterThan(100)
    expect(b.subarray(0, tagLen).equals(a.subarray(0, tagLen))).toBe(true) // el ID3 entero, byte a byte
    expect(readTags(out)).toMatchObject({ artist: 'Fulana', title: 'Con silencios', album: 'Prueba' })
    expect(readCover(out)).toBe(readCover(src))
    expect(await dur(out)).toBeCloseTo(r.keptTo - r.keptFrom, 1)
    // la cabecera LAME sigue siendo válida (Traktor y Rekordbox la usan) y ya no hay retardo que saltear
    const s = readMp3Start(out)
    expect(s.xing && s.lame).toBe(true)
    expect(s.encoderDelay).toBe(0)
  })

  it('MP3 con la suma de control de LAME bien: sigue bien después de cortar (error de la corrida del 23/10, "Lo Que Paso, Paso")', async () => {
    const src = make('lame.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k'], false)
    // ffmpeg firma "Lavc": se le pone una suma de control válida, como la de un MP3 hecho con LAME
    const b = fs.readFileSync(src), L = mp3Layout(b), f = L.info!.at
    const x = b.indexOf('Info', f) >= 0 && b.indexOf('Info', f) < f + 40 ? b.indexOf('Info', f) : b.indexOf('Xing', f)
    const flags = b.readUInt32BE(x + 4)
    const lame = x + 8 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0)
    const crc = (buf: Buffer, from: number, to: number) => { let c = 0; for (let i = from; i < to; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1 } return c }
    b.writeUInt16BE(crc(b, f, lame + 34), lame + 34)
    fs.writeFileSync(src, b)
    const out = path.join(dir, 'lame-recortado.mp3')
    await trimToFile(ffmpeg, src, 'mp3', 2.7, 14, out)
    const o = fs.readFileSync(out), g = mp3Layout(o).info!.at, d = lame - f
    expect(o.readUInt16BE(g + d + 34)).toBe(crc(o, g, g + d + 34))
  })

  it('MP3 sin cabecera Xing y con ID3v1 al final: el ID3v1 queda igual', async () => {
    const src = make('b.mp3', ['-c:a', 'libmp3lame', '-b:a', '128k', '-write_xing', '0', '-write_id3v1', '1'], false)
    const out = path.join(dir, 'b-recortado.mp3')
    await trimToFile(ffmpeg, src, 'mp3', 2.7, 14, out)
    const a = fs.readFileSync(src), b = fs.readFileSync(out)
    expect(b.subarray(-128).equals(a.subarray(-128))).toBe(true)
    expect(b.subarray(-128, -125).toString()).toBe('TAG')
    expect(await dur(out)).toBeGreaterThan(11); expect(await dur(out)).toBeLessThan(11.6)
  })

  it('FLAC de 24 bits: sin pérdida, con los tags y la tapa iguales', async () => {
    const src = make('c.flac', ['-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24'])
    const out = path.join(dir, 'c-recortado.flac')
    const r = await trimToFile(ffmpeg, src, 'flac', 2.7, 14, out)
    expect(r).toEqual({ keptFrom: 2.7, keptTo: 14 })
    expect(readTags(out)).toMatchObject({ artist: 'Fulana', title: 'Con silencios', album: 'Prueba' })
    expect(readCover(out)).toBe(readCover(src))
    expect((await probe(ffprobe, out)).bits).toBe(24)
    expect(await dur(out)).toBeCloseTo(11.3, 2)
  })

  it('FLAC, solo el principio (hasta el final, sin un punto de corte al final)', async () => {
    const src = make('c2.flac', ['-c:a', 'flac'], false)
    const out = path.join(dir, 'c2-recortado.flac')
    const r = await trimToFile(ffmpeg, src, 'flac', 2.7, Infinity, out)
    expect(r.keptFrom).toBe(2.7)
    expect(r.keptTo).toBeCloseTo(21, 2)
    expect(await dur(out)).toBeCloseTo(18.3, 2)
  })

  it('WAV y MP3 hasta el final, igual', async () => {
    for (const [name, args] of [['h.wav', ['-c:a', 'pcm_s16le']], ['h.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']]] as const) {
      const src = make(name, [...args], false), out = path.join(dir, `recortado-${name}`)
      const r = await trimToFile(ffmpeg, src, name.split('.')[1], 2.7, Infinity, out)
      expect(r.keptTo).toBeGreaterThan(20.9)
      expect(await dur(out)).toBeGreaterThan(18.2)
    }
  })

  it('WAV: corta solo las muestras; los demás bloques (los tags) quedan byte a byte', async () => {
    const src = make('d.wav', ['-c:a', 'pcm_s16le'], false)
    const out = path.join(dir, 'd-recortado.wav')
    const r = await trimToFile(ffmpeg, src, 'wav', 2.7, 14, out)
    expect(r).toEqual({ keptFrom: 2.7, keptTo: 14 })
    expect(readTags(src).title).toBe('Con silencios')
    expect(readTags(out)).toEqual(readTags(src))
    expect(await dur(out)).toBeCloseTo(11.3, 2)
    // todo lo que no es el audio (el bloque LIST con los tags) queda igual
    const a = fs.readFileSync(src), b = fs.readFileSync(out)
    const list = a.indexOf('LIST')
    expect(list).toBeGreaterThan(0)
    const size = a.readUInt32LE(list + 4)
    expect(b.indexOf(a.subarray(list, list + 8 + size))).toBeGreaterThan(0)
  })

  it('AIFF de 24 bits con tags (ID3): corta solo las muestras, el ID3 queda byte a byte', async () => {
    const src = make('i.aiff', ['-c:a', 'pcm_s24be', '-write_id3v2', '1'], false)
    const out = path.join(dir, 'i-recortado.aiff')
    const r = await trimToFile(ffmpeg, src, 'aiff', 2.7, 14, out)
    expect(r).toEqual({ keptFrom: 2.7, keptTo: 14 })
    expect(readTags(src).title).toBe('Con silencios')
    expect(readTags(out)).toEqual(readTags(src))
    expect((await probe(ffprobe, out)).bits).toBe(24)
    expect(await dur(out)).toBeCloseTo(11.3, 2)
    const a = fs.readFileSync(src), b = fs.readFileSync(out), at = a.indexOf('ID3 ')
    expect(at).toBeGreaterThan(0)
    expect(b.indexOf(a.subarray(at, at + 8 + a.readUInt32BE(at + 4)))).toBeGreaterThan(0)
  })

  it('MP3, solo el final: el principio queda byte a byte (el retardo de LAME no cambia: las marcas de un DJ siguen en su lugar)', async () => {
    const src = make('e.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k'], false)
    const out = path.join(dir, 'e-recortado.mp3')
    const r = await trimToFile(ffmpeg, src, 'mp3', 0, 14, out)
    expect(r.keptFrom).toBe(0)
    const a = fs.readFileSync(src), b = fs.readFileSync(out)
    const L = mp3Layout(a), info = L.info!
    expect(b.subarray(0, L.start).equals(a.subarray(0, L.start))).toBe(true)
    expect(b.subarray(info.at + info.len, info.at + info.len + 50_000).equals(a.subarray(info.at + info.len, info.at + info.len + 50_000))).toBe(true)
    expect(readMp3Start(out).encoderDelay).toBe(readMp3Start(src).encoderDelay)
  })

  it('MP3 con basura entre el ID3 y el audio (que no es un tag): se corta igual y el ID3 queda; si adentro hay otro tag, no (muestra del 23/10, "Simple")', async () => {
    const src = make('j.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k', '-write_xing', '0'], false)
    const a = fs.readFileSync(src), L = mp3Layout(a)
    const basura = Buffer.concat([Buffer.alloc(200), Buffer.alloc(208, 0xff)])
    const con = path.join(dir, 'j-basura.mp3'), otro = path.join(dir, 'j-otro-tag.mp3')
    fs.writeFileSync(con, Buffer.concat([a.subarray(0, L.start), basura, a.subarray(L.start)]))
    fs.writeFileSync(otro, Buffer.concat([a.subarray(0, L.start), Buffer.from('ID3'), basura, a.subarray(L.start)]))
    const out = path.join(dir, 'j-recortado.mp3')
    await trimToFile(ffmpeg, con, 'mp3', 2.7, 14, out)
    expect(fs.readFileSync(out).subarray(0, L.start).equals(a.subarray(0, L.start))).toBe(true)
    await expect(trimToFile(ffmpeg, otro, 'mp3', 2.7, 14, path.join(dir, 'j-no.mp3'))).rejects.toThrow(/algo entre los tags y el audio/)
  })

  it('si no hay nada que cortar, el MP3 queda idéntico', async () => {
    const src = make('f.mp3', ['-c:a', 'libmp3lame', '-b:a', '160k'], false)
    const out = path.join(dir, 'f-igual.mp3')
    await trimToFile(ffmpeg, src, 'mp3', 0, 999, out)
    expect(fs.readFileSync(out).equals(fs.readFileSync(src))).toBe(true)
  })

  it('un formato que no se recorta avisa en castellano y no deja nada', async () => {
    const src = make('g.m4a', ['-c:a', 'aac', '-b:a', '128k'], false)
    const out = path.join(dir, 'g-recortado.m4a')
    await expect(trimToFile(ffmpeg, src, 'm4a', 2.7, 14, out)).rejects.toThrow(/solo MP3, FLAC, WAV y AIFF/)
    expect(fs.existsSync(out)).toBe(false)
  })
})
