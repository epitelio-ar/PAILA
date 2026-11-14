// Lo que encontró el repaso de criterios del 24/10 en la nota de calidad (docs/pruebas/2026-10-24-repaso-criterios.md): "Dañado"
// contaba las PALABRAS de error de todo lo que escribe ffmpeg, incluidos los tags que muestra al abrir el archivo.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeFile } from '@paila/core/analysis/analyze'
import { countDecodeErrors } from '@paila/core/analysis/decodeerrors'
import { grade } from '@paila/core/analysis/grade'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import type { RawAnalysis } from '@paila/core/analysis/analyze'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const mp3 = path.join('no-existe', 'x.mp3'), flac = path.join('no-existe', 'x.flac')

describe('repaso de criterios: errores al leer un tema', () => {
  it('la letra guardada en el tag no cuenta: "Under Pressure" ("It\'s the terror of knowing…") no está dañado', () => {
    // el FLAC de "Under Pressure (Remastered 2011)" tenía F por las cuatro veces que la letra dice "terror"
    const lyrics = ["Input #0, flac, from 'Under Pressure.flac':", '  Metadata:', "    LYRICS          : [00:54.96] It's the terror of knowing what this world is about",
      "                    : [01:45.71] It's the terror of knowing what this world is about"].join('\n')
    expect(countDecodeErrors(`${lyrics}\n${lyrics}`, flac)).toBe(0)
  })

  it('cuenta tropiezos, no palabras: "The Crunge" (3 cuadros) no llega a dañado', () => {
    // así lo dice el ffmpeg de PAILA por cada cuadro que no puede leer: antes eran 2 palabras por cuadro
    const one = '[mp3float @ 0] Header missing\n[aist#0:0/mp3 @ 0] Error submitting packet to decoder: Invalid data found when processing input'
    expect(countDecodeErrors([one, one, one].join('\n'), mp3)).toBe(3)
    expect(countDecodeErrors('[mp3float @ 0] invalid block type\n[mp3float @ 0] Error while decoding MPEG audio frame.\n[aist#0:0/mp3 @ 0] Error submitting packet to decoder: Invalid data found', mp3)).toBe(1)
  })

  it('los "overread" del MP3 (cuadros que se leen con errores) siguen contando: los discos con cientos siguen "Dañado"', () => {
    const over = '[mp3float @ 0] overread, skip -5 enddists: -4 -4'
    expect(countDecodeErrors([over, over, '    Last message repeated 2 times', over].join('\n'), mp3)).toBe(5)
  })

  it('"Last message repeated" después de un tropiezo suma; de otra línea, no', () => {
    const one = '[mp3float @ 0] Header missing\n[aist#0:0/mp3 @ 0] Error submitting packet to decoder: Invalid data found when processing input'
    expect(countDecodeErrors(`${one}\n    Last message repeated 4 times`, mp3)).toBe(5)
    expect(countDecodeErrors('[mp3float @ 0] Header missing\n    Last message repeated 9 times', mp3)).toBe(0)
  })
})

describe('repaso de criterios: los huecos, medidos (pedido del autor, 24/10)', () => {
  let dir: string
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-huecos-')) })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('un cuadro roto a los 5 s: la ficha dice "1 corte de 26 ms: 0:05" y la nota lleva la marca "gaps"', async () => {
    const file = path.join(dir, 'roto.mp3')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', file])
    const b = fs.readFileSync(file)
    // la cabecera del primer cuadro después de los 5 s (128 kbps = 16.000 bytes por segundo): se borra y ese cuadro no se puede leer
    let at = 5 * 16000
    while (!(b[at] === 0xff && (b[at + 1] & 0xe0) === 0xe0)) at++
    b.fill(0, at, at + 4)
    fs.writeFileSync(file, b)
    const raw = await analyzeFile({ ffmpeg, file, ext: 'mp3', lossless: false, sampleRate: 44100, bits: null, channels: 2, duration: 10, withDj: false, withPrints: false })
    expect(raw.gaps).toHaveLength(1)
    expect(raw.gaps![0].at).toBeGreaterThan(4.9)
    expect(raw.gaps![0].at).toBeLessThan(5.2)
    expect(raw.gaps![0].ms).toBe(26)
    const v = grade({ codec: 'mp3', ext: 'mp3', lossless: false, kbps: 128, sampleRate: 44100, bits: null, channels: 2 }, raw)
    expect(v.flags).toContain('gaps')
    expect(v.sound.join(' ')).toMatch(/1 corte de 26 ms .*: 0:05\./)
    expect(v.flags).not.toContain('damaged') // uno solo no es "Dañado"
  })

  it('un tema sano no tiene huecos y no se lee dos veces', async () => {
    const file = path.join(dir, 'sano.mp3')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', file])
    const raw = await analyzeFile({ ffmpeg, file, ext: 'mp3', lossless: false, sampleRate: 44100, bits: null, channels: 2, duration: 4, withDj: false, withPrints: false })
    expect(raw.gaps).toEqual([])
  })

  it('migración v46, en una base de la 0.5.4: vuelven a leerse los que la v44 dejó al día sin leer, no los que ya releyó', async () => {
    const lib = new Library(path.join(dir, 'v46.db'), null)
    fs.mkdirSync(path.join(dir, 'M'), { recursive: true })
    const root = (await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])).id
    const add = (rel: string, flags: string | null, qv: number) => {
      const id = Number(lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, codec) VALUES (?, ?, 1, 1, 'musica', 'mp3', 'mp3')").run(root, rel).lastInsertRowid)
      lib.db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, flags, quality_v) VALUES (?, 1, 1, 1, 'x', 'C', ?, ?)").run(id, flags, qv)
      return id
    }
    // la v44 de la 0.5.4 dejó en 5 sin leerlos a los que no decían "Dañado"; la relectura de los 109 dejó los suyos en 5 con lo nuevo
    const ids = {
      sinLeer: add('a.mp3', 'low_bitrate', 5), sinNada: add('b.mp3', null, 5),
      releidoDanado: add('c.mp3', 'damaged,low_bitrate', 5), releidoConCortes: add('d.mp3', 'low_bitrate,gaps', 5), faltaReleer: add('e.mp3', 'damaged', 4),
    }
    lib.db.prepare('PRAGMA user_version = 45').run()
    lib.close()
    const again = new Library(path.join(dir, 'v46.db'), null)
    try {
      const qv = (id: number) => (again.db.prepare('SELECT quality_v FROM analysis WHERE file_id = ?').get(id) as { quality_v: number }).quality_v
      expect(Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, qv(id)]))).toEqual({ sinLeer: 4, sinNada: 4, releidoDanado: 5, releidoConCortes: 5, faltaReleer: 4 })
    } finally { again.close() }
  })

  it('en una base de la 0.5.3, con la v44 y la v46: se relee toda la Música, con los que decían "Dañado" primero', async () => {
    const lib = await relectura(path.join(dir, 'v44'))
    lib.db.prepare('PRAGMA user_version = 42').run()
    lib.close()
    const again = new Library(path.join(dir, 'v44', 'paila.db'), null)
    try {
      expect(again.pendingQuality()).toBe(5) // todos, no solo el que decía "Dañado" (el autor, 24/10)
      const jobs: string[] = []
      await again.analyze(fake(jobs), ffmpeg, 1)
      expect(jobs[0]).toBe('3.mp3')
      expect(again.pendingQuality()).toBe(0)
    } finally { again.close() }
  })

  it('la relectura retoma sola si se corta: con Detener, o con la app cerrada de golpe', async () => {
    // Detener a los dos temas: esos quedan al día y, al abrir de nuevo, sigue con los otros tres
    const lib = await relectura(path.join(dir, 'cortada'))
    const first: string[] = []
    await lib.analyze({ ...fake(first), full: async (j) => { first.push(path.basename(j.file)); if (first.length === 2) lib.stop(); return sano() } }, ffmpeg, 1)
    expect(first).toHaveLength(2)
    expect(lib.pendingQuality()).toBe(3)
    lib.close()
    const again = new Library(path.join(dir, 'cortada', 'paila.db'), null)
    const rest: string[] = []
    await again.analyze(fake(rest), ffmpeg, 1)
    expect(rest.sort()).toEqual(['1.mp3', '2.mp3', '3.mp3', '4.mp3', '5.mp3'].filter((n) => !first.includes(n)))
    expect(again.pendingQuality()).toBe(0)
    again.close()

    // la app se cierra de golpe a mitad de camino (el tercer tema no termina nunca): lo leído y sin guardar se vuelve a leer
    const crash = await relectura(path.join(dir, 'de-golpe'))
    const seen: string[] = []
    void crash.analyze({ ...fake(seen), full: async (j) => { seen.push(path.basename(j.file)); return seen.length < 3 ? sano() : new Promise<never>(() => {}) } }, ffmpeg, 1)
    await expect.poll(() => seen.length).toBe(3)
    const after = new Library(path.join(dir, 'de-golpe', 'paila.db'), null)
    try {
      expect(after.pendingQuality()).toBe(5)
      await after.analyze(fake([]), ffmpeg, 1)
      expect(after.pendingQuality()).toBe(0)
    } finally { after.close(); crash.close() } // la que quedó colgada también, para poder borrar la carpeta
  })
})

const sano = (): RawAnalysis => ({
  cutoff: { cutoff: 16000, drop: 40, cdEdgeDrop: null, frames: 500, spectrum: [] }, hires: null, effBits: null, flicker: 1.5, lufs: -9, lra: 6, truePeak: -1,
  samplePeak: -1, clipEvents: 0, stereoCorr: 0.8, sideRatio: 0.1, decodeErrors: 0, meta: {}, mp3: null, dj: null, gaps: [], ms: 1,
  prints: { audioMd5: null, chromaprint: null, size: null, mtime: null },
})
const fake = (jobs: string[]): AnalysisRunner => ({
  full: async (j) => { jobs.push(path.basename(j.file)); return sano() }, prints: async () => ({ audioMd5: null, chromaprint: null, size: null, mtime: null }),
})

/** Una Música de cinco MP3 ya analizados con el motor de calidad 4 (el 3 decía "Dañado"), como la de quien instala la 0.5.4. */
async function relectura(at: string): Promise<Library> {
  fs.mkdirSync(path.join(at, 'M'), { recursive: true })
  for (let i = 1; i <= 5; i++) execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', path.join(at, 'M', `${i}.mp3`)])
  const lib = new Library(path.join(at, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(at, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  await lib.analyze(fake([]), ffmpeg, 1)
  lib.db.prepare("UPDATE analysis SET quality_v = 4, flags = CASE WHEN file_id = (SELECT id FROM files WHERE rel_path = '3.mp3') THEN 'damaged' ELSE NULL END").run()
  return lib
}
