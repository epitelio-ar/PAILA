// El laboratorio rápido y el completo guardan cada uno su resultado y se comparan solo con la anterior del mismo tipo
// (22/10: un rápido después de un completo dio 248 "cambios" falsos), y no corren dos a la vez (scripts/corpus-turno.ts).
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { archivosDe, guardarCorrida, quienCorre, tomarTurno, turnoDe, ultimaDelMismoTipo } from '../scripts/corpus-turno'

const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'paila-turno-'))
/** Un número de proceso que ya terminó. */
const pidMuerto = () => spawnSync(process.execPath, ['-e', '0']).pid!

describe('laboratorio: un resultado por tipo', () => {
  it('el rápido y el completo no se pisan ni se comparan entre sí', () => {
    const out = carpeta()
    guardarCorrida(out, false, { 'a.mp3': { nota: 'A', artista: 'X' } })
    guardarCorrida(out, true, { 'a.mp3': { artista: 'X' } })
    expect(ultimaDelMismoTipo(out, false)).toEqual({ 'a.mp3': { nota: 'A', artista: 'X' } })
    expect(ultimaDelMismoTipo(out, true)).toEqual({ 'a.mp3': { artista: 'X' } })
    guardarCorrida(out, true, { 'a.mp3': { artista: 'Y' } })
    const { ultima, anterior } = archivosDe(out, true)
    expect(JSON.parse(fs.readFileSync(anterior, 'utf8')).archivos['a.mp3'].artista).toBe('X')
    expect(JSON.parse(fs.readFileSync(ultima, 'utf8')).archivos['a.mp3'].artista).toBe('Y')
    expect(fs.existsSync(archivosDe(out, false).anterior)).toBe(false) // el completo no se movió
  })

  it('la primera vez usa el ultima.json de antes, solo si era del mismo tipo', () => {
    const out = carpeta()
    fs.writeFileSync(path.join(out, 'ultima.json'), JSON.stringify({ rapido: false, archivos: { 'a.mp3': { nota: 'B' } } }))
    expect(ultimaDelMismoTipo(out, false)).toEqual({ 'a.mp3': { nota: 'B' } })
    expect(ultimaDelMismoTipo(out, true)).toEqual({})
  })
})

describe('laboratorio: de a uno', () => {
  it('toma el turno, lo suelta y deja el aviso con quién corre', async () => {
    const out = carpeta()
    const soltar = await tomarTurno(out, true)
    expect(soltar).toBeTruthy()
    expect(quienCorre(out)).toMatchObject({ pid: process.pid, tipo: 'rapido' })
    soltar!()
    expect(fs.existsSync(turnoDe(out))).toBe(false)
  })

  it('si el que tenía el turno ya terminó (aviso olvidado), lo toma igual', async () => {
    const out = carpeta()
    fs.writeFileSync(turnoDe(out), JSON.stringify({ pid: pidMuerto(), tipo: 'completo', desde: new Date().toISOString(), carpeta: 'otra' }))
    expect(quienCorre(out)).toBeNull()
    const soltar = await tomarTurno(out, false, { esperaMax: 0 })
    expect(soltar).toBeTruthy()
    soltar!()
  })

  it('si otro está corriendo, espera avisando qué espera, y arranca cuando termina', async () => {
    const out = carpeta()
    const otro = JSON.stringify({ pid: process.ppid, tipo: 'completo', desde: new Date().toISOString(), carpeta: 'la otra sesión' })
    fs.writeFileSync(turnoDe(out), otro)
    const avisos: string[] = []
    expect(await tomarTurno(out, true, { esperaMax: 0, avisar: (m) => avisos.push(m) })).toBeNull() // no espera nada: no arranca
    setTimeout(() => fs.rmSync(turnoDe(out)), 150)
    const soltar = await tomarTurno(out, true, { pausa: 50, avisar: (m) => avisos.push(m) })
    expect(soltar).toBeTruthy()
    expect(avisos.some((m) => /laboratorio completo .* la otra sesión/.test(m))).toBe(true)
    soltar!()
  })
})
