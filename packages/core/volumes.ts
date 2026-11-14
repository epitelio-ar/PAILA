// Discos: se identifican por número de serie, así una letra que cambia (F: → E:) no rompe nada. En Mac, por el número
// propio de cada disco (core/volumes-mac.ts).
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { macLabelOf, macMountCandidates, macMountOf, macSerialOf } from './volumes-mac'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

/** Raíz del volumen de una ruta: "F:\" en Windows, "/Volumes/SSD" (o "/") en Mac, "/" en el resto. */
export function mountOf(p: string): string {
  if (isMac) return macMountOf(path.resolve(p))
  return path.parse(path.resolve(p)).root
}

/** En Windows, stat().dev es el número de serie del volumen. */
export function serialOf(p: string): string {
  if (isMac) return macSerialOf(mountOf(p))
  const dev = fs.statSync(mountOf(p)).dev
  const hex = dev.toString(16).toUpperCase().padStart(8, '0')
  return isWin ? `${hex.slice(0, 4)}-${hex.slice(4)}` : hex
}

/** Nombre del disco ("SSD EXTERNO"). Si no se puede leer, devuelve ''. */
export function labelOf(p: string): Promise<string> {
  if (isMac) return Promise.resolve(macLabelOf(mountOf(p)))
  if (!isWin) return Promise.resolve('')
  const drive = mountOf(p).replace(/\\$/, '')
  return new Promise((resolve) => {
    execFile('cmd.exe', ['/d', '/c', 'vol', drive], { windowsHide: true, encoding: 'latin1' }, (err, out) => {
      if (err) return resolve('')
      const first = String(out).split(/\r?\n/).find((l) => l.trim()) || ''
      // "El volumen de la unidad F es SSD EXTERNO" / "Volume in drive F is SSD EXTERNO"
      const m = first.match(/\s(?:es|is)\s+(.+)$/)
      resolve(m && !/no tiene etiqueta|has no label/i.test(first) ? m[1].trim() : '')
    })
  })
}

/** Busca dónde está montado hoy un disco conocido. Prueba primero la última ubicación. */
export function findMount(serial: string, lastMount: string): string | null {
  const candidates = isWin
    ? [lastMount, ...'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`)]
    : isMac ? macMountCandidates(lastMount) : [lastMount]
  for (const m of candidates) {
    try {
      if (fs.existsSync(m) && serialOf(m) === serial) return m
    } catch { /* unidad sin disco (lectora vacía, etc.) */ }
  }
  return null
}
