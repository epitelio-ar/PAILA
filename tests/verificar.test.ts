// `npm run verificar` (scripts/verificar.mjs): a quién espera antes de arrancar, cómo separa los tests que fallan por la carga
// de los que fallan de verdad y el resumen de una pantalla. Correrlo entero es la prueba grande; acá van las piezas.
import { describe, expect, it } from 'vitest'
import path from 'node:path'
// @ts-expect-error el script es .mjs sin tipos
import { duracion, fallas, leerLaboratorio, paso, patron, pesados, resumen } from '../scripts/verificar.mjs'

const RAIZ = path.join(__dirname, '..')
const informe = (estados: Record<string, string>) => ({
  numTotalTests: Object.keys(estados).length,
  testResults: [{ name: path.join(RAIZ, 'tests', 'x.test.ts'), status: Object.values(estados).includes('failed') ? 'failed' : 'passed',
    assertionResults: Object.entries(estados).map(([t, status]) => ({ title: t, ancestorTitles: ['grupo'], fullName: `grupo ${t}`, status })) }],
})

describe('verificar: antes de arrancar', () => {
  it('espera a los tests, el laboratorio y el ffmpeg de otras sesiones; de PAILA instalada solo avisa', () => {
    const r = pesados([
      { pid: 1, nombre: 'node.exe', cmd: 'node C:\\x\\node_modules\\vitest\\vitest.mjs run' },
      { pid: 2, nombre: 'node.exe', cmd: 'node scripts/run-ts.mjs scripts/corpus.ts --rapido' },
      { pid: 3, nombre: 'ffmpeg.exe', ruta: 'C:\\Users\\yo\\Documents\\PAILA\\node_modules\\ffmpeg-static\\ffmpeg.exe' },
      { pid: 4, nombre: 'ffmpeg.exe', ruta: 'C:\\Users\\yo\\AppData\\Local\\Programs\\PAILA\\resources\\ffmpeg.exe' },
      { pid: 5, nombre: 'node.exe', cmd: 'node C:\\x\\node_modules\\vitest\\vitest.mjs run' },
      { pid: 6, nombre: 'node.exe', cmd: 'node scripts/verificar.mjs' },
      { pid: 7, nombre: 'node.exe', cmd: 'node vitest run' },
    ], new Set([7]))
    expect(r.esperar).toEqual(['tests (vitest) ×2', 'el laboratorio', 'audio de otra sesión (ffmpeg.exe)'])
    expect(r.avisar).toEqual(['PAILA instalada está analizando (ffmpeg.exe)'])
  })

  it('sin nada pesado, no espera', () => {
    expect(pesados([{ pid: 1, nombre: 'node.exe', cmd: 'node server.js' }]).esperar).toEqual([])
  })
})

describe('verificar: tests que fallan', () => {
  it('saca del informe de vitest qué falló, y si después pasó solo', () => {
    const malos = fallas(informe({ anda: 'passed', 'MP3 cortado (ID3v1)': 'failed' }))
    expect(malos).toEqual([{ archivo: 'tests/x.test.ts', nombre: 'grupo MP3 cortado (ID3v1)' }])
    expect(paso(informe({ 'MP3 cortado (ID3v1)': 'passed', anda: 'skipped' }), malos[0])).toBe(true)
    expect(paso(informe({ 'MP3 cortado (ID3v1)': 'failed' }), malos[0])).toBe(false)
    expect(paso(informe({ otro: 'passed' }), malos[0])).toBe(false) // si no corrió, no cuenta como que pasó
  })

  it('un archivo que no carga cuenta entero', () => {
    const r = { testResults: [{ name: path.join(RAIZ, 'tests', 'roto.test.ts'), status: 'failed', assertionResults: [] }] }
    expect(fallas(r)).toEqual([{ archivo: 'tests/roto.test.ts', nombre: null }])
  })

  it('el nombre del test sirve tal cual como patrón, con paréntesis y signos', () => {
    const p = new RegExp(patron('grupo MP3 cortado (ID3v1) [x] $5?'))
    expect(p.test('tests/x.test.ts grupo MP3 cortado (ID3v1) [x] $5?')).toBe(true)
    expect(p.test('grupo MP3 cortado ID3v1 [x] $5?')).toBe(false)
  })
})

describe('verificar: el resumen', () => {
  it('lee lo que importa del laboratorio', () => {
    expect(leerLaboratorio('…\nCambios respecto de la corrida rápida anterior (3):\n…\nTodo cumple lo esperado en tests/corpus.json.')).toBe('todo cumple lo esperado; 3 cambios respecto de la anterior')
    expect(leerLaboratorio('Sin cambios respecto de la corrida completa anterior.\nNO CUMPLEN lo esperado (2):')).toBe('2 no cumplen lo esperado; sin cambios respecto de la anterior')
  })

  it('una pantalla: cada parte con su tiempo, qué falló y el total', () => {
    const r = resumen([
      { nombre: 'Tipos', bien: true, ms: 12_000 },
      { nombre: 'Tests', bien: true, ms: 370_000, resumen: '799 de 800 pasan; 1 fallaron por carga y pasaron solos', detalle: ['tests/changes.test.ts › MP3: pasó solo (falló por la carga de la PC)'] },
      { nombre: 'Laboratorio', bien: false, ms: 90_000, resumen: '2 no cumplen lo esperado' },
    ], { espera: 60_000, rapido: true })
    expect(r).toContain('Espera')
    expect(r).toMatch(/Tests\s+bien\s+6 min 10 s/)
    expect(r).toContain('pasó solo (falló por la carga de la PC)')
    expect(r).toMatch(/Laboratorio\s+MAL/)
    expect(r).toContain('Total 8 min 52 s. Falló: laboratorio.')
    expect(r.split('\n').length).toBeLessThan(25)
    expect(duracion(59_400)).toBe('59 s')
    expect(duracion(120_000)).toBe('2 min')
  })
})
