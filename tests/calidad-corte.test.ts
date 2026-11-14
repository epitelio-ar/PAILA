// Tests de la Fase E (6.1): corte suave (vinilo o master viejo) contra corte de golpe (MP3), archivos de 32 kHz, escalón de
// 16 kHz y huecos en el espectrograma. Y desde el 22/10/2026, la nota que decide sola con pistas (core/analysis/clues.ts):
// un caso por criterio y por cada error de la corrida supervisada (docs/archivo/pruebas/2026-10-22-calidad-con-criterio.md).
// Archivos sintéticos hechos con ffmpeg (nunca la biblioteca real).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { analyzeFile, type RawAnalysis } from '@paila/core/analysis/analyze'
import { grade, type GradeInput } from '@paila/core/analysis/grade'
import { cluesFor, readClues, type Clues } from '@paila/core/analysis/clues'
import { inputMeta } from '@paila/core/analysis/analyze'
import { openDb } from '@paila/core/db'
import { FlickerMeter } from '@paila/core/analysis/flicker'
import { ponerIdioma } from '@paila/shared/idioma'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
let dir: string
const ff = (...args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args])
const noise = (sr: number) => ['-f', 'lavfi', '-i', `anoisesrc=d=40:c=pink:r=${sr}:a=0.3`]
const eq = (gain: string) => ['-af', `firequalizer=gain='${gain}':accuracy=20`]

async function verdict(name: string, info: Omit<GradeInput, 'ext'>) {
  const file = path.join(dir, name)
  const ext = path.extname(name).slice(1)
  const raw = await analyzeFile({ ffmpeg, file, ext, lossless: info.lossless, sampleRate: info.sampleRate, bits: info.bits, channels: 2, duration: 40, withDj: false, withPrints: false })
  return { raw, v: grade({ ...info, ext }, raw) }
}
const FLAC = (sampleRate = 44100): Omit<GradeInput, 'ext'> => ({ codec: 'flac', lossless: true, kbps: 900, sampleRate, bits: 16, channels: 2 })

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-corte-'))
  const p = (n: string) => path.join(dir, n)
  // los agudos bajan 25 dB por kHz desde 16,5 kHz, como un vinilo o una cinta (el caso de "Ojos de video tape")
  ff(...noise(44100), ...eq('if(lt(f,16500),0,max(-75,-(f-16500)/1000*25))'), '-ac', '2', '-sample_fmt', 's16', '-c:a', 'flac', p('suave.flac'))
  ff(...noise(44100), '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', p('m128.mp3'))
  ff('-i', p('m128.mp3'), '-c:a', 'flac', p('falso.flac'))
  // escalón de 25 dB en 16 kHz y el resto llega arriba de todo
  ff(...noise(44100), ...eq('if(lt(f,16000),0,-25) + if(lt(f,21500),0,-80)'), '-ac', '2', '-sample_fmt', 's16', '-c:a', 'flac', p('escalon.flac'))
  ff(...noise(32000), '-ac', '2', '-sample_fmt', 's16', '-c:a', 'flac', p('f32k.flac'))
  ff(...noise(32000), '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', p('m32k.mp3'))
}, 120_000)

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('forma del corte', () => {
  it('corte suave (vinilo o master viejo) sin rastros → B "suena como fue grabado", sin mandar a mirar nada', async () => {
    const { v, raw } = await verdict('suave.flac', FLAC())
    expect(raw.cutoff.sharp).toBeLessThanOrEqual(12)
    // si falla, que diga por qué (en Mac salió "F" una vez de tres, 23/10: el ruido cambia en cada corrida)
    expect(v.grade, JSON.stringify({ is: v.is, why: v.why, flags: v.flags, errores: raw.decodeErrors, corte: raw.cutoff })).toBe('B')
    expect(v.flags).toContain('as_recorded')
    expect(v.flags).not.toContain('fake_lossless')
    expect(v.is).toBe('Suena como fue grabado')
    // es la grabación tal cual: la tabla no tiene que mostrarlo como un MP3 de ~192 (captura de la app, 22/10)
    expect(v.effKbps).toBe(1411)
    expect(v.why.join(' ')).not.toMatch(/espectrograma/i)
  })
  it('FLAC hecho de un MP3 128: el corte de golpe sigue siendo F', async () => {
    const { v, raw } = await verdict('falso.flac', FLAC())
    expect(raw.cutoff.sharp).toBeGreaterThan(20)
    expect(v.grade).toBe('F')
    expect(v.flags).toContain('fake_lossless')
  })
  it('escalón de 16 kHz en un archivo sin pérdida que llega arriba → D, viene de un MP3/AAC', async () => {
    const { v, raw } = await verdict('escalon.flac', FLAC())
    expect(raw.cutoff.step16).toBeGreaterThanOrEqual(12)
    expect(v.grade).toBe('D')
    expect(v.flags).toEqual(expect.arrayContaining(['maybe_transcoded', 'step16']))
  })
})

describe('archivos de 32 kHz o menos', () => {
  it('FLAC de 32 kHz: el corte en 16 kHz es del formato (no un MP3 disfrazado), pero sin año no hay excusa → D', async () => {
    const { v, raw } = await verdict('f32k.flac', FLAC(32000))
    expect(raw.cutoff.formatLimit).toBe(true)
    expect(v.grade).toBe('D')
    expect(v.flags).toContain('low_samplerate')
    expect(v.flags).not.toContain('fake_lossless')
    // de una grabación vieja, sin rastros: le faltan agudos, nada más (el de prueba lo armó ffmpeg: eso sí sería un rastro)
    expect(raw.meta.encoder).toMatch(/^Lavf/)
    expect(grade({ ...FLAC(32000), ext: 'flac' }, { ...raw, meta: {} }, { names: [{ text: 'tango.flac', from: 'archivo' }], year: 1952 }).grade).toBe('C')
    expect(grade({ ...FLAC(32000), ext: 'flac' }, raw, { names: [{ text: 'tango.flac', from: 'archivo' }], year: 1952 }).grade).toBe('D')
  })
  it('MP3 de 32 kHz a 192 kbps: no cuenta como inflado', async () => {
    const { v } = await verdict('m32k.mp3', { codec: 'mp3', lossless: false, kbps: 192, sampleRate: 32000, bits: null, channels: 2 })
    expect(v.flags).not.toContain('upscaled')
    expect(v.grade).toBe('C')
  })
})

// Nota a partir de mediciones armadas a mano (los umbrales, sin decodificar nada)
const raw = (cutoff: Partial<RawAnalysis['cutoff']>, flicker: number | null = null, more: Partial<RawAnalysis> = {}): RawAnalysis => ({
  cutoff: { cutoff: 18400, drop: 20, cdEdgeDrop: null, frames: 500, spectrum: [], ...cutoff }, hires: null, effBits: null, flicker,
  lufs: -12, lra: 6, truePeak: -1, samplePeak: -1, clipEvents: 0, stereoCorr: 0.8, sideRatio: 0.1, decodeErrors: 0, meta: {}, mp3: null, dj: null,
  prints: { audioMd5: null, chromaprint: null, size: null, mtime: null }, ms: 1, ...more,
})
const flac = { ...FLAC(), ext: 'flac' }
const mp3 = (kbps: number): GradeInput => ({ codec: 'mp3', ext: 'mp3', lossless: false, kbps, sampleRate: 44100, bits: null, channels: 2 })

describe('umbrales de la nota', () => {
  it('"Ojos de video tape" (Clics modernos, 1983): corta en 18,4 kHz de a poco → suena como fue grabado (B)', () => {
    // mediciones reales de ese FLAC (docs/archivo/pruebas/2026-10-20-analisis-2.md)
    expect(grade(flac, raw({ cutoff: 18357, sharp: 8, fall: 30, step16: 1 }, 1.44)).grade).toBe('B')
  })
  it('corte suave pero los agudos titilan como en un MP3 → no es dudoso', () => {
    const v = grade(flac, raw({ cutoff: 18400, sharp: 9, fall: 30, step16: 0 }, 4.8))
    expect(v.flags).not.toContain('soft_cutoff')
    expect(v.grade).toBe('F')
    expect(v.why.join(' ')).toMatch(/huecos/)
  })
  it('corte de golpe (16 dB en medio kHz) → F como siempre', () => {
    expect(grade(flac, raw({ cutoff: 16667, sharp: 15, fall: 38 })).grade).toBe('F')
  })
  it('MP3 "320" con un escalón enorme en 16 kHz (arriba casi nada) → inflado', () => {
    const v = grade(mp3(320), raw({ cutoff: 20123, drop: 43, sharp: 50, fall: 60, step16: 32 }))
    expect(v.flags).toContain('upscaled')
    expect(v.why.join(' ')).toMatch(/16 kHz/)
  })
  it('MP3 320 con un escalón chico en 16 kHz → sigue B', () => {
    expect(grade(mp3(320), raw({ cutoff: 20200, drop: 50, sharp: 52, fall: 65, step16: 4 })).grade).toBe('B')
  })
  it('MP3 "320" que corta suave en 17 kHz, sin rastros → como fue grabado (B), no inflado', () => {
    const v = grade(mp3(320), raw({ cutoff: 17000, drop: 25, sharp: 9, fall: 35 }))
    expect(v.flags).toContain('as_recorded')
    expect(v.flags).not.toContain('upscaled')
    expect(v.grade).toBe('B')
    expect(v.why.join(' ')).not.toMatch(/espectrograma/i)
  })
  it('el mismo MP3, pero bajado de slider.kz → inflado (un MP3 de ~160: F)', () => {
    const v = grade(mp3(320), raw({ cutoff: 17000, drop: 25, sharp: 9, fall: 35 }), { names: [{ text: 'Tema [www.slider.kz].mp3', from: 'archivo' }], year: 2020 })
    expect(v.flags).toContain('upscaled')
    expect(v.grade).toBe('F')
    expect(v.why.join(' ')).toMatch(/slider\.kz/)
  })
})

describe('huecos en el espectrograma (FlickerMeter)', () => {
  // medios siempre sonando, y en los agudos (16–19 kHz) prendido y apagado de a bloques de 12 ms, como un MP3
  const feed = (gated: boolean) => {
    const m = new FlickerMeter(44100)
    let seed = 1
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
    for (let i = 0; i < 44100 * 20; i++) {
      const on = !gated || Math.floor(i / 512) % 3 !== 0
      const t = i / 44100
      const mid = 0.2 * (Math.sin(2 * Math.PI * 3000 * t) + Math.sin(2 * Math.PI * 5100 * t)) * (1 + 0.3 * Math.sin(2 * Math.PI * 2 * t) + 0.05 * rnd())
      const high = on ? 0.05 * Math.sin(2 * Math.PI * 17500 * t) * (1 + 0.2 * rnd()) : 0
      m.push(mid + high)
    }
    return m.jitter(20000)!
  }
  it('agudos que se prenden y apagan → titileo alto; agudos parejos → bajo', () => {
    const holes = feed(true), steady = feed(false)
    expect(holes).toBeGreaterThan(3.5)
    expect(steady).toBeLessThan(3)
  })
  it('sin agudos para medir (corte en 17 kHz) → null', () => {
    const m = new FlickerMeter(44100)
    for (let i = 0; i < 44100 * 5; i++) m.push(Math.sin(i))
    expect(m.jitter(17000)).toBeNull()
  })
})

// La nota que decide sola (decidido el 22/10/2026): cada criterio, con las mediciones reales de la corrida supervisada sobre la
// copia de la base (docs/archivo/pruebas/2026-10-22-calidad-con-criterio.md). Nunca manda a mirar el espectrograma.
describe('decide sola con pistas', () => {
  const nm = (text: string, year: number | null = null, from: 'archivo' | 'tags' | 'antes' = 'archivo'): Clues => ({ names: [{ text, from }], year })
  const yt = { encoder: 'Lavf58.29.100', comment: 'https://www.youtube.com/watch?v=ZU2Sd9gu0aQ' }
  const wav48: GradeInput = { codec: 'pcm_s16le', ext: 'wav', lossless: true, kbps: 1536, sampleRate: 48000, bits: 16, channels: 2 }
  const all: string[] = []
  const g = (i: GradeInput, a: RawAnalysis, c?: Clues) => { const v = grade(i, a, c); all.push(...v.why, v.is); return v }

  it('WAV bajado de YouTube (lo dice su etiqueta) → D "Bajado de YouTube", seguridad alta', () => {
    // "Tan Bionica - Ella.wav": 48 kHz, ffmpeg, link de YouTube, corta en 20,2 kHz
    const v = g(wav48, raw({ cutoff: 20155, drop: 40, sharp: 24, fall: 32, step16: -2 }, 1.33, { meta: yt }), nm('Tan Bionica - Ella.wav', 2014))
    expect([v.grade, v.is, v.confidence]).toEqual(['D', 'Bajado de YouTube', 'alta'])
    expect(v.why.join(' ')).toMatch(/link de YouTube/)
    expect(v.why.join(' ')).toMatch(/ffmpeg/)
  })
  it('corte de golpe en 20 kHz sin ningún rastro → B "suena completo" (un CD con filtro o un MP3 de 320: los dos son B)', () => {
    // "The Police - Roxanne.flac": corta en 20,4 kHz, cae 31 dB en medio kHz, sin etiquetas
    const v = g(flac, raw({ cutoff: 20392, drop: 45, sharp: 31, fall: 53, step16: 0 }, 1.94), nm('The Police - Roxanne.flac'))
    expect([v.grade, v.confidence]).toEqual(['B', 'media'])
    expect(v.flags).toEqual(['cut20'])
    expect(v.why.join(' ')).toMatch(/arriba de lo que se oye/)
  })
  it('el mismo corte armado por ffmpeg (sin link) → D, seguridad media', () => {
    // "Prendelo-Chelo-ft-TioLucas.wav": Lavf, 44,1 kHz, corta en 20,2 kHz
    const v = g({ ...wav48, sampleRate: 44100 }, raw({ cutoff: 20177, drop: 50, sharp: 40, fall: 57, step16: 2 }, 1.42, { meta: { encoder: 'Lavf58.76.100' } }), nm('Prendelo-Chelo-ft-TioLucas.wav'))
    expect([v.grade, v.confidence]).toEqual(['D', 'media'])
    expect(v.flags).toContain('maybe_transcoded')
  })
  it('sacado de un CD con un programa para eso (XLD) → B, y dice que el corte es del disco', () => {
    // "Hold the Line.flac" (1978)
    const v = g(flac, raw({ cutoff: 20650, drop: 40, sharp: 15, fall: 45, step16: 2 }, 1.66, { meta: { encoder: 'X Lossless Decoder 20151214' } }), nm('09 - Hold the Line.flac', 1978))
    expect(v.grade).toBe('B')
    expect(v.why.join(' ')).toMatch(/X Lossless Decoder/)
    expect(v.why.join(' ')).toMatch(/del disco o del master/)
  })
  it('error de la corrida: un escalón chico (11 dB) en 16 kHz junto a un corte de golpe → D', () => {
    // "11. Alphaville - Big In Japan.flac": 11 dB, justo abajo del escalón que ya era D (12); el video de YouTube corta igual
    const v = g(flac, raw({ cutoff: 20166, drop: 30, sharp: 31, fall: 32, step16: 11 }, 2.18), nm('11. Alphaville - Big In Japan.flac', 2008))
    expect(v.grade).toBe('D')
    expect(v.why.join(' ')).toMatch(/escalón de 11 dB/)
  })
  it('error de la corrida: agudos que titilan un poco (3,1) junto a un corte de golpe → D', () => {
    // "04 - Don Omar - Virtual diva.flac": un archivo genuino titila 1,4–2,3
    const v = g(flac, raw({ cutoff: 20597, drop: 30, sharp: 13, fall: 22, step16: 0 }, 3.06), nm('04 - Don Omar - Virtual diva.flac', 2009))
    expect(v.grade).toBe('D')
    expect(v.why.join(' ')).toMatch(/titilan/)
  })
  it('48 kHz con el corte de YouTube y sin etiquetas → D "Bajado de YouTube" (la firma del audio de YouTube)', () => {
    const v = g(wav48, raw({ cutoff: 20166, drop: 40, sharp: 23, fall: 39, step16: 0 }, 1.2), nm('tema.wav'))
    expect([v.grade, v.is]).toEqual(['D', 'Bajado de YouTube'])
  })
  it('error de la corrida: un archivo dañado no dice "está bien", y la etiqueta avisa que está dañado', () => {
    // "03. Dua Lipa - Don't Start Now.flac": 4 errores al leerlo
    const v = g(flac, raw({ cutoff: 20500, drop: 40, sharp: 16, fall: 35, step16: 0 }, 1.51, { decodeErrors: 4 }), nm("03. Dua Lipa - Don't Start Now.flac", 2020))
    expect(v.grade).toBe('F')
    expect(v.is).toMatch(/^Dañado/)
    expect(v.why.join(' ')).not.toMatch(/está bien/)
  })
  it('corte suave pero bajado de YouTube → D (lo que se bajó ya estaba comprimido)', () => {
    const v = g(flac, raw({ cutoff: 18357, sharp: 8, fall: 30, step16: 1 }, 1.44), nm('Clics Modernos (Video Oficial).flac', 1983))
    expect(v.grade).toBe('D')
    expect(v.why.join(' ')).toMatch(/video de YouTube/)
  })
  it('los 5 FLAC de 32 kHz de DISCO CUMPLE (rips de GTA IV, 2008) → D; con un nombre viejo de slider.kz, también', () => {
    const f32 = { ...FLAC(32000), ext: 'flac' }
    const a = raw({ cutoff: 16000, formatLimit: true, drop: 60 })
    expect(g(f32, a, nm('06 - Don Omar - Salio El Sol.flac', 2008)).grade).toBe('D')
    expect(g(f32, a, nm('Cerrone - Supernature [www.slider.kz].flac', 1977, 'antes')).grade).toBe('D')
    expect(g(f32, a, nm('Cerrone - Supernature.flac', 1977)).grade).toBe('C')
  })
  it('la época es una pista menor: un corte suave en un tema de 2019 también es "como fue grabado"', () => {
    // "Rossi. - People (Mehlor Remix) [Rendr Records].aiff"
    const v = g({ ...flac, codec: 'pcm_s16be', ext: 'aiff' }, raw({ cutoff: 18562, sharp: 11, fall: 35, step16: 4 }, 1.0), nm('Rossi. - People (Mehlor Remix) [Rendr Records].aiff', 2019))
    expect(v.grade).toBe('B')
  })
  it('ningún veredicto manda a mirar el espectrograma', () => {
    expect(all.length).toBeGreaterThan(20)
    expect(all.join(' ')).not.toMatch(/espectrograma/i)
  })
})

describe('las pistas (core/analysis/clues.ts)', () => {
  const kinds = (c: Clues, meta: Record<string, string> = {}) => readClues(c, meta).map((x) => x.kind)
  const n = (...texts: string[]): Clues => ({ names: texts.map((text, i) => ({ text, from: i ? 'antes' : 'archivo' })), year: null })
  it('YouTube: el código del video, "(Official Video)", el link; no "[Underground]" ni "[Rendr-Recs]"', () => {
    expect(kinds(n('Tema [dQw4w9WgXcQ].wav'))).toEqual(['youtube'])
    expect(kinds(n('Cher - Believe (Official Music Video) [4K Remaster].wav'))).toEqual(['youtube'])
    expect(kinds(n('A2 Giorgio Maulini - Sky Walk VINYL ONLY  [Underground].aiff'))).toEqual([])
    expect(kinds(n('People (Mehlor Remix) [Rendr-Recs].aiff'))).toEqual([])
    expect(kinds(n('x.wav'), { comment: 'https://youtu.be/abc' })).toEqual(['youtube'])
  })
  it('slider.kz en el nombre de hoy o en uno de antes', () => {
    expect(kinds(n('Marka Akme - Linda [www.slider.kz].mp3'))).toEqual(['site'])
    const c = readClues(n('03 - Impacto.flac', 'Daddy Yankee - Impacto [www.slider.kz].flac'), {})
    expect(c[0].what).toMatch(/tenía antes/)
  })
  it('un link a Discogs no es un rastro de descarga; Bandcamp y Traxsource son tiendas', () => {
    expect(kinds(n('x.flac'), { location: 'https://www.discogs.com/Various-Now-That' })).toEqual([])
    expect(kinds(n('x.aiff'), { comment: 'Visit https://dylanfogarty.bandcamp.com' })).toEqual(['store'])
    expect(kinds(n('x.aiff'), { encoded_by: 'Traxsource' })).toEqual(['store'])
  })
  it('ffmpeg en la etiqueta del programa es un conversor; libFLAC no', () => {
    expect(kinds(n('x.flac'), { encoder: 'Lavf60.16.100' })).toEqual(['converter'])
    expect(kinds(n('x.flac'), { encoder: 'reference libFLAC 1.3.1 20141125' })).toEqual([])
  })
  it('los nombres de antes salen del Historial (Organizar y tags)', () => {
    const db = openDb(path.join(dir, 'pistas.db'))
    db.exec("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'x', 'x', 'C:/')")
    db.exec("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', 'x')")
    db.exec("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, title, year) VALUES (1, 1, 'A/Impacto.flac', 1, 1, 'musica', 'flac', 'Impacto', '2008')")
    db.exec("INSERT INTO moves_log (batch_id, root_id, file_id, from_rel, to_rel, created_at) VALUES (1, 1, 1, 'B/Impacto [www.slider.kz].flac', 'A/Impacto.flac', 'x')")
    db.exec("INSERT INTO journal (batch_id, file_id, rel_path, field, before, after, applied_at) VALUES (1, 1, 'A/Impacto.flac', 'title', 'Impacto (Official Video)', 'Impacto', 'x')")
    const c = cluesFor(db, 1)
    expect(c.year).toBe(2008)
    expect(c.names.map((x) => x.from)).toEqual(['archivo', 'tags', 'antes', 'antes'])
    expect(kinds(c).sort()).toEqual(['site', 'youtube'])
    db.close()
  })
  it('las etiquetas salen del encabezado que escribe ffmpeg al abrir el archivo', () => {
    const file = path.join(dir, 'yt.wav')
    ff('-f', 'lavfi', '-i', 'sine=d=1', '-metadata', 'comment=https://www.youtube.com/watch?v=ZU2Sd9gu0aQ', file)
    let err = ''
    try { execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] }) } catch (e) { err = String((e as { stderr: Buffer }).stderr) }
    const meta = inputMeta(err)
    expect(meta.encoder).toMatch(/^Lavf/)
    expect(meta.comment).toMatch(/youtube/)
  })
})

// En inglés la nota es la misma: lo que decide (el corte de YouTube, las pistas) va por datos, no por las palabras de la frase
describe('la nota en inglés', () => {
  afterEach(() => ponerIdioma('es'))
  const wav48: GradeInput = { codec: 'pcm_s16le', ext: 'wav', lossless: true, kbps: 1536, sampleRate: 48000, bits: 16, channels: 2 }
  it('48 kHz con el corte de YouTube → D "Downloaded from YouTube", igual que en castellano', () => {
    ponerIdioma('en')
    const v = grade(wav48, raw({ cutoff: 20166, drop: 40, sharp: 23, fall: 39, step16: 0 }, 1.2), { names: [{ text: 'tema.wav', from: 'archivo' }], year: null })
    expect([v.grade, v.is]).toEqual(['D', 'Downloaded from YouTube'])
    expect(v.says).toBe('WAV · 16-bit / 48 kHz (lossless)')
    expect(v.why.join(' ')).toMatch(/cuts off suddenly at 20\.2 kHz/)
  })
  it('un MP3 inflado sigue empezando con el formato (core/requests.ts y wanted.ts lo miran)', () => {
    ponerIdioma('en')
    const v = grade(mp3(320), raw({ cutoff: 16000, drop: 40, sharp: 30, fall: 40 }))
    expect(v.is).toBe('MP3 at ~128 kbps (inflated to 320)')
    expect(v.is.startsWith('MP3')).toBe(true)
  })
})
