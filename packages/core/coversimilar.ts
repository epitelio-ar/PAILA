// ¿Dos tapas son la misma imagen? Antes de preferir la de la carpeta por ser más grande (punto 1 real del 24/10: en "El Círculo" de
// Kase.O el folder.jpg de 1200 era la tapa de la edición instrumental, toda verde, y pisaba la buena de 800 que tenían los temas).
// Cada una se achica a 16×16 en color con ffmpeg y se mide cuánto difieren, de 0 a 255. En la Música del autor, el folder.jpg y
// la tapa de adentro dan menos de 6 en 156 de 166 discos cuando son la misma (casi todas menos de 4), y 21 o más cuando es otra
// (El Círculo, 23,6). Lo usa core/covers.ts.
import { spawnSync } from 'node:child_process'

const SIDE = 16
/** Hasta cuánto se parecen dos tapas que son la misma (la misma imagen en otro tamaño o con otra compresión). */
export const SAME_COVER = 12

/** La imagen achicada a 16×16 en color (768 bytes), o null si ffmpeg no la pudo leer. */
export function thumb(ffmpeg: string, image: Uint8Array): Buffer | null {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', 'pipe:0', '-vf', `scale=${SIDE}:${SIDE}:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { input: image, maxBuffer: 1 << 22, windowsHide: true })
  return r.status === 0 && r.stdout?.length === SIDE * SIDE * 3 ? r.stdout : null
}

/** Cuánto difieren dos imágenes achicadas: el promedio de la diferencia de cada punto y color (0 = iguales). */
export function coverDistance(a: Buffer, b: Buffer): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
  return s / a.length
}

/** ¿Son la misma tapa? null si no se pudo leer alguna de las dos. */
export function sameCover(ffmpeg: string, a: Uint8Array, b: Uint8Array): boolean | null {
  const x = thumb(ffmpeg, a), y = thumb(ffmpeg, b)
  return x && y ? coverDistance(x, y) <= SAME_COVER : null
}
