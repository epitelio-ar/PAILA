// Tests del grupo de procesos de análisis (core/analysis/pool.ts): al cancelar no se queda nada colgado.
import { describe, expect, it } from 'vitest'
import { WorkerPool } from '@paila/core/analysis/pool'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

describe('WorkerPool.abort', () => {
  it('rechaza lo pendiente y lo que espera, sin colgarse', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-'))
    const script = path.join(dir, 'w.cjs')
    fs.writeFileSync(script, "const {parentPort}=require('node:worker_threads');parentPort.on('message',()=>{})") // nunca responde
    const pool = new WorkerPool(script, 1)
    const a = pool.prints({ ffmpeg: 'x', file: 'a', channels: 1 }).catch((e: Error) => e.message)
    const b = pool.prints({ ffmpeg: 'x', file: 'b', channels: 1 }).catch((e: Error) => e.message)
    pool.abort()
    expect(await Promise.all([a, b])).toEqual(['Detenido', 'Detenido'])
    await pool.close()
  })
})
