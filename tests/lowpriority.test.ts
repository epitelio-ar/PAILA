// Prioridad baja de los procesos de audio (core/lowpriority.ts): en la app usan lo que sobra del procesador; en los tests
// (PAILA_PRIORIDAD_NORMAL, de vitest.config.ts) quedan en normal para no cortarse por tiempo con la PC cargada.
import { spawn } from 'node:child_process'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { lowPriority } from '@paila/core/lowpriority'

const kids: ReturnType<typeof spawn>[] = []
const child = () => { const p = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore', windowsHide: true }); kids.push(p); return p }
afterEach(() => { for (const k of kids.splice(0)) k.kill() })

describe('prioridad de los procesos de audio', () => {
  it('los tests corren con prioridad normal', () => {
    expect(process.env.PAILA_PRIORIDAD_NORMAL).toBe('1')
    const p = child()
    lowPriority(p.pid)
    expect(os.getPriority(p.pid!)).toBe(os.getPriority(process.pid))
  })

  it('en la app, la baja', () => {
    const p = child()
    const antes = process.env.PAILA_PRIORIDAD_NORMAL
    delete process.env.PAILA_PRIORIDAD_NORMAL
    try { lowPriority(p.pid) } finally { process.env.PAILA_PRIORIDAD_NORMAL = antes }
    expect(os.getPriority(p.pid!)).toBe(os.constants.priority.PRIORITY_BELOW_NORMAL)
  })

  it('sin proceso no hace nada', () => {
    expect(() => lowPriority(undefined)).not.toThrow()
  })
})
