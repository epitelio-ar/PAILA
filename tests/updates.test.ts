// Actualizaciones (Fase H): latest.yml, comparar versiones y bajar el instalador verificado, contra un servidor de prueba
// local (como el de GitHub Releases: latest.yml + el instalador al lado). Nunca toca GitHub.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { checkForUpdate, compareVersions, downloadUpdate, parseLatestYml } from '@paila/core/updates'

const installer = crypto.randomBytes(300_000)
const sha = crypto.createHash('sha512').update(installer).digest('base64')
const yml = (v: string, file = `PAILA-instalador-${v}.exe`, h = sha) => `version: ${v}\nfiles:\n  - url: ${file}\n    sha512: ${h}\n    size: ${installer.length}\npath: ${file}\nsha512: ${h}\nreleaseDate: '2026-11-01T10:00:00.000Z'\n`
let files: Record<string, Buffer | string> = {}
let server: http.Server
let feed = ''
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-upd-'))

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '').split('/').pop() ?? '')
    const body = files[name]
    if (body == null) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-length': Buffer.byteLength(body) }); res.end(body)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  feed = `http://127.0.0.1:${(server.address() as AddressInfo).port}/releases/latest/download/`
})
afterAll(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }) })

describe('versiones', () => {
  it('compara números y prereleases', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0)
  })

  it('lee latest.yml y rechaza rutas que salen de la carpeta', () => {
    expect(parseLatestYml(yml('0.2.0'))).toMatchObject({ version: '0.2.0', file: 'PAILA-instalador-0.2.0.exe', sha512: sha, size: installer.length })
    expect(parseLatestYml(yml('0.2.0', '../otro.exe'))).toBeNull()
    expect(parseLatestYml(yml('0.2.0', 'https://otro.sitio/x.exe'))).toBeNull()
    expect(parseLatestYml('version: 0.2.0\n')).toBeNull()
  })
})

describe('servidor de prueba', () => {
  it('sin ninguna versión publicada (404) no hay nada y no es un error', async () => {
    files = {}
    expect(await checkForUpdate(feed, '0.1.0')).toBeNull()
  })

  it('avisa solo si es más nueva y no es la que se pidió saltear', async () => {
    files = { 'latest.yml': yml('0.2.0') }
    expect((await checkForUpdate(feed, '0.1.0'))?.version).toBe('0.2.0')
    expect(await checkForUpdate(feed, '0.2.0')).toBeNull()
    expect(await checkForUpdate(feed, '0.3.0')).toBeNull()
    expect(await checkForUpdate(feed, '0.1.0', { skip: '0.2.0' })).toBeNull()
  })

  it('baja el instalador, verifica la huella y no lo vuelve a bajar', async () => {
    files = { 'latest.yml': yml('0.2.0'), 'PAILA-instalador-0.2.0.exe': installer }
    const info = (await checkForUpdate(feed, '0.1.0'))!
    const seen: number[] = []
    const p = await downloadUpdate(feed, info, tmp, { onProgress: (d) => seen.push(d) })
    expect(fs.readFileSync(p).equals(installer)).toBe(true)
    expect(seen.at(-1)).toBe(installer.length)
    delete files['PAILA-instalador-0.2.0.exe']
    expect(await downloadUpdate(feed, info, tmp)).toBe(p)
  })

  it('si el archivo no es el publicado (huella distinta) lo borra y no deja nada', async () => {
    const dir = path.join(tmp, 'malo')
    files = { 'latest.yml': yml('0.3.0'), 'PAILA-instalador-0.3.0.exe': Buffer.concat([installer, Buffer.from('x')]) }
    const info = (await checkForUpdate(feed, '0.1.0'))!
    await expect(downloadUpdate(feed, info, dir)).rejects.toThrow(/huella no coincide/)
    expect(fs.readdirSync(dir)).toEqual([])
  })
})

describe('después de firmar', () => {
  it('latest.yml queda con la huella y el tamaño del instalador firmado', async () => {
    const { rewriteLatestYml } = await import('@paila/core/updates')
    const signed = Buffer.concat([installer, Buffer.from('firma')])
    const h = crypto.createHash('sha512').update(signed).digest('base64')
    const info = parseLatestYml(rewriteLatestYml(yml('0.2.0'), h, signed.length))!
    expect(info).toMatchObject({ sha512: h, size: signed.length, version: '0.2.0' })
    expect(rewriteLatestYml(yml('0.2.0'), h, signed.length).split(h).length - 1).toBe(2)
  })
})
