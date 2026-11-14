// "Lo que cambia" entre dos versiones de un archivo (core/ops/delta.ts), con bytes inventados: lo guardado alcanza para
// rearmar el de antes, ocupa solo lo distinto aunque el audio se corra de lugar y cambien las dos puntas, y si todo cambió
// guarda el archivo entero. Un respaldo arruinado nunca rearma "algo parecido": la huella no da y se avisa.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileSha1, readDelta, rebuild, saveDelta } from '@paila/core/ops/delta'

let dir: string
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-delta-')) })
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/** Escribe las dos versiones, guarda lo que cambia y comprueba que rearma el de antes. */
async function roundTrip(name: string, before: Buffer, after: Buffer) {
  const a = path.join(dir, `${name}.antes`), b = path.join(dir, `${name}.despues`), d = path.join(dir, `${name}.paila`)
  fs.writeFileSync(a, before); fs.writeFileSync(b, after)
  const r = await saveDelta(a, b, d, { fileId: 1, rel: name })
  expect(await rebuild(d, b, null, r.pos)).toBe(await fileSha1(a))
  const out = path.join(dir, `${name}.rearmado`)
  await rebuild(d, b, out, r.pos)
  expect(fs.readFileSync(out).equals(before)).toBe(true)
  return r
}

describe('lo que cambia entre dos versiones', () => {
  const audio = crypto.randomBytes(3 * 1024 * 1024)
  it('tags al principio y al final, de otro tamaño, con el audio corrido: guarda solo las puntas', async () => {
    const r = await roundTrip('puntas', Buffer.concat([crypto.randomBytes(5000), audio, crypto.randomBytes(128)]), Buffer.concat([crypto.randomBytes(9000), audio, crypto.randomBytes(300)]))
    expect(r.header.entero).toBe(false)
    expect(r.bytes).toBeLessThan(6000)
  })
  it('la tapa de antes, igual pero corrida por otro tag más largo: no se guarda dos veces', async () => {
    const tapa = crypto.randomBytes(400 * 1024)
    const r = await roundTrip('tapa', Buffer.concat([Buffer.from('genero: Rock'), tapa, audio]), Buffer.concat([Buffer.from('genero: Deep House Progresivo'), tapa, audio]))
    expect(r.bytes).toBeLessThan(2000)
  })
  it('un medio de silencio (ceros) no confunde: igual rearma', async () => {
    const silence = Buffer.concat([crypto.randomBytes(200 * 1024), Buffer.alloc(2 * 1024 * 1024), crypto.randomBytes(200 * 1024)])
    await roundTrip('silencio', Buffer.concat([crypto.randomBytes(100), silence, Buffer.from('fin1')]), Buffer.concat([crypto.randomBytes(700), silence, Buffer.from('final 2')]))
  })
  it('varios temas en el mismo archivo de la tanda (cambios.paila), uno detrás del otro: cada uno se rearma desde su posición', async () => {
    const box = path.join(dir, 'tanda.paila')
    const pares = [0, 1, 2].map((k) => [Buffer.concat([Buffer.from(`tags viejos ${k}`), audio]), Buffer.concat([Buffer.from(`otros tags ${k} más largos`), audio])])
    const hechos = []
    for (const [k, [antes, despues]] of pares.entries()) {
      fs.writeFileSync(path.join(dir, `t${k}.antes`), antes); fs.writeFileSync(path.join(dir, `t${k}.despues`), despues)
      hechos.push(await saveDelta(path.join(dir, `t${k}.antes`), path.join(dir, `t${k}.despues`), box, { fileId: k, rel: `t${k}` }))
    }
    expect(hechos.map((h) => h.pos)).toEqual([0, hechos[0].bytes, hechos[0].bytes + hechos[1].bytes])
    expect(fs.statSync(box).size).toBe(hechos.reduce((s, h) => s + h.bytes, 0))
    for (const [k, h] of hechos.entries()) expect(await rebuild(box, path.join(dir, `t${k}.despues`), null, h.pos)).toBe(await fileSha1(path.join(dir, `t${k}.antes`)))
  })
  it('archivos iguales: casi nada', async () => {
    const r = await roundTrip('iguales', audio, audio)
    expect(r.header.ops).toEqual([[0, 0, audio.length]])
  })
  it('si cambió casi todo, guarda el de antes entero', async () => {
    const r = await roundTrip('todo', crypto.randomBytes(300 * 1024), crypto.randomBytes(310 * 1024))
    expect(r.header.entero).toBe(true)
    expect(readDelta(path.join(dir, 'todo.paila'), r.pos).header.old.size).toBe(300 * 1024)
  })
  it('rearmado desde otro archivo (no el que dejó esa escritura): la huella no da', async () => {
    await roundTrip('otro', Buffer.concat([Buffer.from('A'), audio]), Buffer.concat([Buffer.from('BB'), audio]))
    const ajeno = path.join(dir, 'ajeno')
    const x = Buffer.concat([Buffer.from('BB'), audio]); x[x.length - 10] ^= 0xff
    fs.writeFileSync(ajeno, x)
    expect(await rebuild(path.join(dir, 'otro.paila'), ajeno, null)).not.toBe(await fileSha1(path.join(dir, 'otro.antes')))
  })
})
