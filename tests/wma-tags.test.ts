// Tags en WMA (core/asftags.ts; MP4 4B.7): re-empaquetando con ffmpeg sin recodificar, con el mismo tamaño de paquete, las claves
// que lee la librería ("WM/Year", "ReplayGain/Track") y sin el tag del programa; el audio decodificado queda idéntico. Lo que no
// se puede: un WMA con la tapa adentro (se diría de entrada) y los datos que no son texto ni volumen.
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { File, Picture, ByteVector } from 'node-taglib-sharp'
import { asfPacketSize, writeAsfTags } from '@paila/core/asftags'
import { cantWrite, readReplayGain, readTags } from '@paila/core/tagio'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string
const md5 = (f: string) => execFileSync(ffmpeg, ['-v', 'error', '-i', f, '-map', '0:a', '-f', 'md5', '-']).toString().trim()
const probe = (f: string) => spawnSync(ffmpeg, ['-hide_banner', '-i', f]).stderr.toString() // lo que dice ffmpeg del archivo (sin salida: solo la entrada)
const wma = (name: string) => {
  const f = path.join(dir, name)
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'wmav2', '-b:a', '128k', '-packet_size', '5976', '-metadata', 'title=Dia de sol', '-metadata', 'WM/Track=3', '-metadata', 'track=4', '-metadata', 'date=2001', f])
  return f
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-wma-')) })
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('tags en WMA, re-empaquetando con ffmpeg', () => {
  it('escribe los textos y el volumen; el audio queda idéntico y el paquete del mismo tamaño', async () => {
    const f = wma('a.wma'), sound = md5(f)
    expect(asfPacketSize(f)).toBe(5976)
    await writeAsfTags(ffmpeg, f, { title: 'Día de sol', year: '1996', track: '5', album: 'Pesados Vestigios', replaygain: JSON.stringify({ tg: -7.5, tp: 0.987654, ag: null, ap: null }) })
    expect(md5(f)).toBe(sound)
    expect(asfPacketSize(f)).toBe(5976)
    expect(readTags(f)).toMatchObject({ title: 'Día de sol', year: '1996', track: '5', album: 'Pesados Vestigios' })
    expect(readReplayGain(f)).toBe(JSON.stringify({ tg: -7.5, tp: 0.987654, ag: null, ap: null }))
    const head = probe(f)
    expect(head).toMatch(/WM\/Track\s*: 4/) // el viejo "WM/Track" (empieza en 0) acompaña al número nuevo
    expect(head).not.toMatch(/encoder\s*:\s*Lavf/) // sin el tag del programa
    expect(head).not.toMatch(/\bdate\s*:/) // el "date" suelto se saca: el año va en WM/Year
  })

  it('lo que no es texto ni volumen no se escribe, y un WMA con la tapa adentro se dice de entrada', async () => {
    const f = wma('b.wma')
    await expect(writeAsfTags(ffmpeg, f, { bpm: '120' })).rejects.toThrow(/solo se escriben los datos de texto/)
    expect(cantWrite({ ext: 'wma' }, f)).toBeNull()
    // una tapa adentro (WM/Picture): ffmpeg la reescribiría como un "video" dentro del archivo
    const t = File.createFromPath(f)
    const pic = Picture.fromData(ByteVector.fromByteArray(execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', '-f', 'mjpeg', '-'])))
    pic.mimeType = 'image/jpeg'; t.tag.pictures = [pic]; t.save(); t.dispose()
    expect(cantWrite({ ext: 'wma' }, f)).toMatch(/trae la tapa adentro/)
    await expect(writeAsfTags(ffmpeg, f, { title: 'X' })).rejects.toThrow(/trae la tapa adentro/)
  })
})
