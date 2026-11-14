// NAPIA compara por el sonido lo que baja (el autor, 1/11): con tu copia, tiene que ser el mismo audio; sin copia, AcoustID
// tiene que decir que es ese tema. Huellas sintéticas como en tests/duplicados-pedazos.test.ts.
import { describe, expect, it } from 'vitest'
import { FRAMES_PER_SECOND } from '@paila/core/soundmatch'
import { compararHuellas, esElPedido } from '@paila/core/sockseek/huella'

let seed = 7
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
function song(frames: number): Uint32Array {
  const fp = new Uint32Array(frames)
  let v = (rnd() * 2 ** 32) >>> 0
  for (let i = 0; i < frames; i++) { for (let b = 0; b < 32; b++) if (rnd() < 0.12) v ^= 1 << b; fp[i] = v >>> 0 }
  return fp
}
const sec = (s: number) => Math.round(s * FRAMES_PER_SECOND)
const cat = (...xs: Uint32Array[]) => { const out = new Uint32Array(xs.reduce((n, x) => n + x.length, 0)); let at = 0; for (const x of xs) { out.set(x, at); at += x.length } return out }
/** La misma huella con un poco de ruido (otra calidad del mismo audio). */
const ruido = (fp: Uint32Array) => fp.map((v) => (rnd() < 0.3 ? v ^ (1 << Math.floor(rnd() * 32)) : v) >>> 0)

describe('NAPIA: ¿es el mismo audio que tu copia?', () => {
  it('el mismo audio en otra calidad: mismo', () => {
    const tuya = song(sec(120))
    expect(compararHuellas(ruido(tuya), 200, tuya, 200)).toBe('mismo')
  })
  it('comparten un pedazo largo pero dura otra cosa (en vivo, extended): versión', () => {
    const parte = song(sec(60))
    const tuya = cat(parte, song(sec(60)))
    expect(compararHuellas(cat(parte, song(sec(60))), 320, tuya, 200)).toBe('version')
  })
  it('otro tema: otro; y con huellas cortas no se afirma nada', () => {
    expect(compararHuellas(song(sec(120)), 200, song(sec(120)), 200)).toBe('otro')
    expect(compararHuellas(song(sec(5)), 200, song(sec(120)), 200)).toBeNull()
  })
})

describe('NAPIA: sin copia tuya, AcoustID dice qué tema es', () => {
  const hit = (score: number, artist: string, title: string) => ({ score, recordings: [{ source: 'acoustid' as const, title, length: 200, credit: [{ name: artist, join: '' }], odd: false }] })
  it('coincide aunque cambien acentos, mayúsculas o un feat.', () => {
    expect(esElPedido([hit(0.95, 'Bad Bunny', 'Tití Me Preguntó')], 'bad bunny', 'Titi me pregunto')).toBe(true)
    expect(esElPedido([hit(0.9, 'Soda Stereo', 'De música ligera')], 'Soda Stereo', 'De Musica Ligera')).toBe(true)
  })
  it('AcoustID seguro de que es otra cosa: no; sin seguridad o sin resultados: no se sabe', () => {
    expect(esElPedido([hit(0.95, 'Rodrigo', 'Lo mejor del amor')], 'Soda Stereo', 'De música ligera')).toBe(false)
    expect(esElPedido([hit(0.4, 'Rodrigo', 'Lo mejor del amor')], 'Soda Stereo', 'De música ligera')).toBeNull()
    expect(esElPedido([], 'Soda Stereo', 'De música ligera')).toBeNull()
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Tanda } from '@paila/core/sockseek/tanda'
import { congelarTanda, guardarTanda, retomarTanda } from '@paila/core/sockseek/tanda-guardada'
describe('NAPIA retoma la tanda al volver a abrirse', () => {
  const lista = (name: string) => ({ name, tracks: [{ artist: 'a', title: 'b' }] }) as never
  const archivo = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tanda-')), 'tanda.json')
  it('se cerró bajando: la que bajaba vuelve primera y sigue sola; lo terminado no vuelve', () => {
    const f = archivo(), t = new Tanda()
    const a = t.sumar(lista('A')); t.sumar(lista('B')); const c = t.sumar(lista('C'))
    t.empezar(a.id, 'x'); t.terminar(a.id, { resumen: { total: 1 } as never, cortada: false }); t.empezar(c.id, 'y')
    congelarTanda(f, t)
    t.terminar(c.id, { resumen: { total: 1 } as never, cortada: true }) // cerrar corta la lista: no se guarda
    guardarTanda(f, t)
    const n = new Tanda()
    expect(retomarTanda(n, f)).toBe(true)
    expect(n.items.map((i) => [i.list.name, i.estado])).toEqual([['C', 'espera'], ['B', 'espera']])
  })
  it('frenada con Parar: vuelve la tanda, pero no arranca sola', () => {
    const f = archivo(), t = new Tanda()
    const a = t.sumar(lista('A')); t.sumar(lista('B'))
    t.empezar(a.id, 'x'); t.terminar(a.id, { resumen: { total: 1 } as never, cortada: true })
    guardarTanda(f, t)
    const n = new Tanda()
    expect(retomarTanda(n, f)).toBe(false)
    expect(n.items.map((i) => i.list.name)).toEqual(['B'])
    expect(n.frenada).not.toBeNull()
  })
})
