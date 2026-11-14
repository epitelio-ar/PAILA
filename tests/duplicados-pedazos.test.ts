// Duplicados que antes no se veían (masterplan 4, 4A.3): versiones que comparten un pedazo de menos de 15 s (una intro, un
// sample), temas muy cortos sin huella acústica y techno muy percusivo en peor calidad. Sin juntar de más: un tramo de solo
// bombo no es un pedazo compartido, y dos temas percusivos distintos no son el mismo audio.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { findDuplicates } from '@paila/core/duplicates'
import { analyzeFile, analyzePrints } from '@paila/core/analysis/analyze'
import { FRAMES_PER_SECOND, PIECE_SECONDS, bestAlignment, sharedFrames, soundRelation, withShared } from '@paila/core/soundmatch'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import type { DupGroup } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const real: AnalysisRunner = { full: analyzeFile, prints: analyzePrints }

// "canciones" con notas que cambian (la huella acústica mira las notas), distintas entre sí
const SONG_A = "0.3*sin(2*PI*(220+110*gte(mod(t,4),2))*t)+0.2*sin(2*PI*330*t)*lt(mod(t,3),1.5)+0.1*sin(2*PI*523*t)*gte(mod(t,5),2.5)"
const SONG_B = "0.3*sin(2*PI*(294+98*gte(mod(t,3),1))*t)+0.2*sin(2*PI*370*t)*lt(mod(t,2),1)+0.1*sin(2*PI*440*t)*gte(mod(t,7),3)"
const SONG_C = "0.3*sin(2*PI*(196+65*gte(mod(t,5),2))*t)+0.2*sin(2*PI*247*t)*lt(mod(t,2.5),1)+0.15*sin(2*PI*392*t)*gte(mod(t,3),1.5)"
const SONG_D = "0.3*sin(2*PI*(262+131*gte(mod(t,6),3))*t)+0.25*sin(2*PI*311*t)*lt(mod(t,4),2)"
const INTRO = "0.3*sin(2*PI*(349+87*gte(mod(t,2),1))*t)+0.2*sin(2*PI*466*t)*lt(mod(t,1.5),0.7)+0.1*sin(2*PI*277*t)*gte(mod(t,3),2)"
// solo bombo y hi-hat, sin notas: la huella repite unos pocos valores (techno muy percusivo)
const KICK = "0.8*sin(2*PI*(45+120*exp(-25*mod(t,0.46875)))*mod(t,0.46875))*exp(-7*mod(t,0.46875))+0.15*(random(0)*2-1)*exp(-60*mod(t+0.234,0.46875))"
const SHOUT = "0.5*sin(2*PI*(600-300*t)*t)*exp(-2*t)"
const SHOUT_2 = "0.5*sin(2*PI*(300+500*t)*t)*exp(-3*t)"

let dir: string
let lib: Library
let groups: DupGroup[]
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const wav = (expr: string, secs: number) => {
  const f = path.join(dir, `parte-${fs.readdirSync(dir).length}.wav`)
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=44100:d=${secs}`, '-ac', '2', f])
  return f
}
/** Un tema armado con pedazos (expresión, segundos), guardado en `out` con las opciones de ffmpeg que se pasen. */
const join = (out: string, parts: [string, number][], args: string[] = []) => {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const ins = parts.map(([e, s]) => wav(e, s))
  execFileSync(ffmpeg, ['-v', 'error', '-y', ...ins.flatMap((f) => ['-i', f]), '-filter_complex', `${ins.map((_, i) => `[${i}:a]`).join('')}concat=n=${ins.length}:v=0:a=1`, ...args, out])
}
const names = (g: DupGroup) => g.items.map((i) => path.basename(i.rel)).sort()
const groupWith = (name: string) => groups.find((g) => g.items.some((i) => i.rel.endsWith(name)))

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-pedazos-'))
  // dos temas distintos con la misma intro de 12 s (como "Bad Blood" y su REBASSED, o la Intro y el Outro de un disco)
  join(M('Disco/01 Intro.flac'), [[INTRO, 12], [SONG_A, 30]])
  join(M('Disco/12 Final.mp3'), [[SONG_C, 6], [INTRO, 12], [SONG_B, 30]], ['-b:a', '192k'])
  // dos temas de techno distintos que arrancan con 30 s de solo bombo: no comparten nada que diga algo
  join(M('Techno/Uno.mp3'), [[KICK, 30], [SONG_C, 20]], ['-b:a', '256k'])
  join(M('Techno/Dos.mp3'), [[KICK, 30], [SONG_D, 20]], ['-b:a', '256k'])
  // muy cortos, sin huella acústica: el mismo grito en WAV y en MP3, uno distinto con otro nombre, y otro con el mismo nombre pero otra duración
  join(M('Gritos/Hey.wav'), [[SHOUT, 1.5]])
  join(M('Bajados/Hey.mp3'), [[SHOUT, 1.5]], ['-b:a', '128k'])
  join(M('Gritos/Ho.wav'), [[SHOUT_2, 1.5]])
  join(M('Otros/Hey.wav'), [[SHOUT_2, 2.6]])
  // el mismo grito en WAV y FLAC: el mismo audio bit a bit (la huella del sonido), aunque no tenga huella acústica
  join(M('Gritos/Yeah.wav'), [[SHOUT_2, 1.2]])
  fs.mkdirSync(M('Convertidos'), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', M('Gritos/Yeah.wav'), M('Convertidos/grito final.flac')])
  for (const f of fs.readdirSync(dir)) if (f.startsWith('parte-')) fs.rmSync(path.join(dir, f))
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  await lib.analyze(real, ffmpeg, 2)
  groups = await findDuplicates(lib.db, (i) => lib.trackPath(i))
}, 180_000)
afterAll(() => { lib?.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('versiones que comparten menos de 15 s', () => {
  it('dos temas con la misma intro de 12 s se muestran juntos como versiones ("comparten un pedazo"), nunca para tirar', () => {
    const v = groupWith('01 Intro.flac')!
    expect(v.level).toBe('version')
    expect(v.keep).toBeNull()
    expect(names(v)).toEqual(['01 Intro.flac', '12 Final.mp3'])
    expect(v.why).toMatch(/comparten un pedazo de 1[1-3] s \(una intro, un sample o un estribillo\), corrido 6 s/)
  })

  it('dos temas de techno que solo comparten 30 s de bombo no se juntan (un tramo sin notas se parece a todo)', () => {
    expect(groupWith('Techno/Uno.mp3')).toBeUndefined()
    expect(groupWith('Techno/Dos.mp3')).toBeUndefined()
  })
})

describe('temas muy cortos (sin huella acústica)', () => {
  it('el mismo grito en WAV y en MP3 se junta por nombre y duración, como probable y con aviso', () => {
    const g = groupWith('Gritos/Hey.wav')!
    expect(g.level).toBe('probable')
    expect(names(g)).toEqual(['Hey.mp3', 'Hey.wav'])
    expect(path.basename(g.items.find((i) => i.id === g.keep)!.rel)).toBe('Hey.wav')
    expect(g.warning).toMatch(/muy cortos/)
    expect(g.why).toMatch(/menos de 12 s/)
  })

  it('no junta uno con otro nombre, ni uno con el mismo nombre y otra duración', () => {
    expect(groupWith('Gritos/Ho.wav')).toBeUndefined()
    expect(groupWith('Otros/Hey.wav')).toBeUndefined()
  })

  it('el mismo audio bit a bit (WAV y FLAC) se junta aunque tengan nombres distintos', () => {
    const g = groupWith('Gritos/Yeah.wav')!
    expect(names(g)).toEqual(['Yeah.wav', 'grito final.flac'])
    expect(g.level).toBe('quality')
    expect(g.warning).toBeNull()
  })
})

// Huellas sintéticas (sin audio): la regla de "pedazo que dice algo" en sus bordes.
let seed = 11
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
function song(frames: number): Uint32Array {
  const fp = new Uint32Array(frames)
  let v = (rnd() * 2 ** 32) >>> 0
  for (let i = 0; i < frames; i++) { for (let b = 0; b < 32; b++) if (rnd() < 0.12) v ^= 1 << b; fp[i] = v >>> 0 }
  return fp
}
const loop = (frames: number) => { const bar = song(8); return Uint32Array.from({ length: frames }, (_, i) => bar[i % 8]) }
const cat = (...xs: Uint32Array[]) => { const out = new Uint32Array(xs.reduce((n, x) => n + x.length, 0)); let at = 0; for (const x of xs) { out.set(x, at); at += x.length } return out }

describe('pedazo compartido (huellas sintéticas)', () => {
  const sec = (s: number) => Math.round(s * FRAMES_PER_SECOND)
  it('10 s compartidos alcanzan; 2 s, no; y sin calcular el pedazo, decide como antes (15 s)', () => {
    // (un tramo de 5 s que pisa el pedazo también cuenta: el pedazo se mide hasta ~4 s más largo, como `matched`)
    for (const [secs, expected] of [[10, 'version'], [2, 'none']] as const) {
      const piece = song(sec(secs))
      const a = cat(song(sec(30)), piece, song(sec(60))), b = cat(song(sec(50)), piece, song(sec(40)))
      const al = bestAlignment(a, b, sec(20))
      expect(soundRelation(withShared(a, b, al), 100, 100, a.length, b.length)).toBe(expected)
      expect(soundRelation(al, 100, 100, a.length, b.length)).toBe('none')
    }
  })

  it('un tramo largo de solo bombo (pocos valores que se repiten) no cuenta, aunque sea idéntico', () => {
    const drums = loop(sec(40))
    const a = cat(drums, song(sec(60))), b = cat(drums, song(sec(60)))
    // solo el tramo de 5 s que pisa el borde, donde ya hay notas
    expect(sharedFrames(a, b, 0)).toBeLessThan(sec(PIECE_SECONDS))
    expect(soundRelation(withShared(a, b, bestAlignment(a, b, 0)), 100, 100, a.length, b.length)).toBe('none')
  })
})

describe('techno muy percusivo: el mismo audio aunque el contraste no llegue a 0,08', () => {
  // números medidos el 23/10 con la biblioteca real (ver standsOut en core/soundmatch.ts)
  const al = (sim: number, background: number) => ({ offset: 0, sim, overlap: 948, matched: 948, background, contrast: sim - background })
  it('"Vortex" pasado a MP3 128k (0,987 con fondo 0,912) es el mismo audio', () => {
    expect(soundRelation(al(0.987, 0.912), 400, 400, 948, 948)).toBe('same')
  })
  it('los dos temas distintos más parecidos entre los más percusivos (0,873 con fondo 0,813) no', () => {
    expect(soundRelation(al(0.873, 0.813), 400, 400, 948, 948)).not.toBe('same')
  })
  it('un loop sin una sola nota (fondo 0,947): la huella no dice nada y no se decide por sonido', () => {
    expect(soundRelation(al(0.997, 0.947), 150, 150, 948, 948)).not.toBe('same')
  })
})
