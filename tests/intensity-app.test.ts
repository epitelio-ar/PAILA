// Tests de la intensidad en la app (electron/intensity.ts) con una batería simulada: Tranqui se pausa a batería y sigue al
// enchufar (pero no si lo pausó el usuario), A fondo baja a Normal y avisa, y el modo queda guardado.
import { EventEmitter } from 'node:events'
import os from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntensityInfo } from '@paila/shared/types'

const power = Object.assign(new EventEmitter(), { battery: false, isOnBatteryPower() { return this.battery } })
vi.mock('electron', () => ({ powerMonitor: power, utilityProcess: {} }))
vi.mock('node:child_process', async (orig) => ({ ...(await orig<typeof import('node:child_process')>()), execFile: () => {} }))
// la memoria libre que simula el test, fija: con la de verdad dependía de la PC (con 2,8 GB libres "A fondo" quedaba limitado igual
// que "Normal" y el test fallaba en tres sesiones, 13/11). 16 GB libres: ningún modo se limita por memoria
const memoria = vi.hoisted(() => ({ libre: 16e9 }))
vi.mock('node:os', async (orig) => {
  const real = await orig<typeof import('node:os')>()
  return { ...real, freemem: () => memoria.libre, default: { ...real, freemem: () => memoria.libre } }
})

const { IntensityControl } = await import('../apps/paila/electron/intensity')
const { LibraryJob } = await import('@paila/core/libraryjob')
const { Slots } = await import('@paila/core/analysis/slots')

/** Lo mínimo de un análisis andando: el estado (pausar y seguir de verdad) y un grupo de workers que anota su tamaño. */
function setup(mode: string | null) {
  power.removeAllListeners()
  const settings = new Map<string, string>(mode ? [['analysis_intensity', mode]] : [])
  const lib = new LibraryJob()
  lib.begin('analysis', 'Analizando…')
  const notices: IntensityInfo[] = []
  const control = new IntensityControl(lib as never, (k) => settings.get(k) ?? null, (k, v) => settings.set(k, v), (i) => notices.push(i))
  const pool = { size: 0, resize(n: number) { this.size = n } }
  const slots = new Slots(1)
  control.attach(slots, pool as never)
  return { lib, control, slots, pool, notices, settings, done: () => control.detach() }
}

describe('intensidad con batería', () => {
  beforeEach(() => { power.battery = false; memoria.libre = 16e9 })

  it('Tranqui: a batería se pausa sola y al enchufar sigue', () => {
    const t = setup('tranqui')
    expect(t.lib.status.paused).toBe(false)
    power.battery = true; power.emit('on-battery')
    expect(t.lib.status.paused).toBe(true)
    expect(t.lib.status.pauseReason).toMatch(/batería/)
    expect(t.notices.at(-1)?.notice).toMatch(/pausa/)
    power.battery = false; power.emit('on-ac')
    expect(t.lib.status.paused).toBe(false)
    t.done()
  })

  it('si lo pausó el usuario, enchufar no lo hace seguir', () => {
    const t = setup('tranqui')
    t.lib.pause()
    power.battery = true; power.emit('on-battery')
    power.battery = false; power.emit('on-ac')
    expect(t.lib.status.paused).toBe(true)
    t.done()
  })

  // con menos de 4 hilos A fondo y Normal piden lo mismo
  it.skipIf(os.availableParallelism() < 4)('A fondo: a batería baja a Normal y avisa; al enchufar vuelve', () => {
    const t = setup('fondo')
    const fondo = t.slots.size
    power.battery = true; power.emit('on-battery')
    expect(t.slots.size).toBeLessThan(fondo)
    expect(t.pool.size).toBe(t.slots.size)
    expect(t.notices.at(-1)).toMatchObject({ mode: 'fondo', effective: 'normal' })
    expect(t.notices.at(-1)?.notice).toMatch(/Normal/)
    expect(t.lib.status.paused).toBe(false)
    power.battery = false; power.emit('on-ac')
    expect(t.slots.size).toBe(fondo)
    t.done()
  })

  it('cambiar el modo lo guarda y se aplica en el momento', () => {
    const t = setup(null)
    expect(t.control.mode()).toBe('normal')
    const normal = t.slots.size
    t.control.set('tranqui')
    expect(t.settings.get('analysis_intensity')).toBe('tranqui')
    expect(t.slots.size).toBeLessThanOrEqual(normal)
    expect(() => t.control.set('turbo' as never)).toThrow()
    t.done()
  })
})

describe('intensidad con poca memoria (la que simula el test, no la de la PC)', () => {
  it('con poca memoria libre A fondo se limita y lo dice; con mucha, no', () => {
    memoria.libre = 16e9
    const t = setup('fondo')
    expect(t.control.info().limitedByMemory).toBe(false)
    const mucha = t.control.workers()
    memoria.libre = 1e9
    expect(t.control.info().limitedByMemory).toBe(true)
    expect(t.control.workers()).toBeLessThan(mucha)
    t.done()
    memoria.libre = 16e9
  })
})
