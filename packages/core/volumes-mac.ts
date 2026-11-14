// Discos en Mac (lo usa core/volumes.ts): los discos de afuera se montan en /Volumes/<nombre> y el de la Mac es "/". Cada
// disco se reconoce por su número propio (VolumeUUID de `diskutil`), así cambiarle el nombre o enchufarlo en otro orden no
// rompe nada. Puro salvo `diskutil`, que se puede cambiar en los tests.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** "/Volumes/SSD/Música/x.mp3" → "/Volumes/SSD"; cualquier otra ruta es del disco de la Mac: "/". */
export function macMountOf(abs: string): string {
  const m = path.posix.normalize(abs).match(/^\/Volumes\/[^/]+/)
  return m ? m[0] : '/'
}

/** Lo que dice `diskutil info -plist <disco>` (texto XML), o '' si no se pudo. */
export type Diskutil = (mount: string) => string
const diskutil: Diskutil = (mount) => {
  try { return execFileSync('diskutil', ['info', '-plist', mount], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' }
}

/** Un valor de texto del plist de diskutil ("VolumeUUID", "VolumeName"). */
export function plistString(xml: string, key: string): string {
  const m = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : ''
}

// diskutil tarda ~50 ms: se guarda por disco montado (el número de dispositivo cambia si en ese lugar se monta otro disco)
const cache = new Map<string, string>()

/**
 * El número propio del disco. Si diskutil no contesta, el número de dispositivo (como antes). El de la Mac ("/") se pregunta
 * por su parte de datos (/System/Volumes/Data, donde están los archivos de la persona): la parte del sistema cambia con
 * las actualizaciones de macOS.
 */
export function macSerialOf(mount: string, run: Diskutil = diskutil, data = '/System/Volumes/Data'): string {
  const dev = fs.statSync(mount).dev
  const key = `${mount}|${dev}`
  const hit = cache.get(key)
  if (hit) return hit
  const uuid = plistString(run(mount === '/' && fs.existsSync(data) ? data : mount), 'VolumeUUID').toUpperCase()
  const serial = uuid || dev.toString(16).toUpperCase().padStart(8, '0')
  cache.set(key, serial)
  return serial
}

/** El nombre del disco: el de la carpeta en /Volumes, o el que dice diskutil para el de la Mac ("Macintosh HD"). */
export function macLabelOf(mount: string, run: Diskutil = diskutil): string {
  return mount.startsWith('/Volumes/') ? path.posix.basename(mount) : plistString(run(mount), 'VolumeName')
}

/**
 * Dónde puede estar hoy un disco: donde estaba la última vez, el de la Mac y cada disco enchufado. "/" va antes que
 * /Volumes porque ahí también aparece el disco de la Mac ("/Volumes/Macintosh HD", un atajo a "/").
 */
export function macMountCandidates(lastMount: string, volumes = '/Volumes', list = (d: string) => fs.readdirSync(d)): string[] {
  let names: string[] = []
  try { names = list(volumes) } catch { /* sin /Volumes */ }
  return [...new Set([lastMount, '/', ...names.filter((n) => !n.startsWith('.')).map((n) => path.posix.join(volumes, n))])]
}
