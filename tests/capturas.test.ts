// Capturas de todas las pantallas (scripts/capturas.ts) y la lámina de antes y después (scripts/capturas-comparar.ts, scripts/png.ts):
// leer y escribir PNG, medir cuánto cambió una pantalla, comparar dos carpetas y armar la lámina. Sin abrir la app.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { comparar, escribirPng, leerPng, type Imagen } from '../scripts/png'
import { compararCarpetas, laminaHtml, listarPng, resumenTexto } from '../scripts/capturas-comparar'
import { MODOS, nombreFecha } from '../scripts/capturas'
// @ts-expect-error el script es .mjs; sus tipos están en app-ruta.d.mts
import { rutaApp, rutaElectron } from '../scripts/app-ruta.mjs'

const dirs: string[] = []
const nueva = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-capt-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

/** Una imagen de un color con un cuadrado de otro. */
function imagen(ancho: number, alto: number, fondo: [number, number, number], cuadrado?: { x: number; y: number; l: number; color: [number, number, number] }): Imagen {
  const datos = new Uint8Array(ancho * alto * 4)
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    const c = cuadrado && x >= cuadrado.x && x < cuadrado.x + cuadrado.l && y >= cuadrado.y && y < cuadrado.y + cuadrado.l ? cuadrado.color : fondo
    datos.set([...c, 255], (y * ancho + x) * 4)
  }
  return { ancho, alto, datos }
}
const guardar = (dir: string, rel: string, img: Imagen) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, escribirPng(img)) }

describe('capturas: PNG sin librerías', () => {
  it('escribir y volver a leer da la misma imagen', () => {
    const img = imagen(37, 21, [10, 20, 30], { x: 5, y: 4, l: 9, color: [200, 100, 50] })
    const vuelta = leerPng(escribirPng(img))
    expect(vuelta.ancho).toBe(37); expect(vuelta.alto).toBe(21)
    expect(Buffer.from(vuelta.datos).equals(Buffer.from(img.datos))).toBe(true)
  })
  it('lee los cinco filtros de PNG (una imagen real de zlib con cada filtro)', async () => {
    const zlib = await import('node:zlib')
    // 4 puntos RGB por fila, una fila por filtro (0 ninguno, 1 izquierda, 2 arriba, 3 promedio, 4 Paeth)
    const filas = [[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120], [1, 10, 20, 30, 5, 5, 5, 5, 5, 5, 5, 5, 5], [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], [4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]]
    const crudo = Buffer.from(filas.flat())
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(5, 4); ihdr[8] = 8; ihdr[9] = 2
    const trozo = (n: string, c: Buffer) => { const a = Buffer.alloc(8); a.writeUInt32BE(c.length, 0); a.write(n, 4, 'latin1'); const k = Buffer.alloc(4); k.writeUInt32BE(zlib.crc32(Buffer.concat([a.subarray(4), c])) >>> 0, 0); return Buffer.concat([a, c, k]) }
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))])
    const r = leerPng(png)
    const px = (x: number, y: number) => [...r.datos.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 3)]
    expect(px(0, 0)).toEqual([10, 20, 30])
    expect(px(1, 1)).toEqual([15, 25, 35]) // izquierda (10,20,30) + 5
    expect(px(0, 2)).toEqual([11, 21, 31]) // arriba (10,20,30) + 1
    expect(() => leerPng(Buffer.from('no es un png'))).toThrow(/No es un PNG/)
  })
  it('compara: igual, un cuadrado cambiado y distinto tamaño', () => {
    const base = imagen(40, 40, [20, 20, 20])
    expect(comparar(base, imagen(40, 40, [20, 20, 20])).diferencia).toBeNull()
    expect(comparar(base, imagen(40, 40, [24, 20, 20])).diferencia).toBeNull() // el suavizado de letras: dentro de la tolerancia
    const r = comparar(base, imagen(40, 40, [20, 20, 20], { x: 10, y: 10, l: 10, color: [255, 0, 0] }))
    expect(r.cambiado).toBeCloseTo(100 / 1600)
    expect(r.diferencia).not.toBeNull()
    const otro = comparar(base, imagen(50, 40, [20, 20, 20]))
    expect(otro.mismoTamano).toBe(false)
    expect(otro.cambiado).toBeCloseTo(400 / 2000)
  })
})

describe('capturas: comparar dos carpetas y armar la lámina', () => {
  it('cuenta iguales, cambiadas, nuevas y ausentes, deja la imagen de dónde cambió y arma la lámina', () => {
    const a = nueva(), d = nueva(), sal = nueva()
    const fondo = imagen(40, 30, [30, 30, 40])
    guardar(a, 'paila/sobrio/home.png', fondo); guardar(d, 'paila/sobrio/home.png', fondo)
    guardar(a, 'paila/sobrio/dups.png', fondo); guardar(d, 'paila/sobrio/dups.png', imagen(40, 30, [30, 30, 40], { x: 0, y: 0, l: 15, color: [255, 200, 0] }))
    guardar(a, 'paila/sobrio/vieja.png', fondo)
    guardar(d, 'paila/historieta/nueva.png', fondo)
    fs.writeFileSync(path.join(d, 'indice.json'), '{}')
    expect(listarPng(d)).toEqual(['paila/historieta/nueva.png', 'paila/sobrio/dups.png', 'paila/sobrio/home.png'])
    const r = compararCarpetas(a, d, sal)
    const estado = Object.fromEntries(r.map((x) => [x.archivo, x.estado]))
    expect(estado).toEqual({ 'paila/historieta/nueva.png': 'nueva', 'paila/sobrio/dups.png': 'cambio', 'paila/sobrio/home.png': 'igual', 'paila/sobrio/vieja.png': 'falta' })
    const cambio = r.find((x) => x.estado === 'cambio')!
    expect(fs.existsSync(path.join(sal, cambio.diferencia!))).toBe(true)
    expect(cambio.cambiado).toBeCloseTo(225 / 1200)
    const html = laminaHtml(r, a, d, sal)
    expect(html).toMatch(/<b>1<\/b> cambiaron · <b>1<\/b> nuevas · <b>1<\/b> ya no están · <b>1<\/b> iguales/)
    expect(html).toMatch(/Antes<\/figcaption>/)
    expect(html).toMatch(/Dónde cambió/)
    expect(html).toContain('paila/sobrio/dups.png')
    expect(resumenTexto(r, 'lamina.html')).toMatch(/4 pantallas: 1 iguales · 1 cambiaron · 1 nuevas · 1 ya no están\n.*18[.,]8 % {1}.*dups/s)
  })
  it('dos corridas iguales no tienen cambios', () => {
    const a = nueva(), d = nueva(), sal = nueva()
    guardar(a, 'napia/cabina/vacia.png', imagen(20, 20, [1, 2, 3])); guardar(d, 'napia/cabina/vacia.png', imagen(20, 20, [1, 2, 3]))
    expect(compararCarpetas(a, d, sal).every((x) => x.estado === 'igual')).toBe(true)
    expect(fs.existsSync(path.join(sal, 'diferencias'))).toBe(false)
  })
})

describe('capturas: el recorrido', () => {
  it('los tres modos (sobrio, historieta y cabina) y la carpeta con fecha', () => {
    expect(MODOS).toEqual(['sobrio', 'historieta', 'cabina'])
    expect(nombreFecha(new Date(2026, 9, 22, 15, 30))).toBe('2026-10-22_1530')
  })
})

describe('capturas: una ruta mala nunca abre una ventana de error de Electron', () => {
  it('se comprueba la app y Electron antes de abrir nada, y falla en la consola con lo que hay que hacer', () => {
    const d = nueva()
    expect(() => rutaApp(d)).toThrow(/No encuentro apps.paila/)
    fs.mkdirSync(path.join(d, 'apps', 'paila'), { recursive: true })
    fs.writeFileSync(path.join(d, 'apps', 'paila', 'package.json'), '{}')
    expect(() => rutaApp(d)).toThrow(/no está armada.*npm run build/)
    fs.mkdirSync(path.join(d, 'apps', 'paila', 'out', 'main'), { recursive: true })
    fs.writeFileSync(path.join(d, 'apps', 'paila', 'out', 'main', 'arranque.js'), '')
    expect(rutaApp(path.join(d, 'scripts'))).toBe(path.join(d, 'apps', 'paila')) // también desde una carpeta de adentro
    expect(typeof rutaElectron()).toBe('string') // en este repositorio sí está
  })
})
