// Avisos de turno automáticos (scripts/turnos.mjs): quién está usando qué (la copia de la Música, una medición, el laboratorio, una
// verificación), tomar y soltar el aviso solos, no pisar el de otra sesión y dar por olvidado el de un proceso que ya no existe.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error el script es .mjs; sus tipos están en turnos.d.mts pero vitest no los usa
import { leerAvisos, pantallaTurnos, tomarAviso, tomarCopia, tomarMedicion, tomarTurnoAjeno, textoAviso, turnoAjeno } from '../scripts/turnos.mjs'

// el turno del otro proyecto de la PC no entra en estos tests salvo donde se pide
process.env.PAILA_TURNO_AJENO = path.join(os.tmpdir(), 'paila-turnos-sin-ajeno', '.turno-pesado')
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'paila-turnos-'))
const pidMuerto = () => spawnSync(process.execPath, ['-e', '0']).pid!
const dirs: string[] = []
const nueva = () => { const d = carpeta(); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); delete process.env.PAILA_MEDICION })

describe('turnos: leer los avisos', () => {
  it('la copia en uso por una sesión viva se muestra con quién, qué y hasta cuándo', () => {
    const d = nueva(), copia = path.join(d, 'copia-en-uso.lock')
    fs.writeFileSync(copia, `discos-p · tapas y volumen parejo: aplicar · hasta 17:40 · pid ${process.pid}\n`)
    const { activos } = leerAvisos({ copia, medicion: path.join(d, 'm'), laboratorio: path.join(d, 'l'), verificando: path.join(d, 'v') })
    expect(activos).toHaveLength(1)
    expect(activos[0]).toMatchObject({ tipo: 'copia', quien: 'discos-p', pid: process.pid, vivo: true })
    expect(activos[0].que).toMatch(/tapas y volumen parejo: aplicar · hasta 17:40/)
    expect(activos[0].texto).toMatch(/^Música-copia: discos-p/)
  })
  it('un aviso hecho a mano (sin proceso) cuenta como activo; el de un proceso que murió, no', () => {
    const d = nueva(), copia = path.join(d, 'copia-en-uso.lock'), m = path.join(d, 'med.lock')
    fs.writeFileSync(copia, 'Sesión de grillas · aplica el vinilo · hasta las 18:00\n')
    fs.writeFileSync(m, `otra · escala · hasta 19:00 · pid ${pidMuerto()}\n`)
    const r = leerAvisos({ copia, medicion: m, laboratorio: path.join(d, 'l'), verificando: path.join(d, 'v') })
    expect(r.activos.map((a: { tipo: string }) => a.tipo)).toEqual(['copia'])
    expect(r.activos[0].aMano).toBe(true)
    expect(r.olvidados.map((a: { tipo: string }) => a.tipo)).toEqual(['medicion'])
  })
  it('el laboratorio y la verificación (JSON con su proceso) y un aviso viejo olvidado', () => {
    const d = nueva(), lab = path.join(d, 'corriendo.lock'), ver = path.join(d, 'verificar.lock')
    fs.writeFileSync(lab, JSON.stringify({ pid: process.pid, tipo: 'completo', desde: new Date().toISOString(), carpeta: 'C:\\repo' }))
    fs.writeFileSync(ver, JSON.stringify({ pid: process.pid, quien: 'rama-x', que: 'verificación rápida', desde: new Date().toISOString() }))
    const r = leerAvisos({ copia: path.join(d, 'c'), medicion: path.join(d, 'm'), laboratorio: lab, verificando: ver })
    expect(r.activos.map((a: { texto: string }) => a.texto.split(':')[0])).toEqual(['Laboratorio', 'Verificación'])
    expect(r.activos[0].que).toBe('laboratorio completo')
    // pasadas 5 horas, el laboratorio se da por olvidado
    const viejo = leerAvisos({ ahora: Date.now() + 5 * 3600_000, copia: path.join(d, 'c'), medicion: path.join(d, 'm'), laboratorio: lab, verificando: path.join(d, 'x') })
    expect(viejo.activos).toEqual([])
    expect(viejo.olvidados).toHaveLength(1)
  })
  it('la pantalla dice quién usa qué, y "todo libre" si nadie', () => {
    const d = nueva(), copia = path.join(d, 'c.lock')
    fs.writeFileSync(copia, `yo · pruebas · hasta 20:00 · pid ${process.pid}`)
    const ocupado = pantallaTurnos(leerAvisos({ copia, medicion: path.join(d, 'm'), laboratorio: path.join(d, 'l'), verificando: path.join(d, 'v') }), { esperar: ['tests (vitest)'] })
    expect(ocupado).toMatch(/Música-copia\s+yo — pruebas/)
    expect(ocupado).toMatch(/Laboratorio\s+libre/)
    expect(ocupado).toMatch(/Procesos pesados: tests \(vitest\)/)
    const libre = pantallaTurnos({ activos: [], olvidados: [] })
    expect(libre).toMatch(/Todo libre/)
    expect(textoAviso({ tipo: 'medicion', quien: 'a', que: 'b', desde: null, pid: 5, vivo: true, edad: 61_000 })).toBe('Medición: a — b, hace 1 min 1 s, proceso 5')
  })
})

describe('turnos: tomar y soltar solos', () => {
  it('toma la copia, no deja que otra sesión la use, y al soltar queda libre', async () => {
    const d = nueva(), copia = path.join(d, 'Música-copia')
    const soltar = await tomarCopia(copia, { que: 'prueba de turnos', horas: 1, quien: 'sesión A' })
    const lock = path.join(d, 'copia-en-uso.lock')
    expect(fs.readFileSync(lock, 'utf8')).toMatch(/^sesión A · prueba de turnos · hasta \d{2}:\d{2} · pid \d+/)
    await expect(tomarCopia(copia, { que: 'otra cosa', quien: 'sesión B' })).rejects.toThrow(/La copia de la Música está en uso \(Música-copia: sesión A/)
    soltar()
    expect(fs.existsSync(lock)).toBe(false)
    const otra = await tomarCopia(copia, { que: 'otra cosa', quien: 'sesión B' })
    otra()
  })
  it('un aviso hecho a mano: se rechaza, salvo que sea propio (no se borra al terminar)', async () => {
    const d = nueva(), copia = path.join(d, 'Música-copia'), lock = path.join(d, 'copia-en-uso.lock')
    fs.writeFileSync(lock, 'mi sesión · aplica a mano · hasta 18:00\n')
    await expect(tomarCopia(copia, { que: 'x' })).rejects.toThrow(/--aviso-propio/)
    const soltar = await tomarCopia(copia, { que: 'x', propio: true })
    soltar()
    expect(fs.existsSync(lock)).toBe(true)
  })
  it('el aviso de un proceso que ya no existe no frena a nadie', async () => {
    const d = nueva(), copia = path.join(d, 'Música-copia'), lock = path.join(d, 'copia-en-uso.lock')
    fs.writeFileSync(lock, `vieja · algo · hasta 10:00 · pid ${pidMuerto()}\n`)
    const soltar = await tomarCopia(copia, { que: 'nueva', quien: 'yo' })
    expect(fs.readFileSync(lock, 'utf8')).toMatch(/^yo · nueva/)
    soltar()
  })
  it('espera a que se libere (y avisa a quién espera) cuando se le pide esperar', async () => {
    const d = nueva(), archivo = path.join(d, 'copia-en-uso.lock'), dicho: string[] = []
    fs.writeFileSync(archivo, `otra · trabajo · hasta 10:00 · pid ${process.pid}\n`)
    setTimeout(() => fs.rmSync(archivo, { force: true }), 120)
    const soltar = await tomarAviso(archivo, 'copia', 'yo · algo · pid 1\n', { esperar: 5000, pausa: 40, avisar: (m: string) => dicho.push(m) })
    expect(soltar).toBeTypeOf('function')
    expect(dicho[0]).toMatch(/Música-copia: otra — trabajo.*espero a que termine/)
    soltar!()
  })
  it('la medición se toma sola y avisa al resto con PAILA_MEDICION', async () => {
    const lock = path.join(os.tmpdir(), 'paila-medicion.lock')
    if (fs.existsSync(lock)) return // otra sesión está midiendo de verdad: esta prueba no se mete
    const soltar = await tomarMedicion('prueba de turnos', { quien: 'test' })
    expect(fs.readFileSync(lock, 'utf8')).toMatch(/^test · prueba de turnos/)
    expect(process.env.PAILA_MEDICION).toBe('1')
    soltar()
    expect(fs.existsSync(lock)).toBe(false)
  })
})

describe('el turno pesado del otro proyecto de la PC (31/10)', () => {
  it('el del otro proyecto frena por 30 minutos; el que tomó PAILA, a PAILA no', () => {
    const d = nueva(), ajeno = path.join(d, '.turno-pesado'), sin = { copia: path.join(d, 'c'), medicion: path.join(d, 'm'), laboratorio: path.join(d, 'l'), verificando: path.join(d, 'v'), ajeno }
    fs.writeFileSync(ajeno, 'claude/balance · test:armado · 06:10\n')
    expect(leerAvisos(sin).activos).toMatchObject([{ tipo: 'ajeno', quien: 'claude/balance', que: 'test:armado · 06:10' }])
    expect(leerAvisos({ ...sin, ahora: Date.now() + 31 * 60_000 }).activos).toEqual([])
    fs.rmSync(ajeno)
    const soltar = tomarTurnoAjeno('verificación rápida', ajeno)
    expect(fs.readFileSync(ajeno, 'utf8')).toMatch(/^PAILA · .* · verificación rápida · \d\d:\d\d\n$/)
    expect(leerAvisos(sin).activos).toEqual([])
    soltar()
    expect(fs.existsSync(ajeno)).toBe(false)
  })
  it('dónde está el turno del otro proyecto: PAILA_TURNO_AJENO, o ~/.paila-turno-ajeno, o ninguno (sin ruta de fábrica)', () => {
    const antes = { ajeno: process.env.PAILA_TURNO_AJENO, perfil: process.env.USERPROFILE, home: process.env.HOME }
    const casa = nueva()
    try {
      delete process.env.PAILA_TURNO_AJENO
      process.env.USERPROFILE = casa; process.env.HOME = casa
      expect(turnoAjeno()).toBeNull()
      expect(leerAvisos({ copia: path.join(casa, 'c'), medicion: path.join(casa, 'm'), laboratorio: path.join(casa, 'l'), verificando: path.join(casa, 'v') }).activos).toEqual([])
      expect(tomarTurnoAjeno('verificación')).toBeTypeOf('function')
      fs.writeFileSync(path.join(casa, '.paila-turno-ajeno'), 'D:\\Otro\\.turno-pesado\r\n')
      expect(turnoAjeno()).toBe('D:\\Otro\\.turno-pesado')
      process.env.PAILA_TURNO_AJENO = 'E:\\x\\.turno'
      expect(turnoAjeno()).toBe('E:\\x\\.turno')
    } finally {
      process.env.PAILA_TURNO_AJENO = antes.ajeno; process.env.USERPROFILE = antes.perfil
      if (antes.home === undefined) delete process.env.HOME; else process.env.HOME = antes.home
    }
  })
  it('no pisa el turno que tiene el otro, ni crea la carpeta si el proyecto no está', () => {
    const d = nueva(), ajeno = path.join(d, '.turno-pesado')
    fs.writeFileSync(ajeno, 'claude/r1 · bots · 06:00\n')
    tomarTurnoAjeno('verificación', ajeno)()
    expect(fs.readFileSync(ajeno, 'utf8')).toBe('claude/r1 · bots · 06:00\n')
    const otro = path.join(d, 'no-esta', '.turno-pesado')
    tomarTurnoAjeno('verificación', otro)()
    expect(fs.existsSync(path.dirname(otro))).toBe(false)
  })
})
