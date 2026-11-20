// La huella de un archivo (core/ops/delta.ts, fileSha1) termina con el archivo ya cerrado. Si no, en Windows reemplazarlo justo
// después fallaba a veces: deshacer el cover.jpg de una carpeta no lo devolvía (tests/tapas-volumen.test.ts, runner de Windows).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { fileSha1 } from '@paila/core/ops/delta'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-huella-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
/** Lo que este proceso tiene abierto de ese archivo (solo se puede mirar en Linux). */
const abiertos = (f: string) => fs.readdirSync('/proc/self/fd').filter((n) => { try { return fs.readlinkSync(`/proc/self/fd/${n}`) === f } catch { return false } })

describe('huella de un archivo', () => {
  it('se puede reemplazar el archivo apenas termina (como hace deshacer con el cover.jpg)', async () => {
    const f = path.join(dir, 'cover.jpg'), tmp = path.join(dir, '.cover.jpg.paila')
    fs.writeFileSync(f, Buffer.alloc(300_000, 1))
    // es una carrera: con la versión vieja quedaba abierto 1 de cada 25 veces. En Linux se mira directo; en Windows lo dice el
    // renombre, pero menos veces (un antivirus también puede trabarlo un instante, y eso no es esta falla)
    for (let i = 0; i < (process.platform === 'linux' ? 200 : 20); i++) {
      expect(await fileSha1(f)).toMatch(/^[0-9a-f]{40}$/)
      if (process.platform === 'linux') expect(abiertos(fs.realpathSync(f))).toEqual([])
      fs.writeFileSync(tmp, Buffer.alloc(300_000, i))
      fs.renameSync(tmp, f) // en Windows falla si el archivo sigue abierto
    }
  })
  it('un archivo que no está da error, no se queda esperando', async () => {
    await expect(fileSha1(path.join(dir, 'no-esta.jpg'))).rejects.toThrow()
  })
})
