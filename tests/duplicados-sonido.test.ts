// Duplicados por sonido (Fase D) de punta a punta, con audio generado: el mismo audio en otra calidad, versiones que NO
// son duplicados (extended; en vivo vs estudio con los mismos tags), la Bandeja por sonido y reconectar un tema renombrado
// al que otro programa le cambió los tags.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { findDuplicates } from '@paila/core/duplicates'
import { Inbox } from '@paila/core/inbox'
import { matchByPrint } from '@paila/core/printmatch'
import { analyzeFile, analyzePrints } from '@paila/core/analysis/analyze'
import type { AnalysisRunner } from '@paila/core/analysis/pool'
import type { DupGroup } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const real: AnalysisRunner = { full: analyzeFile, prints: analyzePrints }

// "Canciones" con notas que cambian (la huella acústica mira las notas). Cada una distinta de las otras.
const SONG_A = "0.3*sin(2*PI*(220+110*gte(mod(t,4),2))*t)+0.2*sin(2*PI*330*t)*lt(mod(t,3),1.5)+0.1*sin(2*PI*523*t)*gte(mod(t,5),2.5)"
const SONG_B = "0.3*sin(2*PI*(294+98*gte(mod(t,3),1))*t)+0.2*sin(2*PI*370*t)*lt(mod(t,2),1)+0.1*sin(2*PI*440*t)*gte(mod(t,7),3)"
const SONG_C = "0.3*sin(2*PI*(196+65*gte(mod(t,5),2))*t)+0.2*sin(2*PI*247*t)*lt(mod(t,2.5),1)+0.15*sin(2*PI*392*t)*gte(mod(t,3),1.5)"
const SONG_D = "0.3*sin(2*PI*(262+131*gte(mod(t,6),3))*t)+0.25*sin(2*PI*311*t)*lt(mod(t,4),2)"
const SONG_E = "0.3*sin(2*PI*(349+87*gte(mod(t,2),1))*t)+0.2*sin(2*PI*466*t)*lt(mod(t,5),2.5)+0.1*sin(2*PI*277*t)*gte(mod(t,3),2)"
const SONG_G = "0.3*sin(2*PI*(233+117*gte(mod(t,3),1.5))*t)+0.2*sin(2*PI*349*t)*lt(mod(t,4),1)+0.1*sin(2*PI*587*t)*gte(mod(t,6),2)"
const SONG_H = "0.3*sin(2*PI*(311+78*gte(mod(t,2.5),1))*t)+0.2*sin(2*PI*208*t)*lt(mod(t,3.5),2)+0.1*sin(2*PI*698*t)*gte(mod(t,4.5),2)"
const SONG_F = "0.3*sin(2*PI*(185+92*gte(mod(t,3.5),1.5))*t)+0.2*sin(2*PI*415*t)*lt(mod(t,6),2)+0.1*sin(2*PI*622*t)*gte(mod(t,4),1)"

let dir: string
let lib: Library
let groups: DupGroup[]
const M = (rel: string) => path.join(dir, 'M', ...rel.split('/'))
const make = (out: string, expr: string, secs: number, args: string[] = [], meta: Record<string, string> = {}) => {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=44100:d=${secs}`, '-ac', '2', ...args,
    ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
}
const idOf = (name: string) => lib.tracks().find((r) => String(r[2]).endsWith(name))![0] as number
const names = (g: DupGroup) => g.items.map((i) => path.basename(i.rel)).sort()
const groupWith = (name: string, level?: DupGroup['level']) => groups.find((g) => (!level || g.level === level) && g.items.some((i) => i.rel.endsWith(name)))

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-dupsonido-'))
  // el mismo audio en tres calidades, con nombres que no dicen nada y sin tags
  make(M('Bajados/a.flac'), SONG_A, 40)
  make(M('Bajados/track01.mp3'), SONG_A, 40, ['-b:a', '128k'])
  make(M('Otra carpeta/audio_final.wav'), SONG_A, 40) // mismo audio exacto que el FLAC, otro formato
  // extended: 20 s de intro propia y después la misma canción
  const intro = path.join(dir, 'intro.wav'), body = path.join(dir, 'body.wav')
  make(intro, SONG_F, 20); make(body, SONG_A, 40)
  fs.mkdirSync(path.dirname(M('Remixes/a extended.mp3')), { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', intro, '-i', body, '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', '-b:a', '320k', M('Remixes/a extended.mp3')])
  // estudio y en vivo con los MISMOS tags y la misma duración, pero suenan distinto (lo que pasó con "Jijiji" el 19/10)
  make(M('Redondos/Oktubre/07 - Jijiji.flac'), SONG_B, 40, [], { artist: 'Patricio Rey y sus Redonditos de Ricota', title: 'Jijiji' })
  make(M('Redondos/En vivo/13 - Jijiji.flac'), SONG_D, 40, [], { artist: 'Patricio Rey y sus Redonditos de Ricota', title: 'Jijiji' })
  // el mismo audio con dos títulos distintos (pasó con "Conjure Drama" / "Conjure Balearia" de Maceo Plex): uno está mal nombrado
  make(M('Maceo/Conjure Balearia.mp3'), SONG_G, 40, ['-b:a', '192k'], { artist: 'Maceo Plex', title: 'Conjure Balearia' })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', M('Maceo/Conjure Balearia.mp3'), '-c', 'copy', '-metadata', 'title=Conjure Drama', M('Maceo/Conjure Drama.mp3')])
  // el mismo tema bajado de un video: suena igual pero tiene 7 s de silencio al final (Katy Perry, Robbie Williams; corrida
  // del 22/10). Con los mismos tags es un duplicado probable; con otro título, no (lo dirán Versiones)
  make(M('CD/Fulana - Bailá.flac'), SONG_H, 40, [], { artist: 'Fulana', title: 'Bailá' })
  make(M('Videos/Fulana - Bailá (Video Oficial).mp3'), SONG_H, 40, ['-af', 'apad=pad_dur=7', '-b:a', '192k'], { artist: 'Fulana', title: 'Bailá' })
  // un tema suelto, para reconectarlo después de que otro programa le cambie los tags y el nombre
  make(M('Sueltos/para renombrar.flac'), SONG_C, 40)
  lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
  await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  await lib.scan()
  await lib.analyze(real, ffmpeg, 2)
  groups = await findDuplicates(lib.db, (i) => lib.trackPath(i))
}, 180_000)
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('duplicados por sonido', () => {
  it('junta el mismo audio en otra calidad aunque no tenga tags ni nombre, y se queda con el FLAC', () => {
    const g = groupWith('track01.mp3', 'quality')!
    expect(g).toBeTruthy()
    expect(names(g)).toEqual(['a.flac', 'audio_final.wav', 'track01.mp3'])
    expect(path.basename(g.items.find((i) => i.id === g.keep)!.rel)).toBe('a.flac') // mismo audio que el WAV: FLAC guarda tags y ocupa menos
    expect(g.similarity).toBeGreaterThan(0.8)
  })

  it('el mismo audio con títulos de temas distintos va junto, pero avisa que puede haber un archivo mal nombrado', () => {
    const g = groupWith('Conjure Drama.mp3')!
    expect(g.level).toBe('exact')
    expect(names(g)).toEqual(['Conjure Balearia.mp3', 'Conjure Drama.mp3'])
    expect(g.warning).toMatch(/mal nombrado/)
    expect(groupWith('track01.mp3')!.warning).toBeNull()
  })

  it('la extended es una versión: se muestra junto, pero nunca se propone tirarla', () => {
    const v = groupWith('a extended.mp3')!
    expect(v.level).toBe('version')
    expect(v.keep).toBeNull()
    // de la canción original va solo la copia que se queda (las otras ya están en su grupo de duplicados)
    expect(names(v)).toEqual(['a extended.mp3', 'a.flac'])
    expect(v.why).toMatch(/comparten \d+ s de audio, corrido 20 s/)
  })

  it('con la huella: el mismo tema con 7 s de más (la cola de un video) es un probable, con aviso; sin huella no alcanzaría (±3 s o 2 %)', () => {
    const g = groupWith('Bailá (Video Oficial).mp3')!
    expect(g.level).toBe('probable')
    expect(names(g)).toEqual(['Fulana - Bailá (Video Oficial).mp3', 'Fulana - Bailá.flac'])
    expect(path.basename(g.items.find((i) => i.id === g.keep)!.rel)).toBe('Fulana - Bailá.flac')
    expect(g.why).toMatch(/suenan igual, pero uno dura unos segundos más/)
    expect(g.warning).toMatch(/^Uno dura 7 s más/)
  })

  it('estudio y en vivo con los mismos tags y duración NO son duplicados: suenan distinto (error del 19/10)', () => {
    expect(groups.some((g) => g.level !== 'version' && g.items.some((i) => i.rel.includes('Jijiji')))).toBe(false)
    const v = groupWith('07 - Jijiji.flac', 'version')!
    expect(names(v)).toEqual(['07 - Jijiji.flac', '13 - Jijiji.flac'])
    expect(v.why).toContain('suenan distinto')
  })

  it('la Bandeja reconoce una descarga sin tags ni nombre por cómo suena', async () => {
    const dl = path.join(dir, 'Descargas', 'AUD-20261020-WA0003.mp3')
    make(dl, SONG_A, 40, ['-b:a', '192k'])
    const inbox = new Inbox(lib.db, findFfprobe()!, path.join(dir, 'work'), ffmpeg)
    const [it] = await inbox.inspect([path.dirname(dl)])
    expect(it.match?.by).toBe('sonido')
    expect(['a.flac', 'track01.mp3', 'audio_final.wav']).toContain(path.basename(it.match!.rel))
    // una canción que no está en la biblioteca no se empareja con nada
    const other = path.join(dir, 'Descargas2', 'otro.mp3')
    make(other, SONG_E, 40, ['-b:a', '192k'])
    const [it2] = await inbox.inspect([path.dirname(other)])
    expect(it2.match).toBeNull()
  })

  it('matchByPrint: el mismo audio primero, la extended como versión, y los pedidos se comparan aunque el índice no los traiga', async () => {
    const dl = path.join(dir, 'Compras', 'a-320.mp3')
    make(dl, SONG_A, 40, ['-b:a', '320k'])
    const p = (await analyzePrints({ ffmpeg, file: dl, channels: 2 })).chromaprint!
    const found = await matchByPrint(lib.db, p, { duration: 40 })
    const kindOf = (name: string) => found.find((c) => c.fileId === idOf(name))?.kind
    expect(found[0].kind).toBe('mismo')
    expect(kindOf('a.flac')).toBe('mismo')
    expect(kindOf('track01.mp3')).toBe('mismo')
    expect(kindOf('a extended.mp3')).toBe('version')
    expect(found.find((c) => c.fileId === idOf('a extended.mp3'))!.offsetSeconds).toBeCloseTo(20, 0)
    expect(kindOf('07 - Jijiji.flac')).toBeUndefined() // otra canción: ni dudoso
    // un pedido que no suena parecido no aparece; uno que sí, va primero entre los de su clase
    const pref = await matchByPrint(lib.db, p, { duration: 40, prefer: [idOf('track01.mp3'), idOf('07 - Jijiji.flac')] })
    expect(pref[0]).toMatchObject({ fileId: idOf('track01.mp3'), kind: 'mismo', preferred: true })
    expect(pref.some((c) => c.fileId === idOf('07 - Jijiji.flac'))).toBe(false)
    // la Bandeja lo usa primero: aunque los tags digan otra cosa, empareja por cómo suena
    make(path.join(dir, 'Compras2', 'x.mp3'), SONG_A, 40, ['-b:a', '256k'], { artist: 'Otro', title: 'Cualquiera' })
    const [it] = await new Inbox(lib.db, findFfprobe()!, path.join(dir, 'work'), ffmpeg).inspect([path.join(dir, 'Compras2')])
    expect(it.match?.by).toBe('sonido')
  })

  it('reconecta un tema que otro programa retagueó y renombró (cambió el tamaño): mismo audio, mismo tema para PAILA', async () => {
    const before = idOf('para renombrar.flac')
    const from = M('Sueltos/para renombrar.flac'), to = M('Sueltos/Artista - Título nuevo.flac')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', from, '-c', 'copy', '-metadata', 'artist=Artista', '-metadata', 'title=Título nuevo', '-metadata', 'comment=' + 'x'.repeat(3000), to])
    expect(fs.statSync(to).size).not.toBe(fs.statSync(from).size)
    fs.rmSync(from)
    const s = await lib.scan()
    expect(s.phase).toMatch(/1 reconectados/)
    expect(idOf('Artista - Título nuevo.flac')).toBe(before)
    expect(lib.db.prepare('SELECT COUNT(*) AS n FROM files WHERE missing_at IS NOT NULL').get()).toEqual({ n: 0 })
  })
})
