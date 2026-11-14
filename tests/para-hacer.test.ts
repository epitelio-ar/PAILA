// "Para hacer" del Inicio (pedido del autor, 24/10; apps/paila/ui/src/ParaHacer.lista.ts): cada cosa aparece solo cuando hay
// algo para hacer, en el orden en que conviene, con cuánto lugar libera, y la tarjeta desaparece cuando no hay nada.
import { afterAll, describe, expect, it } from 'vitest'
import type { BackupInfo, ScanStatus, TrashSummary, UpdateState } from '@paila/shared/types'
import { ponerIdioma } from '@paila/shared/idioma'
import { paraHacer, VIEJO_MS, type DatosParaHacer } from '../apps/paila/ui/src/ParaHacer.lista'

const AHORA = Date.parse('2026-10-24T12:00:00Z')
const quieta: ScanStatus = { job: null, running: false, paused: false, phase: '', found: 0, toProbe: 0, probed: 0, errors: 0, removed: 0, current: '', startedAt: null, finishedAt: null, warnings: [], pauseReason: null, waitingDisk: null, stopping: false, outcome: 'ok' }
const vacia: TrashSummary = { bytes: 0, files: 0, backups: 0, tracks: 0, other: 0, warn: false, limit: 5e9, offline: 0 }
const respaldo = (dias: number, bytes: number, extra: Partial<BackupInfo> = {}): BackupInfo => ({ id: Math.round(dias * 1000 + bytes), op: 'tags', ref: 1, rootId: 1, dir: 'x', files: 3, bytes, createdAt: new Date(AHORA - dias * 24 * 3600_000).toISOString(), complete: true, exists: true, light: true, trashDir: null, ...extra })
const version = (phase: UpdateState['phase'], v: string | null): UpdateState => ({ enabled: true, why: null, auto: true, portable: false, current: '0.5.3', phase, available: v ? { version: v, releaseDate: null } : null, progress: null, onQuit: false, error: null, lastCheck: null })
const base = (d: Partial<DatosParaHacer> = {}): DatosParaHacer => ({ papelera: vacia, respaldos: [], carpetaRespaldos: 'D:/Respaldos', carpetaOk: false, pendientes: 0, scan: quieta, version: version('quieta', null), ahora: AHORA, ...d })
const claves = (d: Partial<DatosParaHacer>) => paraHacer(base(d)).map((r) => r.key)

ponerIdioma('es')
afterAll(() => ponerIdioma('es'))

describe('Para hacer', () => {
  it('sin nada para hacer, la tarjeta no aparece', () => {
    expect(paraHacer(base())).toEqual([])
    // todavía sin datos (al abrir): tampoco
    expect(paraHacer(base({ papelera: null, respaldos: null, carpetaRespaldos: undefined, version: null }))).toEqual([])
  })

  it('la papelera, con cuánto ocupa y cuánto se libera; si es mucho, se marca', () => {
    const [r] = paraHacer(base({ papelera: { ...vacia, bytes: 3.2e9, files: 1204, warn: false } }))
    expect(r).toMatchObject({ key: 'papelera', libera: 3.2e9, atencion: false, acciones: ['verPapelera', 'vaciar'] })
    expect(r.texto).toContain('1.204 archivos')
    expect(r.texto).toContain('no se borra hasta que la vaciás')
    expect(paraHacer(base({ papelera: { ...vacia, bytes: 9e9, files: 3, warn: true } }))[0]).toMatchObject({ atencion: true })
  })

  it('los respaldos viejos (más de un mes, enteros, en su lugar), sumando lo que ocupan', () => {
    const respaldos = [respaldo(45, 300e6), respaldo(40, 200e6), respaldo(3, 900e6), respaldo(60, 50e6, { trashDir: 'P' }), respaldo(60, 70e6, { complete: false })]
    const [r] = paraHacer(base({ respaldos }))
    expect(r).toMatchObject({ key: 'respaldos', libera: 500e6, acciones: ['verRespaldos'] })
    expect(r.texto).toContain('2 respaldos')
    expect(r.texto).toContain('ocupan')
    // uno solo, en singular ("1 respaldo … ocupan" en las capturas del 24/10)
    expect(paraHacer(base({ respaldos: [respaldo(45, 300e6)] }))[0].texto).toMatch(/\*\*1 respaldo\*\* de hace más de un mes ocupa .*ya lo podés/)
    expect(claves({ respaldos: [respaldo(29, 1e6)] })).toEqual([])
    expect(VIEJO_MS).toBe(30 * 24 * 3600_000)
  })

  it('los cambios pendientes y el análisis van primero (lo que está a medias)', () => {
    const scan = { ...quieta, job: 'analysis' as const, running: true, toProbe: 4705, probed: 1200 }
    expect(claves({ pendientes: 12, scan, papelera: { ...vacia, bytes: 1e6, files: 1 } })).toEqual(['cambios', 'analisis', 'papelera'])
    expect(paraHacer(base({ scan }))[0].texto).toContain('1.200 de 4.705')
    expect(paraHacer(base({ scan: { ...scan, running: false, paused: true } }))[0].texto).toContain('en pausa')
    // el escaneo de carpetas no es el análisis
    expect(claves({ scan: { ...quieta, job: 'scan', running: true } })).toEqual([])
  })

  it('una versión nueva, solo cuando hay una', () => {
    expect(claves({ version: version('hay', '0.6.0') })).toEqual(['version'])
    expect(paraHacer(base({ version: version('lista', '0.6.0') }))[0].texto).toContain('ya está bajada')
    expect(claves({ version: version('buscando', null) })).toEqual([])
  })

  it('la carpeta de respaldos de fábrica, solo si ya hay respaldos al lado de la música y hasta que digas "Así está bien"', () => {
    const respaldos = [respaldo(2, 10e6)]
    expect(claves({ carpetaRespaldos: null, respaldos })).toEqual(['carpeta'])
    expect(claves({ carpetaRespaldos: null, respaldos: [] })).toEqual([])
    expect(claves({ carpetaRespaldos: null, respaldos, carpetaOk: true })).toEqual([])
    expect(claves({ carpetaRespaldos: 'D:/Otra', respaldos })).toEqual([])
  })

  it('en inglés', () => {
    ponerIdioma('en')
    const [r] = paraHacer(base({ papelera: { ...vacia, bytes: 3.2e9, files: 1204 } }))
    expect(r.texto).toContain('1,204 files')
    expect(r.texto).toContain("isn't deleted until you empty it")
    ponerIdioma('es')
  })
})
