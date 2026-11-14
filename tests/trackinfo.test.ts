// Lo que se muestra de un tema (packages/shared/trackinfo.ts): el espectrograma de un tema largo, armado por pedazos.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SPECTRO_LONG_SECONDS, spectroPieces } from '@paila/shared/trackinfo'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')

describe('espectrograma de un tema largo (un set de 1 h tardaba 25 a 45 s)', () => {
  it('un tema común va entero; uno largo, en 12 pedazos de 10 s de principio a fin', () => {
    expect(spectroPieces(null)).toBeNull()
    expect(spectroPieces(240)).toBeNull()
    expect(spectroPieces(SPECTRO_LONG_SECONDS - 1)).toBeNull()
    const p = spectroPieces(4194)!
    expect(p).toHaveLength(12)
    expect(p[0]).toEqual({ start: 0, seconds: 10 })
    expect(p[11].start + p[11].seconds).toBeLessThanOrEqual(4194)
    expect(p[11].start).toBeGreaterThan(4150)
    expect(p.every((x, i) => i === 0 || x.start > p[i - 1].start)).toBe(true)
  })

  it('con ffmpeg sale una imagen en pocos segundos (20 min de audio)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-espectro-'))
    try {
      const f = path.join(dir, 'set.flac'), out = path.join(dir, 'e.png')
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1200', '-ac', '2', f])
      const pieces = spectroPieces(1200)!
      const t0 = Date.now()
      execFileSync(ffmpeg, ['-v', 'error', '-y', ...pieces.flatMap((p) => ['-ss', String(p.start), '-t', String(p.seconds), '-i', f]),
        '-filter_complex', `${pieces.map((_, i) => `[${i}:a:0]`).join('')}concat=n=${pieces.length}:v=0:a=1,showspectrumpic=s=800x300:legend=0`, '-frames:v', '1', out])
      expect(fs.statSync(out).size).toBeGreaterThan(1000)
      expect(Date.now() - t0).toBeLessThan(20_000)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
