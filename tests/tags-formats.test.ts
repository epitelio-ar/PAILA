// Prueba previa a la Fase 2: node-taglib-sharp escribe y relee tags en todos los formatos, sobre archivos sintéticos (nunca la biblioteca real).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { File } from 'node-taglib-sharp'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpeg: string = require('ffmpeg-static')

const FORMATS: [string, string[]][] = [
  ['mp3', ['-c:a', 'libmp3lame', '-b:a', '128k']],
  ['flac', ['-c:a', 'flac']],
  ['m4a', ['-c:a', 'aac', '-b:a', '128k']],
  ['ogg', ['-c:a', 'libvorbis']],
  ['opus', ['-c:a', 'libopus']],
  // WMA: taglib deja ilegible (para ffmpeg) un .wma hecho por ffmpeg tras guardar un tag. No se escribe sin
  // verificar: en la Fase 2 todo guardado se relee con ffmpeg y, si falla, se restaura el archivo original.
  ['wav', ['-c:a', 'pcm_s16le']],
  ['aiff', ['-c:a', 'pcm_s16be']],
]
let dir: string
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-tags-')) })
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('escribir tags con node-taglib-sharp', () => {
  for (const [ext, codec] of FORMATS) {
    it(`.${ext}: escribe, relee y el audio sigue válido`, () => {
      const f = path.join(dir, `t.${ext}`)
      execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...codec, '-y', f])
      const f0 = File.createFromPath(f)
      f0.tag.title = 'Título ñandú'; f0.tag.performers = ['Artista Ü']; f0.tag.album = 'Álbum'
      f0.tag.genres = ['House']; f0.tag.year = 2024; f0.tag.track = 3
      f0.save(); f0.dispose()
      const f1 = File.createFromPath(f)
      expect([f1.tag.title, f1.tag.firstPerformer, f1.tag.album, f1.tag.year]).toEqual(['Título ñandú', 'Artista Ü', 'Álbum', 2024])
      f1.dispose()
      // el audio sigue decodificando completo
      execFileSync(ffmpeg, ['-v', 'error', '-i', f, '-f', 'null', '-'])
    })
  }
})
