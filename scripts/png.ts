// Leer y escribir PNG sin librerías (zlib de Node): lo justo para comparar capturas de pantalla (8 bits, sin entrelazado, como las
// que saca Chromium) y dibujar dónde cambiaron. Lo usa scripts/capturas-comparar.ts.
import zlib from 'node:zlib'

export interface Imagen { ancho: number; alto: number; /** RGBA, 4 bytes por punto */ datos: Uint8Array }

const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** El PNG a puntos RGBA. Falla con un PNG que no sea de 8 bits, sin entrelazado y en gris, RGB o RGBA. */
export function leerPng(buf: Buffer): Imagen {
  if (!buf.subarray(0, 8).equals(FIRMA)) throw new Error('No es un PNG')
  let ancho = 0, alto = 0, tipo = 0
  const trozos: Buffer[] = []
  for (let i = 8; i < buf.length;) {
    const largo = buf.readUInt32BE(i), nombre = buf.toString('latin1', i + 4, i + 8), cuerpo = buf.subarray(i + 8, i + 8 + largo)
    if (nombre === 'IHDR') {
      ancho = cuerpo.readUInt32BE(0); alto = cuerpo.readUInt32BE(4); tipo = cuerpo[9]
      if (cuerpo[8] !== 8 || cuerpo[12] !== 0 || ![0, 2, 6].includes(tipo)) throw new Error('PNG no soportado (hace falta 8 bits, sin entrelazado, gris, RGB o RGBA)')
    } else if (nombre === 'IDAT') trozos.push(cuerpo)
    else if (nombre === 'IEND') break
    i += 12 + largo
  }
  const canales = tipo === 6 ? 4 : tipo === 2 ? 3 : 1
  const crudo = zlib.inflateSync(Buffer.concat(trozos))
  const fila = ancho * canales
  const out = new Uint8Array(ancho * alto * 4)
  let prev = new Uint8Array(fila)
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[y * (fila + 1)]
    const cur = Uint8Array.from(crudo.subarray(y * (fila + 1) + 1, (y + 1) * (fila + 1)))
    for (let x = 0; x < fila; x++) {
      const a = x >= canales ? cur[x - canales] : 0, b = prev[x], c = x >= canales ? prev[x - canales] : 0
      let p = 0
      if (filtro === 2) p = b
      else if (filtro === 1) p = a
      else if (filtro === 3) p = (a + b) >> 1
      else if (filtro === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      cur[x] = (cur[x] + p) & 255
    }
    for (let x = 0; x < ancho; x++) {
      const o = (y * ancho + x) * 4
      if (canales === 4) { out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3] }
      else if (canales === 3) { out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255 }
      else { out[o] = out[o + 1] = out[o + 2] = cur[x]; out[o + 3] = 255 }
    }
    prev = cur
  }
  return { ancho, alto, datos: out }
}

const trozo = (nombre: string, cuerpo: Buffer) => {
  const cab = Buffer.alloc(8); cab.writeUInt32BE(cuerpo.length, 0); cab.write(nombre, 4, 'latin1')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([cab.subarray(4), cuerpo])) >>> 0, 0)
  return Buffer.concat([cab, cuerpo, crc])
}

/** Puntos RGBA a PNG. */
export function escribirPng(img: Imagen): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.ancho, 0); ihdr.writeUInt32BE(img.alto, 4); ihdr[8] = 8; ihdr[9] = 6
  const fila = img.ancho * 4
  const crudo = Buffer.alloc((fila + 1) * img.alto)
  for (let y = 0; y < img.alto; y++) { crudo[y * (fila + 1)] = 0; Buffer.from(img.datos.buffer, img.datos.byteOffset + y * fila, fila).copy(crudo, y * (fila + 1) + 1) }
  return Buffer.concat([FIRMA, trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))])
}

/**
 * Compara dos imágenes: cuántos puntos cambiaron (de 0 a 1) y, si hay diferencia, una imagen que muestra el "después" apagado con los
 * puntos que cambiaron en rojo. Con distinto tamaño se compara lo que se superpone y lo que sobra cuenta como cambiado.
 */
export function comparar(antes: Imagen, despues: Imagen, tolerancia = 8): { cambiado: number; mismoTamano: boolean; diferencia: Imagen | null } {
  const ancho = Math.max(antes.ancho, despues.ancho), alto = Math.max(antes.alto, despues.alto)
  const dif = new Uint8Array(ancho * alto * 4)
  let n = 0
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    const o = (y * ancho + x) * 4
    const a = x < antes.ancho && y < antes.alto ? (y * antes.ancho + x) * 4 : -1, d = x < despues.ancho && y < despues.alto ? (y * despues.ancho + x) * 4 : -1
    const cambia = a < 0 || d < 0 || Math.abs(antes.datos[a] - despues.datos[d]) > tolerancia || Math.abs(antes.datos[a + 1] - despues.datos[d + 1]) > tolerancia || Math.abs(antes.datos[a + 2] - despues.datos[d + 2]) > tolerancia
    if (cambia) { n++; dif[o] = 255; dif[o + 1] = 30; dif[o + 2] = 60; dif[o + 3] = 255 }
    else if (d >= 0) { dif[o] = despues.datos[d] >> 2; dif[o + 1] = despues.datos[d + 1] >> 2; dif[o + 2] = despues.datos[d + 2] >> 2; dif[o + 3] = 255 }
    else dif[o + 3] = 255
  }
  const mismoTamano = antes.ancho === despues.ancho && antes.alto === despues.alto
  return { cambiado: n / (ancho * alto), mismoTamano, diferencia: n ? { ancho, alto, datos: dif } : null }
}
