// Tapas guardadas por su contenido en la carpeta de datos (`tapas/<huella>.jpg`): la tapa nueva y la que había, para
// poder deshacer. Así Cambios pendientes y el Historial guardan una referencia corta y no la imagen entera en cada tema.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { textos } from '@paila/shared/idioma'

const T = textos({
  imagen: { es: 'La imagen tiene que ser JPG o PNG', en: 'The image has to be a JPG or a PNG' },
  sinTapa: { es: 'No se encontró la tapa guardada (la carpeta "tapas" de PAILA se borró a mano)', en: 'The saved cover was not found (PAILA\'s "tapas" folder was deleted by hand)' },
})

export interface ImageInfo { mime: 'image/jpeg' | 'image/png'; width: number; height: number }

/** Formato y tamaño en píxeles de una imagen JPG o PNG (leyendo su encabezado); null si no es ninguna de las dos. */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { mime: 'image/png', width: v.getUint32(16), height: v.getUint32(20) }
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  // se recorren los bloques del JPG hasta el que dice el tamaño (SOF0…SOF15, menos los que no son de imagen)
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue }
    const len = (b[i + 2] << 8) | b[i + 3]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] }
    if (m === 0xd9 || m === 0xda) return null
    i += 2 + len
  }
  return null
}

/** El lado más chico de una tapa (lo que importa para decir si una es mejor que otra). */
export const side = (i: { width: number; height: number } | null) => (i ? Math.min(i.width, i.height) : 0)

export class CoverStore {
  constructor(readonly dir: string) {}

  /** Guarda la imagen (si no estaba) y devuelve su huella. */
  put(bytes: Uint8Array): string {
    const info = imageInfo(bytes)
    if (!info) throw new Error(T.imagen)
    const sha = crypto.createHash('sha1').update(bytes).digest('hex')
    const file = path.join(this.dir, `${sha}${info.mime === 'image/png' ? '.png' : '.jpg'}`)
    if (!fs.existsSync(file)) {
      fs.mkdirSync(this.dir, { recursive: true })
      fs.writeFileSync(`${file}.tmp`, bytes)
      fs.renameSync(`${file}.tmp`, file)
    }
    return sha
  }

  /** Dónde está guardada una tapa (null si no está). Solo huellas: nunca una ruta que venga de afuera. */
  path(sha: string): string | null {
    if (!/^[0-9a-f]{40}$/.test(sha)) return null
    for (const ext of ['.jpg', '.png']) { const f = path.join(this.dir, sha + ext); if (fs.existsSync(f)) return f }
    return null
  }

  get(sha: string): Buffer | null { const f = this.path(sha); return f ? fs.readFileSync(f) : null }

  /** Valor de tapa corto (lo que va en Cambios pendientes y en el diario): { mime, ref }. */
  refValue(bytes: Uint8Array): string {
    const sha = this.put(bytes)
    return JSON.stringify({ mime: imageInfo(bytes)!.mime, ref: sha })
  }

  /** Pasa un valor { mime, data } (la imagen entera en base64) a { mime, ref }. Los demás quedan como están. */
  compact(value: string | null): string | null {
    if (!value) return value
    try {
      const v = JSON.parse(value) as { mime?: string; data?: string; ref?: string }
      if (!v.data) return value
      const bytes = Buffer.from(v.data, 'base64')
      return imageInfo(bytes) ? JSON.stringify({ mime: v.mime, ref: this.put(bytes) }) : value
    } catch { return value }
  }

  /** Lo contrario: { mime, ref } → { mime, data }, que es lo que se escribe en el archivo. */
  expand(value: string | null): string | null {
    if (!value) return value
    const v = JSON.parse(value) as { mime: string; data?: string; ref?: string }
    if (!v.ref) return value
    const bytes = this.get(v.ref)
    if (!bytes) throw new Error(T.sinTapa)
    return JSON.stringify({ mime: v.mime, data: bytes.toString('base64') })
  }

  /** Los bytes de un valor de tapa (con referencia o con la imagen entera). */
  bytesOf(value: string): Buffer {
    const v = JSON.parse(this.expand(value)!) as { data: string }
    return Buffer.from(v.data, 'base64')
  }
}
