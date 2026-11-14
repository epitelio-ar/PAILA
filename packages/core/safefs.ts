// Mover archivos sin pisar nunca nada. En Windows, fs.renameSync reemplaza EN SILENCIO lo que haya en el destino:
// todo lo que PAILA mueve a la papelera (o saca de ella) pasa por acá.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { textos } from '@paila/shared/idioma'

const T = textos({
  ocupado: { es: (to: string) => `Ya hay un archivo en ${to}: PAILA no lo pisa`, en: (to: string) => `There's already a file at ${to}: PAILA won't overwrite it` },
})

/** Mueve `from` a `to` creando las carpetas que falten. Si en `to` ya hay algo, no mueve y avisa. */
export function moveNoClobber(from: string, to: string) {
  // mismo archivo con otras mayúsculas (Windows no distingue): no es pisar nada
  if (fs.existsSync(to) && path.resolve(from).toLowerCase() !== path.resolve(to).toLowerCase()) {
    throw new Error(T.ocupado(to))
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.renameSync(from, to)
}

/**
 * Nombre de carpeta único para una tanda de la papelera: fecha y hora + qué fue + 4 letras al azar
 * ("2026-10-20_01-15-07_tanda-3_k9x2"). Antes se numeraban 1, 2, 3… según la base: con otra base (la portable y la
 * instalada en el mismo disco, o reinstalar) los números se repetían y un archivo podía caer encima de otro.
 */
export function trashBatch(what: string): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  return `${stamp}_${what}_${crypto.randomBytes(3).toString('base64url').slice(0, 4).toLowerCase()}`
}
