// Tests de lo que Separar voz baja aparte (core/stems/modelo.ts): abrir un .tgz de npm sin juntarlo en memoria (con rutas
// largas ustar y pax), sacar solo lo de este sistema y nada de DirectML, verificar la huella antes de usar y no dejar nada a
// medias si la descarga llega distinta o se corta. Con un "internet" de mentira: nada sale de la compu.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { STEMS_MODEL, bajarStems, sacarTgz, stemsToDownload, type FetchLike, type StemsFile } from '@paila/core/stems/modelo'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-separar-modelo-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function entrada(name: string, data: Buffer, type = '0', prefix = ''): Buffer {
  const h = Buffer.alloc(512)
  h.write(name, 0, 100, 'utf8'); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116)
  h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124); h.write('00000000000\0', 136); h.write('        ', 148)
  h.write(type, 156); h.write('ustar\0', 257); h.write('00', 263)
  if (prefix) h.write(prefix, 345, 155, 'utf8')
  let sum = 0
  for (const b of h) sum += b
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512)])
}
function pax(p: string): Buffer {
  const rec = (n: number) => `${n} path=${p}\n`
  let n = rec(0).length
  while (rec(n).length !== n) n = rec(n).length
  return entrada('PaxHeader', Buffer.from(rec(n)), 'x')
}
const tgz = (es: Buffer[]) => zlib.gzipSync(Buffer.concat([...es, Buffer.alloc(1024)]))
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')
const NAPI = `package/bin/napi-v6/${process.platform}/${process.arch}`

describe('abrir un .tgz', () => {
  it('saca lo pedido, con rutas largas (prefix de ustar y pax), y saltea lo demás', async () => {
    const largo = `package/${'carpeta-de-nombre-largo/'.repeat(6)}hondo.js`
    const f = path.join(dir, 'a.tgz')
    fs.writeFileSync(f, tgz([
      entrada('package/package.json', Buffer.from('{"name":"x"}')),
      entrada('ignorado.txt', Buffer.alloc(3000, 1)),
      entrada('archivo.js', Buffer.from('prefijo'), '0', 'package/dist'),
      pax(largo), entrada('cortado', Buffer.from('largo')),
    ]))
    const out = path.join(dir, 'a')
    const keep = (e: string) => (e.endsWith('ignorado.txt') ? null : e.replace(/^package\//, ''))
    const hechos = await sacarTgz(f, out, keep)
    expect(hechos.sort()).toEqual(['dist/archivo.js', largo.replace('package/', ''), 'package.json'].sort())
    expect(fs.readFileSync(path.join(out, 'dist', 'archivo.js'), 'utf8')).toBe('prefijo')
    expect(fs.readFileSync(path.join(out, ...largo.replace('package/', '').split('/')), 'utf8')).toBe('largo')
    expect(fs.existsSync(path.join(out, 'ignorado.txt'))).toBe(false)
  })
})

describe('bajar', () => {
  const modelo = Buffer.alloc(4096, 7)
  const ort = tgz([
    entrada('package/package.json', Buffer.from('{"name":"onnxruntime-node","main":"dist/index.js"}')),
    entrada('package/dist/index.js', Buffer.from('module.exports = {}')),
    entrada('package/dist/index.js.map', Buffer.from('{}')),
    entrada('package/lib/index.ts', Buffer.from('//')),
    entrada(`${NAPI}/onnxruntime_binding.node`, Buffer.from('binario')),
    entrada(`${NAPI}/DirectML.dll`, Buffer.alloc(2000, 3)),
    entrada('package/bin/napi-v6/otro-sistema/x64/onnxruntime_binding.node', Buffer.from('de otro')),
  ])
  const common = tgz([entrada('package/package.json', Buffer.from('{"name":"onnxruntime-common"}')), entrada('package/dist/cjs/index.js', Buffer.from('//'))])
  const files = (m = modelo): StemsFile[] => [
    { file: STEMS_MODEL, url: 'u/modelo', bytes: modelo.length, sha256: sha(m) },
    { file: 'ort.tgz', url: 'u/ort', bytes: ort.length, sha256: sha(ort), paquete: 'onnxruntime-node' },
    { file: 'common.tgz', url: 'u/common', bytes: common.length, sha256: sha(common), paquete: 'onnxruntime-common' },
  ]
  const red = (servido: Record<string, Buffer>, pedidos: string[] = []): FetchLike => async (url) => {
    pedidos.push(url)
    const b = servido[url]
    return b ? { ok: true, status: 200, body: new Blob([b]).stream() } : { ok: false, status: 404, body: null }
  }
  const todo = { 'u/modelo': modelo, 'u/ort': ort, 'u/common': common }

  it('baja, verifica y deja solo lo de este sistema (sin DirectML ni lo de otros sistemas)', async () => {
    const d = path.join(dir, 'bien')
    const avance: number[] = []
    expect(stemsToDownload(d, files())).toBe(true)
    await bajarStems(d, red(todo), { progress: (b) => avance.push(b) }, files())
    expect(stemsToDownload(d, files())).toBe(false)
    const n = path.join(d, 'npm', 'node_modules', 'onnxruntime-node')
    expect(fs.existsSync(path.join(n, ...NAPI.replace('package/', '').split('/'), 'onnxruntime_binding.node'))).toBe(true)
    expect(fs.existsSync(path.join(n, ...NAPI.replace('package/', '').split('/'), 'DirectML.dll'))).toBe(false)
    expect(fs.existsSync(path.join(n, 'bin', 'napi-v6', 'otro-sistema'))).toBe(false)
    expect(fs.existsSync(path.join(n, 'dist', 'index.js.map'))).toBe(false)
    expect(fs.existsSync(path.join(n, 'lib'))).toBe(false)
    expect(fs.existsSync(path.join(d, 'ort.tgz'))).toBe(false) // el paquete se borra después de abrirlo
    expect(fs.existsSync(`${d}-bajando`)).toBe(false)
    expect(avance.at(-1)).toBe(files().reduce((s, f) => s + f.bytes, 0))
    // lo que ya está bien no se vuelve a bajar
    const pedidos: string[] = []
    await bajarStems(d, red(todo, pedidos), {}, files())
    expect(pedidos).toEqual([])
  })

  it('si llega distinto (la huella no coincide), no lo usa ni lo deja', async () => {
    const d = path.join(dir, 'distinto')
    await expect(bajarStems(d, red({ ...todo, 'u/modelo': Buffer.alloc(4096, 8) }), {}, files())).rejects.toThrow()
    expect(fs.existsSync(path.join(d, STEMS_MODEL))).toBe(false)
    expect(fs.existsSync(`${d}-bajando`)).toBe(false)
  })

  it('si se corta, no queda nada a medias', async () => {
    const d = path.join(dir, 'corte')
    let pedido = 0
    await expect(bajarStems(d, red(todo), { cancelled: () => ++pedido > 1 }, files())).rejects.toThrow()
    expect(fs.existsSync(path.join(d, STEMS_MODEL))).toBe(false)
    expect(fs.existsSync(`${d}-bajando`)).toBe(false)
  })

  it('si no responde (404), dice cuál no se pudo bajar', async () => {
    await expect(bajarStems(path.join(dir, 'sin-red'), red({}), {}, files())).rejects.toThrow(/404/)
  })
})
